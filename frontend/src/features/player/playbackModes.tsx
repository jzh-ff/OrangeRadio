/**
 * 播放模式常量 + 图标 + 文案（FullPlayer 与 PlayerBar 共用）
 * 抽到独立文件避免两个组件 import 顺序循环。
 */
import type { PlaybackMode } from "../../stores/playerStore";

export const MODE_ORDER: PlaybackMode[] = [
  "sequence",
  "list_loop",
  "single_loop",
  "shuffle",
  "understand_you",
];

export const MODE_LABELS: Record<PlaybackMode, string> = {
  sequence: "顺序播放",
  list_loop: "列表循环",
  single_loop: "单曲循环",
  shuffle: "随机播放",
  understand_you: "AI 懂你",
};

/** 紧凑 SVG 图标 —— 18px 圆角矩形容器内放对应形态的线条 */
export const MODE_SVG: Record<PlaybackMode, React.ReactNode> = {
  sequence: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 4l14 8L5 20V4z" />
    </svg>
  ),
  list_loop: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  single_loop: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">1</text>
    </svg>
  ),
  shuffle: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 3h5v5" />
      <path d="M4 20l17-17" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6" />
      <path d="M4 4l5 5" />
    </svg>
  ),
  understand_you: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a4 4 0 0 0-4 4v1a3 3 0 0 0-3 3v.5" />
      <path d="M19 10.5V10a3 3 0 0 0-3-3V6a4 4 0 0 0-4-4" />
      <path d="M5 14a7 7 0 0 0 14 0" />
      <circle cx="9" cy="13" r="1" fill="currentColor" />
      <circle cx="15" cy="13" r="1" fill="currentColor" />
      <path d="M9 17h6" />
    </svg>
  ),
};
