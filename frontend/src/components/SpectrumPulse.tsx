import { memo, useEffect, useRef } from "react";
import { usePlayerStore } from "../stores/playerStore";
import { readSpectrum } from "../stores/spectrumBus";

/**
 * 极简脉冲点音谱
 *
 * 替代侧边栏顶部原 logo 区。5 个圆点横排，亮度/缩放跟随实时频谱跳动。
 *
 * 数据来源：spectrumBus（64-bin，0~255，由 useAudioEngine 每帧写入）。
 * 分组策略：把 64 个频段按对数划分成 5 组（偏重低频，更贴合鼓点律动），
 * 每组取平均能量归一化到 0~1，通过 CSS 变量 --pulse-1..5 传给 CSS。
 *
 * 未播放时（isPlaying=false）所有点回退到静态低亮度，不抖动。
 *
 * 性能：spectrum 走 bus，本组件不订阅 spectrum（不再每帧重渲染）；
 *      用一个 RAF 直接把强度写进根节点的 CSS 变量，DOM 只有 5 个 dot。
 */
const DOT_COUNT = 5;

/** 频段分组边界（对数分布，前段窄后段宽，偏重低频律动） */
const BAND_EDGES = [0, 3, 8, 16, 28, 64];

/** CSS 变量名缓存（避免每次拼接字符串） */
const CSS_VARS = ["--pulse-1", "--pulse-2", "--pulse-3", "--pulse-4", "--pulse-5"] as const;

function SpectrumPulseImpl() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      const spectrum = readSpectrum();
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
        const v = Math.min(1, avg / 180);
        el.style.setProperty(CSS_VARS[i], String(v));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={rootRef}
      className={`sidebar__pulse ${isPlaying ? "sidebar__pulse--live" : ""}`}
      aria-hidden
    >
      {Array.from({ length: DOT_COUNT }, (_, i) => (
        <span key={i} className="sidebar__pulse-dot" />
      ))}
    </div>
  );
}

export const SpectrumPulse = memo(SpectrumPulseImpl);
