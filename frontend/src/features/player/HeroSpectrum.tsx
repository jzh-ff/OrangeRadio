import { useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/playerStore";
import { readSpectrum } from "../../stores/spectrumBus";

interface HeroSpectrumProps {
  /** 频谱条数量（默认 64，跟 store spectrum 数组长度对齐） */
  bars?: number;
  /** 容器高度（px），默认 56 */
  height?: number;
}

/**
 * Hero Live 频谱条
 * 从 spectrumBus 拉取实时频谱（useAudioEngine 已经在 RAF 里写入 64-bin FFT），
 * 用 canvas 2D 画「对数频率分布」的频谱条贴在 hero 顶部。
 *
 * 性能：spectrum 走 bus 不经过 React 状态，本组件不会因频谱每帧变化而重渲染；
 *      内部 draw 循环在 RAF 里直接 readSpectrum() 绘制。
 *
 * 设计要点：
 * - 对数频率映射（Math.pow(f, 1.6)）：低频占更多横向空间，高频收窄（人耳对低频更敏感）
 * - 三色渐变（橙→金→薄荷）：和品牌主色保持一致
 * - 峰值小帽子：每根条顶部一个快速衰减的小亮块，体现节奏感
 * - 暂停时画静态低值（不空 canvas，避免「画布消失」突兀感）
 */
export function HeroSpectrum({ bars = 64, height = 56 }: HeroSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const rafRef = useRef<number>(0);
  const peaksRef = useRef<Float32Array>(new Float32Array(bars));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const data = readSpectrum();
      const binCount = data.length;
      const stepX = w / bars;
      const barW = Math.max(2, stepX * 0.72);
      const peakDecay = 0.93;

      for (let i = 0; i < bars; i++) {
        // 对数频率映射：低频段占更多横向空间
        const f = i / bars;
        const idx = Math.min(binCount - 1, Math.floor(Math.pow(f, 1.55) * binCount));
        const raw = data[idx] || 0;
        // 不播放时把值大幅压低 + 加一点呼吸感
        const v = isPlaying ? raw / 255 : Math.max(0.04, raw / 255) * 0.25;
        const barH = Math.max(2, v * (h - 12));
        const x = i * stepX + (stepX - barW) / 2;
        const y = h - barH;

        // 三色渐变（橙→金→薄荷）
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, "rgba(255, 107, 26, 0.55)");
        grad.addColorStop(0.5, "rgba(255, 196, 107, 0.85)");
        grad.addColorStop(1, "rgba(0, 245, 212, 0.92)");
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);

        // 峰值小帽子（顶部 2px 亮色横条，体现节拍）
        const peakPrev = peaksRef.current[i] || 0;
        const peakNext = Math.max(barH, peakPrev * peakDecay);
        peaksRef.current[i] = peakNext;
        if (peakNext > 4) {
          ctx.fillStyle = "rgba(244, 210, 138, 0.95)";
          ctx.fillRect(x, h - peakNext - 2, barW, 2);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [isPlaying, bars]);

  return (
    <div className="hero-spectrum" aria-hidden style={{ height }}>
      <canvas ref={canvasRef} className="hero-spectrum__canvas" />
      <div className="hero-spectrum__hint">
        <span className="hero-spectrum__label">SPECTRUM · 92.6 MHz</span>
        <span className={`hero-spectrum__indicator ${isPlaying ? "is-live" : ""}`} />
      </div>
    </div>
  );
}