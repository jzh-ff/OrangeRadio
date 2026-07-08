/**
 * FullPlayer 布局选择常量（5 种）
 *  - rhythmic-album    律动专辑（封面粒子方阵 · 随节奏律动）
 *  - rhythmic-particles 粒子律动（漂浮粒子 · 电影运镜随节奏）
 *  - immersive         沉浸双栏（封面 + 歌词并排）
 *  - lyric-stream      歌词流（歌词主导阅读视图）
 *  - triple            三栏详情（歌词 + 评论并列）
 */
import type { FullLayout } from "../../stores/playerStore";

export const LAYOUT_OPTIONS: { id: FullLayout; short: string; name: string; hint: string; icon: string }[] = [
  { id: "rhythmic-album",    short: "律动专辑", name: "律动专辑",   hint: "封面粒子方阵 · 随节奏律动",   icon: "M3 3h18v18H3z M3 9h18 M9 3v18" },
  { id: "rhythmic-particles", short: "粒子律动", name: "粒子律动",   hint: "漂浮粒子 · 电影运镜随节奏",   icon: "M12 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM5 15l0.5 1.5L7 17l-1.5 0.5L5 19l-0.5-1.5L3 17l1.5-0.5zM19 15l0.5 1.5L21 17l-1.5 0.5L19 19l-0.5-1.5L17 17l1.5-0.5z" },
  { id: "immersive",         short: "沉浸",    name: "沉浸双栏",   hint: "封面与歌词并排",          icon: "M3 3h8v18H3z M11 3h10v18H11z" },
  { id: "lyric-stream",      short: "歌词",    name: "歌词流",     hint: "歌词主导的阅读视图",      icon: "M4 6h16M4 12h16M4 18h10" },
  { id: "triple",            short: "三栏",    name: "三栏详情",   hint: "歌词 + 评论并列",          icon: "M3 3h5v18H3z M8 3h7v18H8z M15 3h6v18H15z" },
];
