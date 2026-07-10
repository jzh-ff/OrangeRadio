/**
 * 主页沉浸模式（Immersive View）v2
 *
 * 进入后：
 *   - 隐藏侧栏 / 顶栏 / 底栏 / 导航 / 壁纸侧栏工具
 *   - 全屏展示：可选背景源（专辑封面 / 我的壁纸 / 动态粒子 / 纯色）
 *   - 中央巨字歌词舞台，支持字号/对齐/翻译切换
 *   - 悬浮控制面板：背景源 + 歌词样式
 *   - Esc 退出 / Space 播放暂停 / ←→ 快进快退
 */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { useLyrics } from "./useLyrics";
import { getCoverUrl } from "./useCover";
import { engineRef } from "../../App";
import { useLyricMotion } from "./useLyricMotion";
import { ImmersiveBackground } from "./immersive/ImmersiveBackground";
import { ImmersiveControls } from "./immersive/ImmersiveControls";
import "../../styles/immersive.css";

interface LyricData { raw_lrc: string; translated_lrc: string | null }

const fmt = (s: number) => {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
};

export function ImmersiveView() {
  const immersiveMode = usePlayerStore((s) => s.immersiveMode);
  const setImmersiveMode = usePlayerStore((s) => s.setImmersiveMode);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const vp = usePlayerStore((s) => s.visualParams);
  const dominantColor = usePlayerStore((s) => s.dominantColor);
  // AUTO 模式：主色 + 暖白 60:40 混合（深色主色下仍可读），同时给一个保底亮度
  const effectiveLyricColor = vp.lyricColorAuto
    ? (dominantColor
        ? `color-mix(in oklch, rgb(${dominantColor.join(",")}) 60%, #fff7e0 40%)`
        : "#fff7e0")
    : vp.lyricColor;

  const [lyricData, setLyricData] = useState<LyricData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const headerTimer = useRef<number>(0);

  // 拉歌词（网易云 / QQ / 酷狗 / 酷我 / 歌曲宝 / Spotify跨源 / 本地内嵌）
  useEffect(() => {
    if (!immersiveMode || !currentTrack) { setLyricData(null); return; }
    const tid = (currentTrack as { source_track_id?: string }).source_track_id || currentTrack.id;
    const kind = (currentTrack as { source_kind?: string }).source_kind;
    const cmd = kind === "netease_cloud_music" ? "netease_lyric"
      : kind === "qq_music" ? "qqmusic_lyric"
      : kind === "kugou" ? "kugou_lyric"
      : kind === "kuwo" ? "kuwo_lyric"
      : kind === "gequbao" ? "gequbao_lyric"
      : kind === "spotify" ? "spotify_lyric"
      : null;
    if (!cmd) {
      const lrc = (currentTrack as { meta?: { lyrics?: string | null } }).meta?.lyrics;
      setLyricData(lrc ? { raw_lrc: lrc, translated_lrc: null } : null);
      return;
    }
    setLoading(true);
    // Spotify 走跨源歌词匹配，需要 title + artist
    const params = kind === "spotify"
      ? { title: currentTrack.meta?.title || "", artist: currentTrack.meta?.artist || "" }
      : { songId: tid };
    invoke<LyricData>(cmd, params)
      .then(setLyricData)
      .catch(() => setLyricData(null))
      .finally(() => setLoading(false));
  }, [immersiveMode, currentTrack]);

  // 切歌时清空旧歌词
  useEffect(() => { setLyricData(null); }, [currentTrack?.id]);

  const { lines, activeIndex, activeProgress } = useLyrics(lyricData?.raw_lrc ?? null, lyricData?.translated_lrc ?? null);

  // 滚动容器 + 当前行 ref（自动滚动到当前行居中，同时挂载 beat 呼吸效果）
  const listRef = useRef<HTMLDivElement>(null);
  const beatLyricsRef = useRef<HTMLDivElement | null>(null);
  useLyricMotion(beatLyricsRef, { mode: "immersive" });

  useEffect(() => {
    if (!immersiveMode) return;
    const container = listRef.current;
    const activeLine = beatLyricsRef.current;
    if (!container || !activeLine) return;
    const target = activeLine.offsetTop - container.clientHeight / 2 + activeLine.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeIndex, immersiveMode]);

  // 键盘：Esc 退出 / Space 播放暂停 / ←→ 快进快退
  useEffect(() => {
    if (!immersiveMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setImmersiveMode(false);
      } else if (e.code === "Space") {
        e.preventDefault();
        engineRef.toggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        engineRef.seek(position + 5);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        engineRef.seek(Math.max(0, position - 5));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [immersiveMode, setImmersiveMode, position]);

  // 浏览器全屏被用户手动退出时（如按 Esc），同步退出沉浸模式
  useEffect(() => {
    if (!immersiveMode) return;
    const onFull = () => {
      if (!document.fullscreenElement) {
        setImmersiveMode(false);
      }
    };
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, [immersiveMode, setImmersiveMode]);

  // 鼠标移动时显示 header，静止 3 秒后隐藏
  const onActivity = () => {
    setShowHeader(true);
    if (headerTimer.current) window.clearTimeout(headerTimer.current);
    headerTimer.current = window.setTimeout(() => setShowHeader(false), 3000);
  };

  useEffect(() => {
    if (!immersiveMode) return;
    onActivity();
    return () => {
      if (headerTimer.current) window.clearTimeout(headerTimer.current);
    };
  }, [immersiveMode]);

  // 进入/退出沉浸模式时同步全屏：Tauri 原生优先，浏览器环境回退到 DOM fullscreen
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await win.setFullscreen(immersiveMode);
        const isFull = await win.isFullscreen();
        if (!cancelled) {
          document.body.classList.toggle("window-fullscreen", isFull);
        }
        if (isFull !== immersiveMode) {
          console.warn("[沉浸模式] Tauri setFullscreen 返回值与预期不一致", { expected: immersiveMode, actual: isFull });
        }
        return;
      } catch (e) {
        console.warn("[沉浸模式] Tauri 全屏不可用，回退到 DOM fullscreen:", e);
      }
      // 浏览器/非 Tauri 环境回退
      try {
        if (immersiveMode) {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
          }
        } else {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          }
        }
      } catch (e) {
        console.warn("[沉浸模式] DOM fullscreen 失败:", e);
      }
    };
    void sync();
    return () => {
      cancelled = true;
    };
  }, [immersiveMode]);

  if (!immersiveMode) return null;

  const cover = getCoverUrl(currentTrack);
  const title = (currentTrack as { meta?: { title?: string } })?.meta?.title || "沉浸模式";
  const artist = (currentTrack as { meta?: { artist?: string } })?.meta?.artist || "";

  const alignClass = vp.immersiveLyricAlign === "left" ? "immersive__lyrics--left" : "";
  const sizeClass = `immersive__stack--${vp.immersiveLyricSize}`;

  return (
    <div
      className={`immersive ${isPlaying ? "is-playing" : "is-paused"}`}
      role="dialog"
      aria-label="沉浸播放模式"
      style={{ "--immersive-lyric-color": effectiveLyricColor } as React.CSSProperties}
      onMouseMove={onActivity}
      onClick={() => setShowControls(false)}
    >
      {/* 背景层 */}
      <ImmersiveBackground />

      {/* 顶部信息条 */}
      <header className={`immersive__head ${showHeader ? "immersive__head--visible" : ""}`}>
        <div className="immersive__cover">
          {cover ? (
            <img src={cover} alt={title} className={`immersive__cover-img ${isPlaying ? "is-spin" : ""}`} />
          ) : (
            <div className="immersive__cover-fallback">♪</div>
          )}
        </div>
        <div className="immersive__meta">
          <div className="immersive__eyebrow">NOW PLAYING · IMMERSIVE</div>
          <div className="immersive__title">{title}</div>
          <div className="immersive__artist">{artist}</div>
        </div>
        <button
          type="button"
          className="immersive__exit"
          onClick={() => setImmersiveMode(false)}
          title="退出沉浸 (Esc)"
          aria-label="退出沉浸"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {/* 中央歌词舞台：MineRadio 风格——当前行居中超大 + 扫描光 + 暖光晕；上 1 / 下 1 弱预览 */}
      <main className="immersive__stage" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="immersive__hint">载入歌词中…</div>
        ) : lines.length === 0 ? (
          <div className="immersive__hint">{lyricData ? "纯音乐，请欣赏" : "暂无歌词"}</div>
        ) : (
          <div className={`immersive__stack ${alignClass} ${sizeClass}`}>
            {/* 上一行预览 */}
            {activeIndex > 0 && (
              <div className="immersive__prev">
                <span className="immersive__prev-time">{fmt(lines[activeIndex - 1].time)}</span>
                <span className="immersive__prev-text">{lines[activeIndex - 1].text}</span>
              </div>
            )}
            {/* 当前行：OrangeRadio 入场 + 扫描光 + 薄荷冷调光晕（与 FullPlayer stage 同源） */}
            <div
              ref={beatLyricsRef}
              className="immersive__current"
              style={activeProgress > 0 ? ({
                "--lyric-p": `${Math.round(activeProgress * 1000) / 10}%`,
                "--i": activeIndex,
                "--ry": `${(activeIndex % 2 === 0 ? 1 : -1) * 8}deg`,
              } as React.CSSProperties) : ({
                "--i": activeIndex,
                "--ry": `${(activeIndex % 2 === 0 ? 1 : -1) * 8}deg`,
              } as React.CSSProperties)}
            >
              <div className="immersive__current-time">{fmt(lines[activeIndex].time)}</div>
              <div className="immersive__current-text-wrap">
                <div className="immersive__current-text">{lines[activeIndex].text}</div>
              </div>
              {vp.immersiveShowTranslation && lines[activeIndex].translation && (
                <div className="immersive__current-trans">{lines[activeIndex].translation}</div>
              )}
            </div>
            {/* 下一行预览 */}
            {activeIndex < lines.length - 1 && (
              <div className="immersive__next">
                <span className="immersive__next-time">{fmt(lines[activeIndex + 1].time)}</span>
                <span className="immersive__next-text">{lines[activeIndex + 1].text}</span>
              </div>
            )}
          </div>
        )}
        <div className="immersive__fade immersive__fade--top" aria-hidden />
        <div className="immersive__fade immersive__fade--bottom" aria-hidden />
      </main>

      {/* 底部进度条（hover / 活动时显示） */}
      <footer className={`immersive__footer ${showHeader ? "immersive__footer--visible" : ""}`}>
        <div className="immersive__progress">
          <div className="immersive__progress-bar" style={{ width: `${duration > 0 ? (position / duration) * 100 : 0}%` }} />
        </div>
        <div className="immersive__time">
          <span>{fmt(position)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </footer>

      {/* 控制面板触发按钮 */}
      <button
        type="button"
        className={`immersive__controls-trigger ${showControls ? "immersive__controls-trigger--active" : ""}`}
        onClick={(e) => { e.stopPropagation(); setShowControls((v) => !v); }}
        title="沉浸设置"
        aria-label="沉浸设置"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* 控制面板 */}
      {showControls && (
        <div className="immersive__controls-overlay" onClick={(e) => e.stopPropagation()}>
          <ImmersiveControls />
        </div>
      )}
    </div>
  );
}
