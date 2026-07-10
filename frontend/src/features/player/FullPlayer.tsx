import { useEffect, useLayoutEffect, useState, useRef } from "react";
import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore, type FullLayout } from "../../stores/playerStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { engineRef } from "../../App";
import { CoverParticles } from "../../visual/CoverParticles";
import { BeatParticles } from "../../visual/BeatParticles";
import { LyricStage3D } from "../../visual/LyricStage3D";
import { PresetStage } from "../../visual/PresetStage";
import { useLyricMotion } from "./useLyricMotion";
import { FullPlayerRightDrawer } from "./FullPlayerRightDrawer";
import { useLyrics } from "./useLyrics";
import { getCoverUrl } from "./useCover";
import { CommentList } from "./CommentList";
import { OrangeRadioLogo } from "../../components/OrangeRadioLogo";
import { useDominantColor } from "./useDominantColor";
import { AddToPlaylistDialog } from "./AddToPlaylistDialog";
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

/** LAYOUT_OPTIONS 已抽到 ./layoutOptions.ts 复用（FullPlayer 头部展示 + 抽屉切换面板） */
import { LAYOUT_OPTIONS } from "./layoutOptions";
/** 播放模式 SVG/标签/顺序 抽到 ./playbackModes.tsx（footer 也要用模式按钮） */
import { MODE_SVG, MODE_LABELS, MODE_ORDER } from "./playbackModes";

/** 播放模式常量、标签、SVG 已抽到 ./playbackModes.tsx，供 FullPlayer / FullPlayerRightDrawer / PlayerBar 共享 */

/** 歌词数据（从网易云拉取） */
interface LyricData { raw_lrc: string; translated_lrc: string | null }

/** AI 译注失败/缺 key 时的提示方式（由 App.tsx 注入 toast；未注入时退回 alert） */
interface FullPlayerProps {
  pushToast?: (msg: string, kind?: ToastKind, ttl?: number) => void;
}

/** 进度条 + 时间显示（独立 memo 组件，只订阅 position/duration/isPlaying） */
const ProgressSection = React.memo(function ProgressSection() {
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const [scrubPos, setScrubPos] = useState<number | null>(null);
  const onProgressMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setScrubPos(x);
  };
  const notesRef = useRef<HTMLDivElement>(null);
  const progressRefFull = useRef(progress);
  useEffect(() => { progressRefFull.current = progress; }, [progress]);

  // 跳动的音符：每 1.5s 在进度条当前位置生成 ♪♫♬♩，1.5s 后自动消失
  useEffect(() => {
    const container = notesRef.current;
    if (!container) return;
    const NOTES = ["♪", "♫", "♬", "♩"];
    const COLORS = [
      "rgba(255, 107, 26, 0.95)",
      "rgba(255, 157, 69, 0.95)",
      "rgba(255, 196, 107, 0.95)",
      "rgba(244, 210, 138, 0.95)",
    ];
    const tick = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      const note = document.createElement("span");
      note.className = "fp-note";
      note.textContent = NOTES[Math.floor(Math.random() * NOTES.length)];
      note.style.left = `${(progressRefFull.current / 100) * rect.width}px`;
      note.style.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      container.appendChild(note);
      setTimeout(() => note.remove(), 1500);
    };
    // 由 isPlaying 驱动 interval 启停（替代 raw subscribe 整个 store，
    // 避免每帧 beatCam/position setState 都进回调判断）
    if (!isPlaying) return;
    const interval = window.setInterval(tick, 1500);
    tick();
    return () => window.clearInterval(interval);
  }, [isPlaying]);

  return (
    <div className="fp-progress-row">
      <span className="fp-time fp-time--cur">
        <span className="fp-time__pulse" aria-hidden />
        {fmt(position)}
      </span>
      <div
        className="fp-progress"
        style={{ "--fp-thumb-x": scrubPos != null ? `${scrubPos * 100}%` : `${progress}%` } as React.CSSProperties}
        onMouseMove={onProgressMove}
        onMouseLeave={() => setScrubPos(null)}
      >
        <div className="fp-progress__mist" aria-hidden />
        <div className="fp-progress__ticks" aria-hidden />
        <div className="fp-progress-track" />
        <div className="fp-progress-fill" style={{ width: `${progress}%` }}>
          <span className="fp-progress-shimmer" aria-hidden />
          <span className="fp-progress-edge" aria-hidden />
        </div>
        <div className="fp-progress-glow" style={{ left: `${progress}%` }} aria-hidden />
        <div className="fp-notes" ref={notesRef} aria-hidden />
        {scrubPos != null && duration > 0 && (
          <div className="fp-progress-tooltip">{fmt(scrubPos * duration)}</div>
        )}
        <input
          type="range" min={0} max={duration || 0} step={0.1} value={position}
          onChange={(e) => engineRef.seek(parseFloat(e.target.value))}
          className="fp-progress-input"
          aria-label="播放进度"
        />
      </div>
      <span className="fp-time fp-time--rem">
        <span className="fp-time__minus">−</span>
        {fmt(Math.max(0, duration - position))}
      </span>
    </div>
  );
});

export function FullPlayer({ pushToast }: FullPlayerProps = {}) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const fullLayout = usePlayerStore((s) => s.fullLayout);
  const setFullLayout = usePlayerStore((s) => s.setFullLayout);
  const setFullPlayer = usePlayerStore((s) => s.setFullPlayer);
  const fullPlayerOpacity = usePlayerStore((s) => s.visualParams.fullPlayerOpacity);
  // 字段级订阅（替代整 visualParams 对象订阅，避免无关参数变化触发重渲染）
  const lyricColor = usePlayerStore((s) => s.visualParams.lyricColor);
  const lyricColorAuto = usePlayerStore((s) => s.visualParams.lyricColorAuto);
  const preset = usePlayerStore((s) => s.visualParams.preset);
  const setVisualParams = usePlayerStore((s) => s.setVisualParams);

  // 切到"粒子律动"时默认用 BeatParticles（preset=1），避免和律动专辑同款 CoverParticles
  // 仅在用户没主动选过非 0 时生效——已经选过 1/2/3 就不覆盖
  useEffect(() => {
    if (fullLayout === "rhythmic-particles" && preset === 0) {
      setVisualParams({ preset: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullLayout]);
  const dominantColor = usePlayerStore((s) => s.dominantColor);
  const effectiveLyricColor = lyricColorAuto
    ? (dominantColor ? `rgb(${dominantColor.join(",")})` : "rgba(255,255,255,0.85)")
    : lyricColor;
  const mode = usePlayerStore((s) => s.mode);
  const setMode = usePlayerStore((s) => s.setMode);
  const volume = usePlayerStore((s) => s.volume);
  const queueOpen = usePlayerStore((s) => s.queueOpen);
  // store 没有 setVol action——直接调 engineRef.setVol（0..1）
  const setVol = (v: number) => engineRef.setVol(Math.max(0, Math.min(1, v)));
  // store 没有 setQueueOpen action——直接 setState
  const toggleQueue = () => usePlayerStore.setState({ queueOpen: !usePlayerStore.getState().queueOpen });

  // 布局选择 popover 状态已迁出（移到右侧工具抽屉 FullPlayerRightDrawer 的"播放布局"section）

  // ===== 播放模式循环（footer 左 + 抽屉都共用） =====
  const cycleMode = () => {
    const idx = MODE_ORDER.indexOf(mode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    setMode(next);
  };

  // ===== 一起听（简化：点击 toggle，不做房间弹窗，避免覆盖 fullPlayer 体验） =====
  const [inRoom, setInRoom] = useState(false);
  const toggleListenTogether = async () => {
    if (inRoom) {
      try {
        const { leaveRoom } = await import("../../lib/listenTogether");
        leaveRoom();
      } catch {}
      setInRoom(false);
    } else {
      // 提示去底部 bar 走房间流程
      pushToast?.("请在主控制台输入房间号加入", "info", 3000);
    }
  };

  // ===== 添加到歌单弹窗 =====
  const [showAddDialog, setShowAddDialog] = useState(false);

  /** cinema 舞台歌词 mount 节点 */
  const cinemaStageRef = useRef<HTMLDivElement | null>(null);
  useLyricMotion(cinemaStageRef, { mode: "cinema" });

  // 切歌时提取封面主色 → 写入 store（驱动 cinema 模式 CoverParticles / BeatParticles auto 主题）
  useDominantColor(currentTrack);

  const [lyricData, setLyricData] = useState<LyricData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [annotateLoading, setAnnotateLoading] = useState(false);
  /** Footer 折叠：只显示进度条，隐藏 3 列按钮行（▼ 切 ▲） */
  const [footerCollapsed, setFooterCollapsed] = useState(false);
  /** AI 译注结果：按原文行文本索引 → {translation, annotation} */
  const [annotatedMap, setAnnotatedMap] = useState<Map<string, { translation?: string; annotation?: string }>>(new Map());
  /** AI 歌曲整体背景（顶部卡片展示） */
  const [aiBackground, setAiBackground] = useState<string | null>(null);
  /** 展开了 annotation 的歌词行索引集合 */
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set());

  // AI 歌词情绪分析：切歌/歌词加载后自动调用，结果写入 store（懂你模式推荐用）
  const analyzeEmotion = async (lyrics: string) => {
    const key = localStorage.getItem("orangeradio_minimax_key") || "";
    if (!key) return;
    const apiBase = localStorage.getItem("orangeradio_minimax_base") || "https://api.minimaxi.com/anthropic";
    const model = localStorage.getItem("orangeradio_minimax_model") || "MiniMax-M1";
    try {
      const r = await invoke<{ mood?: string; reason?: string }>("emotion_analyze", {
        lyrics,
        apiBase,
        apiKey: key,
        model,
      });
      if (r?.mood) {
        usePlayerStore.getState().setMood(r.mood);
      }
    } catch (e) {
      console.warn("情绪分析失败:", e);
    }
  };

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
        : kind === "kugou"
        ? "kugou_lyric"
        : kind === "kuwo"
        ? "kuwo_lyric"
        : null;
    if (!cmd) {
      // 本地曲目 / 内置 demo 曲：用元数据里塞进来的 LRC 歌词
      // （本地 = lofty 读 USLT；builtin = Rust 端读 resources/demo/track.lrc）
      const lrc = (currentTrack as { meta?: { lyrics?: string | null } }).meta?.lyrics;
      if (lrc) setLyricData({ raw_lrc: lrc, translated_lrc: null });
      return;
    }
    setLoading(true);
    invoke<LyricData>(cmd, { songId: tid })
      .then((d) => {
        setLyricData(d);
        // 有歌词时自动分析情绪，驱动懂你模式 mood 与视觉主题
        const lrc = d?.raw_lrc || d?.translated_lrc;
        if (lrc) analyzeEmotion(lrc);
      })
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
  // 依赖 fullLayout：从 rhythmic-album/particles 切到歌词类布局时，歌词 DOM 会重挂载，
  // 此时 scrollTop 归零、当前行贴顶被封面/刊头盖住，必须重新居中。
  //
  // ★ lyric-stream 是纵向 column 布局，有两个坑：
  //   1) flex:1 高度结算有时延 → clientHeight 初始为 0 → 用 ResizeObserver 兜底
  //   2) ::before/::after 占位用 height:50% 在 flex column 父级里可能解析为 0（indefinite height），
  //      导致 scrollHeight 不足、首行无法滚到中间。
  //      解法：centerActiveLine 里同步设置 CSS 变量 --scroll-pad = clientHeight/2，
  //      伪元素读取该变量获得可靠的像素占位。
  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    const container = lyricScrollRef.current;
    if (!container) return;

    const centerActiveLine = () => {
      const el = lyricLineRefs.current[activeIndex];
      if (!el) return false;
      const ch = container.clientHeight;
      // clientHeight 为 0 时（容器未渲染/隐藏），跳过避免算出错误偏移
      if (ch === 0) return false;
      // ★ 同步占位高度：让 ::before/::after 各占半个视口，首/末行才能滚到中间
      container.style.setProperty("--scroll-pad", `${ch / 2}px`);
      // offsetTop 相对滚动容器内容区（含 ::before 占位），比 getBoundingClientRect 在 reflow 期间更稳
      const target = el.offsetTop - ch / 2 + el.offsetHeight / 2;
      container.scrollTo({ top: Math.max(0, target), behavior: "auto" });
      return true;
    };

    // ★ 切行瞬间锁定字号/颜色过渡，避免"先滚到目标 → 字号增大 → 视觉偏位"的串扰
    const root = document.documentElement;
    root.classList.add("fp-no-lyric-fade");

    centerActiveLine();

    // rAF 校准：消除亚像素偏差；居中成功才解锁过渡（clientHeight=0 时保持锁定等 RO）
    lyricCenterRafRef.current = requestAnimationFrame(() => {
      const ok = centerActiveLine();
      lyricCenterRafRef.current = requestAnimationFrame(() => {
        if (centerActiveLine() && ok) {
          root.classList.remove("fp-no-lyric-fade");
        }
      });
    });

    // ★ ResizeObserver：lyric-stream 等 flex 布局的容器高度结算有延迟，
    //   监听高度变化，稳定后重新居中 + 同步占位（解决"切布局后 clientHeight=0 → 贴顶"的根因）
    let stableTimer = 0;
    const ro = new ResizeObserver(() => {
      centerActiveLine();
      window.clearTimeout(stableTimer);
      stableTimer = window.setTimeout(() => {
        centerActiveLine();
        root.classList.remove("fp-no-lyric-fade");
        ro.disconnect();
      }, 120);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(lyricCenterRafRef.current);
      window.clearTimeout(stableTimer);
      ro.disconnect();
      root.classList.remove("fp-no-lyric-fade");
    };
  }, [activeIndex, lines.length, fullLayout]);

  /** 当前行平滑扫光（CSS 变量 --lyric-p 驱动渐变边界，对标 MineRadio uProgress smoothstep）
   *  不拆 span，用 background-clip:text + 渐变在 --lyric-p 位置平滑过渡，避免逐字硬切割僵硬感 */
  const lyricStyle = (isActive: boolean, progress: number): React.CSSProperties | undefined => {
    if (!isActive || progress <= 0) return undefined;
    return { ["--lyric-p" as string]: `${Math.round(progress * 1000) / 10}%` } as React.CSSProperties;
  };
  const title = currentTrack?.meta.title || "未在播放";
  const artist = currentTrack?.meta.artist || "";
  const coverUrl = getCoverUrl(currentTrack);
  const songId = currentTrack?.source_track_id || "";

  const activeLayout = LAYOUT_OPTIONS.find((o) => o.id === fullLayout)!;

  return (
    <div
      className={`fp-overlay fp-overlay--editorial fp-overlay--${fullLayout} ${
        fullLayout === "rhythmic-album" || fullLayout === "rhythmic-particles" ? "fp-overlay--solid" : ""
      }`}
      style={{ "--ui-opacity": fullPlayerOpacity, "--lyric-color": effectiveLyricColor } as React.CSSProperties}
    >
      {/* 律动专辑：固定用 CoverParticles（封面像素矩阵 + 节奏律动，参考 MineRadio coverParticleGrid） */}
      {fullLayout === "rhythmic-album" && (
        <div className="fp-particles-bg">
          <CoverParticles />
        </div>
      )}
      {/* 粒子律动：默认 BeatParticles（球面律动），可在右侧抽屉"预设"tab 切换其他视觉 */}
      {fullLayout === "rhythmic-particles" && (
        <div className="fp-particles-bg">
          <PresetStage />
        </div>
      )}
      {/* 顶部：品牌 + 工具区（布局选择移到 popover，不再占行） */}
      <header className="fp-header" data-tauri-drag-region>
        <div className="fp-header__brand">
          <span className="fp-header__eyebrow">NOW PLAYING</span>
          <span className="fp-header__mode">{activeLayout.name}</span>
          <span className="fp-header__hint">{activeLayout.hint}</span>
        </div>
        <div className="fp-header__tools" data-tauri-drag-region={false}>
          {/* 译注按钮 / 布局下拉均已迁移到右侧工具抽屉（FullPlayerRightDrawer） */}
          <button type="button" className="fp-close" onClick={() => setFullPlayer(false)} title="关闭 (Esc)" aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      {/* ===== 律动专辑 / 粒子律动：粒子背景 + 中央歌词舞台（共用同一套中心内容） ===== */}
      {(fullLayout === "rhythmic-album" || fullLayout === "rhythmic-particles") && (
        <div className={`fp-cinema fp-cinema--${fullLayout}`}>
          {/* ★ 顶部信息条：纯文字"歌名 - 歌手"居中横排（透出粒子） */}
          <div className="fp-cinema-top">
            <span className="fp-cinema-top__title">{title}</span>
            <span className="fp-cinema-top__sep">—</span>
            <span className="fp-cinema-top__artist">{artist}</span>
          </div>

          {/* ★ 中央大歌词舞台：当前行超大 + MineRadio 风格扫描光 + 暖光晕 */}
          <div className="fp-cinema-stage">
            {lines.length > 0 && activeIndex >= 0 ? (
              (() => {
                const cur = lines[activeIndex];
                const next = lines[activeIndex + 1];
                const ann = annotatedMap.get(cur.text.trim());
                return (
                  <>
                    {/* 主大字：当前行歌词字面，OrangeRadio 入场 + 冷调薄荷扫光 */}
                    <div ref={cinemaStageRef} className="fp-cinema-stage__main">
                      <div className="fp-cinema-stage__time">{fmtLyricTime(cur.time)}</div>
                      <div className="fp-cinema-stage__text-wrap">
                        <div
                          className="fp-cinema-stage__text"
                          style={lyricStyle(true, activeProgress) as React.CSSProperties}
                        >
                          {cur.text}
                        </div>
                      </div>
                      {/* 翻译/注解（紧跟主字） */}
                      {cur.translation && (
                        <div className="fp-cinema-stage__trans">{cur.translation}</div>
                      )}
                      {!cur.translation && ann?.translation && (
                        <div className="fp-cinema-stage__trans fp-cinema-stage__trans--ai">
                          {ann.translation}
                        </div>
                      )}
                      {ann?.annotation && (
                        <div className="fp-cinema-stage__annot">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginRight: 6, verticalAlign: -2 }}>
                            <path d="M12 2a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2zm-2 19a2 2 0 0 0 4 0h-4z" />
                          </svg>
                          {ann.annotation}
                        </div>
                      )}
                    </div>
                    {/* 下一行预览：弱提示节奏 */}
                    {next && (
                      <div className="fp-cinema-stage__next">
                        <span className="fp-cinema-stage__time fp-cinema-stage__time--next">{fmtLyricTime(next.time)}</span>
                        <span className="fp-cinema-stage__next-text">{next.text}</span>
                      </div>
                    )}
                  </>
                );
              })()
            ) : loading ? (
              <div className="fp-cinema-stage__hint">加载歌词中…</div>
            ) : (
              <div className="fp-cinema-stage__hint">
                {lyricData ? "纯音乐，请欣赏" : "暂无歌词"}
              </div>
            )}
          </div>

          {/* AI 背景小卡片（译注完成后展示，可关闭） */}
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
          {/* 视觉控制台已迁移到右侧工具抽屉（FullPlayerRightDrawer） */}
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
      {fullLayout !== "rhythmic-album" && fullLayout !== "rhythmic-particles" && (
        <div className={`fp-content fp-content--${fullLayout}`}>
          {/* 左/中：封面 + 信息 */}
          <section className={`fp-cover-section ${isPlaying ? "is-playing" : "is-paused"}`}>
            <div className="fp-cover-frame">
              <div className={`fp-cover-big ${isPlaying ? "fp-cover-big--live" : ""}`}>
                {coverUrl ? (
                  <img
                    key={currentTrack?.id ?? "empty"}
                    className="fp-cover-img"
                    src={coverUrl}
                    alt={title}
                  />
                ) : (
                  <div className="fp-cover-disc" key={currentTrack?.id ?? "empty"}>
                    <OrangeRadioLogo size={96} animated />
                  </div>
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

      {/* ===== 底部播控：2 行结构 =====
         Row 1 · 雾化进度条（独占一行，左右时间码）
         Row 2 · 3 列：左 模式/收藏/歌单 ｜ 中 上一首/播放/下一首 ｜ 右 队列/一起听/音量 */}
      <footer className={`fp-controls ${footerCollapsed ? "fp-controls--collapsed" : ""}`}>
        {/* 折叠按钮：固定在 footer 顶缘中央，▼ 切 ▲ 旋转 180° */}
        <button
          type="button"
          className="fp-controls__toggle"
          onClick={() => setFooterCollapsed((v) => !v)}
          title={footerCollapsed ? "展开控制台" : "折叠控制台"}
          aria-label={footerCollapsed ? "展开控制台" : "折叠控制台"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {/* ===== Row 1 · 进度条（独占一行） ===== */}
        <ProgressSection />

        {/* ===== Row 2 · 3 列控制台 ===== */}
        <div className="fp-buttons-row">
          {/* ===== 左：模式 / 收藏 / 歌单 ===== */}
          <div className="fp-group fp-group--left">
            {/* 播放模式（5 态循环） */}
            <button
              type="button"
              className={`fp-ctrl-btn ${mode === "understand_you" ? "fp-ctrl-btn--active" : ""}`}
              onClick={cycleMode}
              title={`播放模式：${MODE_LABELS[mode]}（点击切换）`}
              aria-label={`播放模式：${MODE_LABELS[mode]}`}
              style={{ "--i": 1 } as React.CSSProperties}
            >
              {MODE_SVG[mode]}
            </button>
            {/* 收藏（心） */}
            {currentTrack && (
              <button
                type="button"
                className={`fp-ctrl-btn ${currentTrack.liked ? "fp-ctrl-btn--active" : ""}`}
                onClick={async () => {
                  const track = currentTrack;
                  const next = !track.liked;
                  try {
                    if (next) {
                      await invoke("add_to_favorites", { track });
                    } else {
                      await invoke("remove_from_favorites", { track });
                    }
                    usePlayerStore.setState({ currentTrack: { ...track, liked: next } });
                    await useLibraryStore.getState().refreshTracks();
                  } catch {}
                }}
                title={currentTrack.liked ? "取消收藏" : "收藏"}
                aria-label={currentTrack.liked ? "取消收藏" : "收藏"}
                style={{ "--i": 2 } as React.CSSProperties}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={currentTrack.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
                </svg>
              </button>
            )}
            {/* 添加到歌单 */}
            {currentTrack && (
              <button
                type="button"
                className="fp-ctrl-btn"
                onClick={() => setShowAddDialog(true)}
                title="添加到歌单"
                aria-label="添加到歌单"
                style={{ "--i": 3 } as React.CSSProperties}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 12H3" />
                  <path d="M16 6H3" />
                  <path d="M11 18H3" />
                  <path d="M19 9v6" />
                  <path d="M22 12h-6" />
                </svg>
              </button>
            )}
          </div>

          {/* ===== 中：上一首 / 播放 / 下一首 ===== */}
          <div className="fp-transport">
            <button
              type="button"
              className="fp-ctrl-btn fp-ctrl-btn--side"
              onClick={() => engineRef.prev()}
              title="上一首"
              aria-label="上一首"
              style={{ "--i": 4 } as React.CSSProperties}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
              </svg>
            </button>
            <button
              type="button"
              className={`fp-ctrl-btn fp-ctrl-btn--play ${isPlaying ? "is-playing" : ""}`}
              onClick={() => engineRef.toggle()}
              title={isPlaying ? "暂停" : "播放"}
              aria-label={isPlaying ? "暂停" : "播放"}
              style={{ "--i": 5 } as React.CSSProperties}
            >
              <span className="fp-play__shape" aria-hidden>
                {isPlaying ? (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="5" width="4" height="14" rx="1.2" />
                    <rect x="14" y="5" width="4" height="14" rx="1.2" />
                  </svg>
                ) : (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </span>
            </button>
            <button
              type="button"
              className="fp-ctrl-btn fp-ctrl-btn--side"
              onClick={() => engineRef.next()}
              title="下一首"
              aria-label="下一首"
              style={{ "--i": 6 } as React.CSSProperties}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6v12z" />
              </svg>
            </button>
          </div>

          {/* ===== 右：队列 / 一起听 / 音量 ===== */}
          <div className="fp-group fp-group--right">
            {/* 播放队列 */}
            <button
              type="button"
              className={`fp-ctrl-btn ${queueOpen ? "fp-ctrl-btn--active" : ""}`}
              onClick={toggleQueue}
              title="播放列表"
              aria-label="播放列表"
              style={{ "--i": 7 } as React.CSSProperties}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15V6" />
                <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                <path d="M12 12H3" />
                <path d="M16 6H3" />
                <path d="M12 18H3" />
              </svg>
            </button>
            {/* 一起听 */}
            <button
              type="button"
              className={`fp-ctrl-btn ${inRoom ? "fp-ctrl-btn--active" : ""}`}
              onClick={toggleListenTogether}
              title={inRoom ? "已在房间中" : "一起听（请在主控制台输入房间号）"}
              aria-label="一起听"
              style={{ "--i": 8 } as React.CSSProperties}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </button>
            {/* 音量控制（图标 + 滑块） */}
            <div className="fp-vol" style={{ "--i": 9 } as React.CSSProperties}>
              <button
                type="button"
                className="fp-vol__btn"
                onClick={() => setVol(volume > 0 ? 0 : 0.8)}
                title={volume > 0 ? "静音" : "取消静音"}
                aria-label={volume > 0 ? "静音" : "取消静音"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" />
                  {volume > 0.05 && <path d="M15.5 8.5a5 5 0 0 1 0 7" />}
                  {volume > 0.45 && <path d="M18.5 5.5a9 9 0 0 1 0 13" />}
                </svg>
              </button>
              <div className="fp-vol__slider">
                <div className="fp-vol__track">
                  <div className="fp-vol__fill" style={{ width: `${Math.round(volume * 100)}%` }} />
                </div>
                <div className="fp-vol__thumb" style={{ left: `${Math.round(volume * 100)}%` }} aria-hidden />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVol(parseFloat(e.target.value))}
                  className="fp-vol__input"
                  aria-label="音量"
                />
              </div>
              <span className="fp-vol__pct">{Math.round(volume * 100)}</span>
            </div>
          </div>
        </div>
      </footer>

      {/* 右侧工具抽屉（hover 显示：播放模式 / AI 译注 / 视觉控制台） */}
      <FullPlayerRightDrawer
        onAnnotate={handleAnnotate}
        annotateLoading={annotateLoading}
        fullLayout={fullLayout}
        setFullLayout={setFullLayout}
      />

      {/* "添加到歌单" 弹窗（与 PlayerBar 共用 AddToPlaylistDialog 组件） */}
      {showAddDialog && currentTrack && (
        <AddToPlaylistDialog
          track={currentTrack}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
}
