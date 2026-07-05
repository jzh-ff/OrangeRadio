import { memo } from "react";
import { usePlayerStore } from "../stores/playerStore";

/**
 * 极简脉冲点音谱
 *
 * 替代侧边栏顶部原 logo 区。5 个圆点横排，亮度/缩放跟随实时频谱跳动。
 *
 * 数据来源：playerStore.spectrum（64-bin，0~255，由 useAudioEngine 每帧写入）。
 * 分组策略：把 64 个频段按对数划分成 5 组（偏重低频，更贴合鼓点律动），
 * 每组取平均能量归一化到 0~1，通过 CSS 变量 --pulse-1..5 传给 CSS。
 *
 * 未播放时（isPlaying=false）所有点回退到静态低亮度，不抖动。
 *
 * 性能：用 usePlayerStore 订阅，spectrum 每帧更新 → 组件每帧重渲，
 * 但 DOM 只有 5 个 dot 的 style 变化，开销极小。
 */
const DOT_COUNT = 5;

/** 频段分组边界（对数分布，前段窄后段宽，偏重低频律动） */
const BAND_EDGES = [0, 3, 8, 16, 28, 64];

function SpectrumPulseImpl() {
  const spectrum = usePlayerStore((s) => s.spectrum);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  // 计算每个点的强度（0~1）
  const intensities: number[] = [];
  for (let i = 0; i < DOT_COUNT; i++) {
    const start = BAND_EDGES[i];
    const end = BAND_EDGES[i + 1];
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < spectrum.length; j++) {
      sum += spectrum[j];
      n++;
    }
    const avg = n > 0 ? sum / n : 0;
    // 归一化到 0~1（spectrum 上限 255，但实际低频常到 200+，做柔和映射）
    intensities.push(Math.min(1, avg / 180));
  }

  const style = {
    "--pulse-1": intensities[0] ?? 0,
    "--pulse-2": intensities[1] ?? 0,
    "--pulse-3": intensities[2] ?? 0,
    "--pulse-4": intensities[3] ?? 0,
    "--pulse-5": intensities[4] ?? 0,
  } as React.CSSProperties;

  return (
    <div
      className={`sidebar__pulse ${isPlaying ? "sidebar__pulse--live" : ""}`}
      style={style}
      aria-hidden
    >
      {Array.from({ length: DOT_COUNT }, (_, i) => (
        <span key={i} className="sidebar__pulse-dot" />
      ))}
    </div>
  );
}

export const SpectrumPulse = memo(SpectrumPulseImpl);
