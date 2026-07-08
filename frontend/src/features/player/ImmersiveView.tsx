/**
 * 主页沉浸模式（Immersive View）
 *
 * 进入后：
 *   - 隐藏侧栏 / 顶栏 / 底栏 / 导航 / 壁纸侧栏工具
 *   - 全屏展示：封面作为模糊壁纸背景 + 中央巨字歌词舞台
 *   - 歌词随播放进度自动滚动、当前行高亮
 *   - Esc / 右上角 × 退出
 *
 * 跟 FullPlayer cinema 模式的核心差异：
 *   - cinema 模式在 FullPlayer overlay 内部，是"全屏播放详情页"的一个布局
 *   - 沉浸模式是**整个 app** 切换到只展示壁纸+歌词，隐藏所有 chrome
 */
import { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { useLyrics } from "./useLyrics";
import { getCoverUrl } from "./useCover";
import { engineRef } from "../../App";
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

  const [lyricData, setLyricData] = useState<LyricData | null>(null);
  const [loading, setLoading] = useState(false);

  // 拉歌词（与 FullPlayer cinema 模式同源：netease / qqmusic / 本地内嵌）
  useEffect(() => {
    if (!immersiveMode || !currentTrack) { setLyricData(null); return; }
    const tid = (currentTrack as { source_track_id?: string }).source_track_id || currentTrack.id;
    const kind = (currentTrack as { source_kind?: string }).source_kind;
    const cmd = kind === "netease_cloud_music" ? "netease_lyric"
      : kind === "qq_music" ? "qqmusic_lyric"
      : null;
    if (!cmd) {
      const lrc = (currentTrack as { meta?: { lyrics?: string | null } }).meta?.lyrics;
      setLyricData(lrc ? { raw_lrc: lrc, translated_lrc: null } : null);
      return;
    }
    setLoading(true);
    invoke<LyricData>(cmd, { songId: tid })
      .then(setLyricData)
      .catch(() => setLyricData(null))
      .finally(() => setLoading(false));
  }, [immersiveMode, currentTrack]);

  // 切歌时清空旧歌词
  useEffect(() => { setLyricData(null); }, [currentTrack?.id]);

  const { lines, activeIndex } = useLyrics(lyricData?.raw_lrc ?? null, lyricData?.translated_lrc ?? null);

  // 滚动容器 + 当前行 ref（自动滚动到当前行居中）
  const listRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!immersiveMode) return;
    const container = listRef.current;
    const activeLine = activeLineRef.current;
    if (!container || !activeLine) return;
    // 计算目标 scrollTop：让当前行垂直居中
    const target = activeLine.offsetTop - container.clientHeight / 2 + activeLine.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeIndex, immersiveMode]);

  // Esc 退出 / Space 播放暂停
  useEffect(() => {
    if (!immersiveMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setImmersiveMode(false);
      } else if (e.code === "Space") {
        e.preventDefault();
        engineRef.toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [immersiveMode, setImmersiveMode]);

  if (!immersiveMode) return null;

  const cover = getCoverUrl(currentTrack);
  const title = (currentTrack as { meta?: { title?: string } })?.meta?.title || "沉浸模式";
  const artist = (currentTrack as { meta?: { artist?: string } })?.meta?.artist || "";

  return (
    <div className="immersive" role="dialog" aria-label="沉浸播放模式">
      {/* 背景：封面 blur 60px + 黑色渐变叠层（保证歌词可读） */}
      <div className="immersive__bg">
        {cover && <img src={cover} alt="" className="immersive__bg-img" />}
        <div className="immersive__bg-mask" />
      </div>

      {/* 顶部标题区（cover + title + artist） */}
      <header className="immersive__head">
        <div className="immersive__cover">
          {cover ? (
            <img src={cover} alt={title} className={`immersive__cover-img ${isPlaying ? "is-spin" : ""}`} key={currentTrack?.id ?? "empty"} />
          ) : (
            <div className="immersive__cover-fallback">♪</div>
          )}
        </div>
        <div className="immersive__meta">
          <div className="immersive__eyebrow">NOW PLAYING · IMMERSIVE</div>
          <div className="immersive__title">{title}</div>
          <div className="immersive__artist">{artist}</div>
        </div>
        {/* 退出按钮（右上角） */}
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

      {/* 歌词舞台：居中、当前行大字高亮、四周渐变淡出 */}
      <main className="immersive__stage" ref={listRef}>
        <div className="immersive__lyrics">
          {loading ? (
            <div className="immersive__hint">载入歌词中…</div>
          ) : lines.length === 0 ? (
            <div className="immersive__hint">{lyricData ? "纯音乐，请欣赏" : "暂无歌词"}</div>
          ) : (
            lines.map((line, i) => {
              const isActive = i === activeIndex;
              const dist = Math.abs(i - activeIndex);
              return (
                <div
                  key={`${currentTrack?.id ?? "x"}-${i}`}
                  ref={isActive ? activeLineRef : undefined}
                  className={`immersive__line ${isActive ? "is-active" : ""} ${
                    !isActive && dist === 1 ? "is-near" : ""
                  } ${!isActive && dist === 2 ? "is-far" : ""} ${
                    !isActive && dist > 2 ? "is-farther" : ""
                  }`}
                >
                  {isActive && <span className="immersive__line-time">{fmt(line.time)}</span>}
                  <span className="immersive__line-text">{line.text}</span>
                </div>
              );
            })
          )}
        </div>
        {/* 上下淡出蒙层（让歌词边缘自然淡出） */}
        <div className="immersive__fade immersive__fade--top" aria-hidden />
        <div className="immersive__fade immersive__fade--bottom" aria-hidden />
      </main>
    </div>
  );
}
