import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore, type FullLayout } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { CoverParticles } from "../../visual/CoverParticles";
import { StarRiver } from "../../visual/StarRiver";
import { LyricStage3D } from "../../visual/LyricStage3D";
import { VisualConsole } from "./VisualConsole";
import { useLyrics } from "./useLyrics";
import { getCoverUrl } from "./useCover";
import { CommentList } from "./CommentList";
import { OrangeRadioLogo } from "../../components/OrangeRadioLogo";
import { useDominantColor } from "./useDominantColor";
import type { ToastKind } from "../../components/Toast";
import "../../styles/full-player.css";

/** 格式化时间 */
const fmt = (s: number) => {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
};

/** 歌词行时间戳格式化：[mm:ss.xx] —— 仿网易云样式 */
const fmtLyricTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
};

const LAYOUT_OPTIONS: { id: FullLayout; short: string; name: string; hint: string }[] = [
  { id: "cinema", short: "电影", name: "电影粒子", hint: "全屏粒子与舞台歌词" },
  { id: "immersive", short: "沉浸", name: "沉浸双栏", hint: "封面与歌词并排" },
  { id: "lyric-stream", short: "歌词", name: "歌词流", hint: "歌词主导的阅读视图" },
  { id: "triple", short: "三栏", name: "三栏详情", hint: "歌词 + 评论并列" },
];

/** 歌词数据（从网易云拉取） */
interface LyricData { raw_lrc: string; translated_lrc: string | null }

/** AI 译注失败/缺 key 时的提示方式（由 App.tsx 注入 toast；未注入时退回 alert） */
interface FullPlayerProps {
  pushToast?: (msg: string, kind?: ToastKind, ttl?: number) => void;
}

export function FullPlayer({ pushToast }: FullPlayerProps = {}) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const fullLayout = usePlayerStore((s) => s.fullLayout);
  const setFullLayout = usePlayerStore((s) => s.setFullLayout);
  const setFullPlayer = usePlayerStore((s) => s.setFullPlayer);
  const fullPlayerOpacity = usePlayerStore((s) => s.visualParams.fullPlayerOpacity);

  // 切歌时提取封面主色 → 写入 store（驱动 cinema 模式 CoverParticles / BeatParticles auto 主题）
  useDominantColor(currentTrack);

  const [lyricData, setLyricData] = useState<LyricData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [annotateLoading, setAnnotateLoading] = useState(false);
  /** AI 译注结果：按原文行文本索引 → {translation, annotation} */
  const [annotatedMap, setAnnotatedMap] = useState<Map<string, { translation?: string; annotation?: string }>>(new Map());
  /** AI 歌曲整体背景（顶部卡片展示） */
  const [aiBackground, setAiBackground] = useState<string | null>(null);
  /** 展开了 annotation 的歌词行索引集合 */
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set());

  // AI 歌词译注（MiniMax LLM，key/base/model 从 localStorage 读，由 SettingsModal 配置）
  const handleAnnotate = async () => {
    const lrc = lyricData?.raw_lrc;
    if (!lrc) {
      pushToast?.("暂无歌词可译注", "warning", 4000) ?? alert("暂无歌词可译注");
      return;
    }
    const key = localStorage.getItem("orangeradio_minimax_key") || "";
    if (!key) {
      const msg = "请先在设置中配置 MiniMax API Key";
      if (pushToast) {
        pushToast(msg, "warning", 6000);
      } else {
        alert(msg);
      }
      return;
    }
    const apiBase = localStorage.getItem("orangeradio_minimax_base") || "https://api.minimaxi.com/anthropic";
    const model = localStorage.getItem("orangeradio_minimax_model") || "MiniMax-M1";
    setAnnotateLoading(true);
    try {
      const r = await invoke<{
        background?: string;
        lines?: { original: string; translation?: string; annotation?: string }[];
      }>("lyric_annotate", {
        lyrics: lrc,
        apiBase,
        apiKey: key,
        model,
      });
      // 按 original 文本建索引，供歌词行渲染时合并
      const map = new Map<string, { translation?: string; annotation?: string }>();
      for (const l of r?.lines || []) {
        const key0 = l.original?.trim();
        if (key0) {
          map.set(key0, {
            translation: l.translation || undefined,
            annotation: l.annotation || undefined,
          });
        }
      }
      setAnnotatedMap(map);
      setAiBackground(r?.background || null);
      setExpandedLines(new Set());
      pushToast?.("译注完成，标记的行可点击查看注解", "info", 4000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const full = "译注失败: " + msg;
      if (pushToast) {
        pushToast(full, "error", 8000);
      } else {
        alert(full);
      }
    } finally {
      setAnnotateLoading(false);
    }
  };
  const trackIdRef = useRef("");
  const lyricScrollRef = useRef<HTMLDivElement>(null);
  const lyricLineRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 歌词居中的补帧 rAF 句柄（卸载时取消，避免对已卸载 DOM 操作）
  const lyricCenterRafRef = useRef<number>(0);

  // 切歌时重新拉歌词（按音源分发：网易云 / QQ；本地等无在线歌词）
  useEffect(() => {
    const tid = currentTrack?.source_track_id || "";
    if (tid === trackIdRef.current) return;
    trackIdRef.current = tid;
    setLyricData(null);
    // 清空上一首的 AI 译注
    setAnnotatedMap(new Map());
    setAiBackground(null);
    setExpandedLines(new Set());
    if (!currentTrack) return;
    const kind = (currentTrack as { source_kind?: string }).source_kind;
    const cmd =
      kind === "netease_cloud_music"
        ? "netease_lyric"
        : kind === "qq_music"
        ? "qqmusic_lyric"
        : null;
    if (!cmd) {
      // 本地曲目：用扫描时提取的内嵌歌词（USLT/LRC）
      const lrc = (currentTrack as { meta?: { lyrics?: string | null } }).meta?.lyrics;
      if (lrc) setLyricData({ raw_lrc: lrc, translated_lrc: null });
      return;
    }
    setLoading(true);
    invoke<LyricData>(cmd, { songId: tid })
      .then((d) => setLyricData(d))
      .catch(() => setLyricData(null))
      .finally(() => setLoading(false));
  }, [currentTrack]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullPlayer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFullPlayer]);

  const { lines, activeIndex, activeProgress } = useLyrics(lyricData?.raw_lrc || null, lyricData?.translated_lrc);

  // 歌词自动居中：必须在 layout 稳定后测量，且不能用 smooth（与字号变化引起的 reflow 叠加会先「跳到底再滚回」）
  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    const container = lyricScrollRef.current;
    if (!container) return;

    const centerActiveLine = () => {
      const el = lyricLineRefs.current[activeIndex];
      if (!el) return;
      // offsetTop 相对滚动容器内容区，比 getBoundingClientRect 在 reflow 期间更稳
      const target = el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2;
      container.scrollTo({ top: Math.max(0, target), behavior: "auto" });
    };

    centerActiveLine();
    // 等 active 行字号/背景样式应用后再补一次（消除首帧高度未更新偏差）
    lyricCenterRafRef.current = requestAnimationFrame(centerActiveLine);
    return () => cancelAnimationFrame(lyricCenterRafRef.current);
  }, [activeIndex, lines.length]);

  /** 当前行平滑扫光（CSS 变量 --lyric-p 驱动渐变边界，对标 MineRadio uProgress smoothstep）
   *  不拆 span，用 background-clip:text + 渐变在 --lyric-p 位置平滑过渡，避免逐字硬切割僵硬感 */
  const lyricStyle = (isActive: boolean, progress: number): React.CSSProperties | undefined => {
    if (!isActive || progress <= 0) return undefined;
    return { ["--lyric-p" as string]: `${Math.round(progress * 1000) / 10}%` } as React.CSSProperties;
  };
  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const title = currentTrack?.meta.title || "未在播放";
  const artist = currentTrack?.meta.artist || "";
  const coverUrl = getCoverUrl(currentTrack);
  const songId = currentTrack?.source_track_id || "";

  const activeLayout = LAYOUT_OPTIONS.find((o) => o.id === fullLayout)!;

  return (
    <div
      className={`fp-overlay fp-overlay--editorial fp-overlay--${fullLayout}`}
      style={{ "--ui-opacity": fullPlayerOpacity } as React.CSSProperties}
    >
      {/* cinema 模式：全屏粒子背景（CoverParticles 内部按封面有无/CORS 自动回退 BeatParticles）
          + StarRiver 冷色星河叠层（对标 MineRadio stageLyrics.starRiver） */}
      {fullLayout === "cinema" && (
        <div className="fp-particles-bg">
          <CoverParticles />
          <div className="fp-starriver-bg"><StarRiver /></div>
        </div>
      )}
      {/* 顶部：模式导航 + 工具 */}
      <header className="fp-header">
        <div className="fp-header__brand">
          <span className="fp-header__eyebrow">NOW PLAYING</span>
          <span className="fp-header__mode">{activeLayout.name}</span>
          <span className="fp-header__hint">{activeLayout.hint}</span>
        </div>
        <nav className="fp-mode-nav" aria-label="播放布局">
          {LAYOUT_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`fp-mode-btn ${fullLayout === o.id ? "fp-mode-btn--active" : ""}`}
              onClick={() => setFullLayout(o.id)}
              title={o.name}
            >
              {o.short}
            </button>
          ))}
        </nav>
        <div className="fp-header__tools">
          <button
            type="button"
            className="fp-tool-btn"
            onClick={handleAnnotate}
            title="AI 歌词译注"
            disabled={annotateLoading}
          >
            {annotateLoading ? "…" : annotatedMap.size > 0 ? "译注" : "译注"}
          </button>
          <button type="button" className="fp-close" onClick={() => setFullPlayer(false)} title="关闭 (Esc)" aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      {/* ===== cinema 模式：粒子 + 中央歌词 ===== */}
      {fullLayout === "cinema" && (
        <div className="fp-cinema">
          {/* 中央歌曲信息 */}
          <div className="fp-cinema-info">
            <div className="fp-cinema-title">{title}</div>
            <div className="fp-cinema-artist">{artist}</div>
            {aiBackground && (
              <div className="fp-ai-bg-card fp-ai-bg-card--cinema">
                <span className="fp-ai-bg-label">AI 背景</span>
                <span className="fp-ai-bg-text">{aiBackground}</span>
                <button className="fp-ai-bg-close" onClick={() => setAiBackground(null)} title="关闭" aria-label="关闭">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {/* ★ 主视觉大字锚点：对标 Mineradio 中央大字标题"标题 · 歌手" */}
          <div className="fp-cinema-hero">
            <div className="fp-cinema-hero__title">{title}</div>
            <div className="fp-cinema-hero__sep">·</div>
            <div className="fp-cinema-hero__artist">{artist}</div>
          </div>
          {/* 3D 歌词舞台（shader 化当前行主词，叠加在粒子背景之上，对标 MineRadio stageLyrics） */}
          {lines.length > 0 && activeIndex >= 0 && (
            <LyricStage3D text={lines[activeIndex].text} progress={activeProgress} />
          )}
          {/* ★ 数字年表装饰层：对标 Mineradio 下方发光数字"20051208" */}
          {(() => {
            const year = (currentTrack as { meta?: { year?: number; album?: string } })?.meta?.year;
            const stamp = year ? `${year}` : (currentTrack as any)?.meta?.album || "未知";
            return (
              <div className="fp-cinema-year">
                <span className="fp-cinema-year__label">RELEASE</span>
                <span className="fp-cinema-year__sep">·</span>
                <span className="fp-cinema-year__num">{stamp}</span>
              </div>
            );
          })()}
          {/* 底部当前歌词（1~2 行，含时间戳 + 翻译/注解） */}
          <div className="fp-cinema-lyrics">
            {lines.length > 0 && activeIndex >= 0 ? (
              (() => {
                const cur = lines[activeIndex];
                const ann = annotatedMap.get(cur.text.trim());
                return (
                  <>
                    <div className="fp-cinema-lyric-line">
                      <span className="fp-lyric-time">{fmtLyricTime(cur.time)}</span>
                      <span className="fp-lyric-content" style={lyricStyle(true, activeProgress)}>{cur.text}</span>
                    </div>
                    {cur.translation && (
                      <div className="fp-cinema-lyric-trans">{cur.translation}</div>
                    )}
                    {/* AI 译注翻译只在原生翻译缺失时补充（避免重复） */}
                    {!cur.translation && ann?.translation && (
                      <div className="fp-cinema-lyric-trans fp-cinema-lyric-trans--ai">{ann.translation}</div>
                    )}
                    {ann?.annotation && (
                      <div className="fp-cinema-lyric-annot">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginRight: 6, verticalAlign: -2 }}>
                          <path d="M12 2a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2zm-2 19a2 2 0 0 0 4 0h-4z" />
                        </svg>
                        {ann.annotation}
                      </div>
                    )}
                  </>
                );
              })()
            ) : loading ? (
              <div className="fp-cinema-lyric-line fp-cinema-lyric-line--empty">加载歌词中…</div>
            ) : (
              <div className="fp-cinema-lyric-line fp-cinema-lyric-line--empty">
                {lyricData ? "纯音乐，请欣赏" : "暂无歌词"}
              </div>
            )}
          </div>
          {/* 视觉控制台（右上角，鼠标移开隐藏） */}
          <VisualConsole />
          {/* 评论抽屉按钮（零 emoji SVG icon） */}
          <button
            className="fp-comment-toggle"
            onClick={() => setShowComments((v) => !v)}
            title="热门评论"
            aria-label="热门评论"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          {/* 评论抽屉（cinema/immersive 共用） */}
          {showComments && (
            <div className="fp-comment-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="fp-comment-drawer-head">
                <span>热门评论</span>
                <button onClick={() => setShowComments(false)} aria-label="关闭">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <CommentList songId={songId} compact />
            </div>
          )}
        </div>
      )}

      {/* ===== 其他三种模式：歌词区（共用） ===== */}
      {fullLayout !== "cinema" && (
        <div className={`fp-content fp-content--${fullLayout}`}>
          {/* 左/中：封面 + 信息 */}
          <section className={`fp-cover-section ${isPlaying ? "is-playing" : "is-paused"}`}>
            <div className="fp-cover-frame">
              <div className={`fp-cover-big ${isPlaying ? "fp-cover-big--live" : ""}`}>
                {coverUrl ? (
                  <img className="fp-cover-img" src={coverUrl} alt={title} />
                ) : (
                  <div className="fp-cover-disc"><OrangeRadioLogo size={96} animated /></div>
                )}
              </div>
            </div>
            <div className="fp-track-meta">
              <h1 className="fp-song-title">{title}</h1>
              <p className="fp-song-artist">{artist}{currentTrack?.meta.album ? ` · ${currentTrack.meta.album}` : ""}</p>
            </div>
          </section>

          {/* 右/主体：歌词滚动 */}
          <section className="fp-lyrics-section">
            {/* AI 背景卡片（译注完成后展示，可关闭） */}
            {aiBackground && (
              <div className="fp-ai-bg-card">
                <span className="fp-ai-bg-label">AI 背景</span>
                <span className="fp-ai-bg-text">{aiBackground}</span>
                <button className="fp-ai-bg-close" onClick={() => setAiBackground(null)} title="关闭" aria-label="关闭">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            )}
            {lines.length > 0 ? (
              <div className="fp-lyrics-scroll" ref={lyricScrollRef}>
                {lines.map((l, i) => {
                  const ann = annotatedMap.get(l.text.trim());
                  const hasAnnot = !!ann?.annotation;
                  const expanded = expandedLines.has(i);
                  // 当前行 offset 决定字号/不透明度递变（对标 MineRadio 上下文衰减）
                  const offset = activeIndex >= 0 ? i - activeIndex : 0;
                  const absOff = Math.abs(offset);
                  // 距离越远越淡，超过 3 行基本不可见
                  const ctxOpacity = Math.max(0.22, 1 - absOff * 0.18);
                  return (
                    <div
                      key={i}
                      ref={el => { lyricLineRefs.current[i] = el; }}
                      className={`fp-lyric-line ${i === activeIndex ? "fp-lyric-line--active" : ""} fp-lyric-line--ctx-${absOff}`}
                      data-offset={offset}
                      style={{ opacity: ctxOpacity }}
                      onClick={() => engineRef.seek(l.time)}
                      title={`跳转到 ${fmtLyricTime(l.time)}`}
                    >
                      <span className="fp-lyric-time">{fmtLyricTime(l.time)}</span>
                      <div className="fp-lyric-content">
                        <div className="fp-lyric-text" style={lyricStyle(i === activeIndex, i === activeIndex ? activeProgress : 0)}>{l.text}</div>
                        {l.translation && <div className="fp-lyric-trans">{l.translation}</div>}
                        {/* AI 译注翻译只在原生翻译缺失时补充（避免与原生翻译重复显示两行） */}
                        {!l.translation && ann?.translation && (
                          <div className="fp-lyric-trans fp-lyric-trans--ai">{ann.translation}</div>
                        )}
                        {hasAnnot && (
                          <button
                            className={`fp-annot-toggle ${expanded ? "fp-annot-toggle--on" : ""}`}
                            title="AI 注解（点击展开/收起）"
                            aria-label="AI 注解"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedLines((prev) => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i);
                                else next.add(i);
                                return next;
                              });
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <path d="M12 2a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2zm-2 19a2 2 0 0 0 4 0h-4z" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {hasAnnot && expanded && (
                        <div className="fp-lyric-annot">{ann!.annotation}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="fp-lyrics-empty">
                {loading ? "加载歌词中…" : (lyricData ? "纯音乐，请欣赏" : "暂无歌词（本地音乐歌词开发中）")}
              </div>
            )}
          </section>

          {/* triple 模式：右侧评论 */}
          {fullLayout === "triple" && (
            <section className="fp-comments-section">
              <CommentList songId={songId} />
            </section>
          )}
        </div>
      )}

      {/* 底部播控：载波进度条 */}
      <footer className="fp-controls">
        <div className="fp-controls__times">
          <span className="fp-time">{fmt(position)}</span>
          <span className="fp-time fp-time--dur">{fmt(duration)}</span>
        </div>
        <div className="fp-progress">
          <div className="fp-progress-track" />
          <div className="fp-progress-fill" style={{ width: `${progress}%` }} />
          <div className="fp-progress-glow" style={{ left: `${progress}%` }} />
          <input
            type="range" min={0} max={duration || 0} step={0.1} value={position}
            onChange={(e) => engineRef.seek(parseFloat(e.target.value))}
            className="fp-progress-input"
            aria-label="播放进度"
          />
        </div>
        <div className="fp-ctrl-btns">
          <button type="button" className="fp-ctrl-btn" onClick={() => engineRef.prev()} title="上一首" aria-label="上一首">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>
          <button type="button" className="fp-ctrl-btn fp-ctrl-btn--play" onClick={() => engineRef.toggle()} title={isPlaying ? "暂停" : "播放"} aria-label={isPlaying ? "暂停" : "播放"}>
            {isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button type="button" className="fp-ctrl-btn" onClick={() => engineRef.next()} title="下一首" aria-label="下一首">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6v12z" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
