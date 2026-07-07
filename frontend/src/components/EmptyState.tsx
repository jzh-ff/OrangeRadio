/**
 * 空状态 SVG 图标（统一替代各 View 里的 Emoji 占位符 🎵🎧📻🎙️🔍 等）
 *
 * 用法：<EmptyStateIcon kind="music" /> 或 kind="search"/"radio"/"podcast"/"spotify"
 */
type Kind = "music" | "search" | "radio" | "podcast" | "spotify";

const PATHS: Record<Kind, JSX.Element> = {
  // 音符（默认，替代 🎵🎧）
  music: (
    <>
      <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  // 搜索（替代 🔍）
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" strokeLinecap="round" />
    </>
  ),
  // 电台（替代 📻）
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" strokeLinecap="round" />
    </>
  ),
  // 播客（替代 🎙️）
  podcast: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" strokeLinecap="round" />
    </>
  ),
  // Spotify 风格（替代 🎧）
  spotify: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 10c3-1 7-1 10 1M7.5 13.5c2.5-.8 5.5-.5 8 1M8 16.5c2-.5 4-.3 6 .8" strokeLinecap="round" />
    </>
  ),
};

export function EmptyStateIcon({ kind = "music", size = 56 }: { kind?: Kind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {PATHS[kind]}
    </svg>
  );
}
