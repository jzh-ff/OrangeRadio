/**
 * FullPlayer 布局选择常量（5 种）
 *  - rhythmic-album    律动专辑（封面粒子方阵 · 随节奏律动）
 *  - rhythmic-particles 粒子律动（漂浮粒子 · 电影运镜随节奏）
 *  - immersive         沉浸黑胶（圆形黑胶旋转 + 歌词流并排）
 *  - lyric-stream      歌词长卷（歌词主导阅读视图 · 顶部紧凑黑胶横条）
 *  - triple            杂志三栏（黑胶 / 歌词 / 评论 三栏并列）
 */
import type { FullLayout } from "../../stores/playerStore";

export const LAYOUT_OPTIONS: { id: FullLayout; short: string; name: string; hint: string; icon: string }[] = [
  { id: "rhythmic-album",    short: "律动专辑", name: "律动专辑",   hint: "封面粒子方阵 · 随节奏律动",   icon: "M3 3h18v18H3z M3 9h18 M9 3v18" },
  { id: "rhythmic-particles", short: "粒子律动", name: "粒子律动",   hint: "漂浮粒子 · 电影运镜随节奏",   icon: "M12 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM5 15l0.5 1.5L7 17l-1.5 0.5L5 19l-0.5-1.5L3 17l1.5-0.5zM19 15l0.5 1.5L21 17l-1.5 0.5L19 19l-0.5-1.5L17 17l1.5-0.5z" },
  { id: "immersive",         short: "沉浸黑胶", name: "沉浸黑胶",   hint: "圆形黑胶旋转 · 封面歌词并排", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M21 12h-6 M3 12h6" },
  { id: "lyric-stream",      short: "歌词长卷", name: "歌词长卷",   hint: "歌词主导的沉浸阅读视图",      icon: "M4 6h16M4 12h16M4 18h10" },
  { id: "triple",            short: "杂志三栏", name: "杂志三栏",   hint: "黑胶 · 歌词 · 评论 三栏并列", icon: "M3 3h5v18H3z M8 3h7v18H8z M15 3h6v18H15z" },
];
