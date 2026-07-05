import { useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/playerStore";

interface RightWaveFlowProps {
  /** bar 数量（横向排列的条数），默认 56 */
  bars?: number;
  /** 容器高度（px），默认 160 */
  height?: number;
  /** 透明度 0-1，默认 0.95 */
  intensity?: number;
}

/**
 * RightWaveFlow —— 从右往左的音频震动
 *
 * 设计：把 spectrum 的"实时一帧"看作最右侧最新的一根 bar，
 *       之后逐帧把整组 bar 向左推一格。最新的能量永远出现在最右侧，
 *       老的能量向左"流出"，形成方向感明确的声波瀑布。
 *
 * 数据源：usePlayerStore.spectrum（useAudioEngine 的 RAF 里写的 64-bin FFT）
 * - 数据是真实的：Web Audio AnalyserNode + captureStream 绕过 CORS
 * - 不播放时降到一个低值底（避免"画布消失"），同时透明度也压低
 *
 * 渲染：用 canvas 2D。N 根 bar 排一行，三色渐变（橙→金→薄荷，与品牌主色一致），
 *       顶部叠 2px 亮横线做"峰值小帽"表示节拍撞击，伴随轻微 glow 模糊。
 *
 * 性能：仅每帧 fillRect，整组件为单个 canvas 节点；DPR 上限 2，避免在 4K 屏
 *       上把 56 根 8x160 的 bar 也撑成 16x320 的双倍数组。
 */
export function RightWaveFlow({ bars = 56, height = 160, intensity = 0.95 }: RightWaveFlowProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrum = usePlayerStore((s) => s.spectrum);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  // history：长度 = bars，最右（index = bars - 1）是最新能量
  const historyRef = useRef<Float32Array>(new Float32Array(bars));
  const rafRef = useRef<number>(0);
  const tickCountRef = useRef(0);

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
      tickCountRef.current++;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const data = spectrum;
      const binCount = data.length;

      // === 推进 history（每 1 ~ 2 帧向左推一次，营造"瀑布"流速）===
      // tickCountRef.current & 1：每 2 帧推 1 格（≈ 30 fps @ 60Hz），
      // 让每个 bar 在画面上停留 ~ 90ms（视觉上"听得到"变化）
      if ((tickCountRef.current & 1) === 0) {
        // 整组左移 1 位（最左被丢弃，最右填新值）
        const hist = historyRef.current;
        hist.copyWithin(0, 1); // [0..bars-2] -> [1..bars-1]，丢掉 hist[0]
        // 新值：从 spectrum 取一个特征值（用能量中位 bin，更"响"）
        let amp = 0;
        if (data.length) {
          // 取中频段（binCount*0.1 ~ binCount*0.5）平均，最像"鼓/吉他/歌声"
          const a = Math.max(1, Math.floor(binCount * 0.08));
          const b = Math.min(binCount, Math.floor(binCount * 0.45));
          let sum = 0;
          let n = 0;
          for (let i = a; i < b; i++) {
            sum += data[i] || 0;
            n++;
          }
          amp = n ? sum / n : 0;
        }
        // 不播放时压到低值底（约 12/255），产生"待机呼吸"
        if (!isPlaying) amp = Math.min(amp, 14);
        hist[bars - 1] = amp;
      }

      // === 绘制 bar ===
      const hist = historyRef.current;
      const gap = 2;
      const totalGap = gap * (bars - 1);
      const barW = Math.max(1, (w - totalGap) / bars);
      const peakDecay = 0.94;
      const peakRef = (canvas as unknown as { _peaks?: Float32Array })._peaks || new Float32Array(bars);
      (canvas as unknown as { _peaks?: Float32Array })._peaks = peakRef;

      // 透明全局：暂停时再压一档，避免静止时闪
      const baseAlpha = isPlaying ? intensity : intensity * 0.45;
      ctx.globalAlpha = baseAlpha;

      for (let i = 0; i < bars; i++) {
        const v = hist[i] / 255; // 0..1
        const barH = Math.max(2, v * (h - 8));
        const x = i * (barW + gap);
        const y = h - barH;

        // 三色渐变（橙→金→薄荷），与 HeroSpectrum 同色温
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, "rgba(255, 107, 26, 0.85)");
        grad.addColorStop(0.55, "rgba(255, 196, 107, 0.95)");
        grad.addColorStop(1, "rgba(0, 245, 212, 0.9)");
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);

        // 顶部柔光：节拍撞击时的小亮块（fast 衰减）
        const peakPrev = peakRef[i] || 0;
        const peakNext = Math.max(barH, peakPrev * peakDecay);
        peakRef[i] = peakNext;
        if (peakNext > 4) {
          ctx.fillStyle = "rgba(244, 210, 138, 0.95)";
          ctx.fillRect(x, h - peakNext - 2, barW, 2);
        }
      }

      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [spectrum, isPlaying, bars, intensity]);

  return (
    <div className="home-hero__wave" aria-hidden style={{ height }}>
      <canvas ref={canvasRef} className="home-hero__wave-canvas" />
      <span className="home-hero__wave-label">FLOW · 92.6</span>
    </div>
  );
}
