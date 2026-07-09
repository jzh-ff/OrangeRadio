import { useEffect, useRef } from "react";
import { readBeat } from "../../stores/spectrumBus";
import { useVisibleRaf } from "../../hooks/useVisibleRaf";

/**
 * 歌词整体随 beat 呼吸/抖动。
 *
 * 本 hook 是 MineRadio `desktop-lyrics.html` 第 834-872 行 `updateMotion` + `applyStageMotion`
 * 的逐行搬迁。算法常数与符号都对齐，下面每一行公式都标了对应的 MineRadio 行号，便于核对。
 *
 * 关键设计点：
 *  1. **本地 beat 用 Math.pow(sin, 8)** —— 把平缓 sin 抬成尖峰，让歌词"踹一下"，
 *     而非柔顺起伏。这是 MineRadio 视觉效果的核心之一。
 *  2. **非对称 ADSR (up rate 0.62, down rate 0.18)** —— "上得快、回得慢"，让 scale / lift
 *     出现后慢慢退回 base，符合鼓头冲击 + 余韵。
 *  3. **floatY / floatX 用 ±9.8 / ±6.2 本地 sin** —— 即便 beat 为 0 也会持续漂浮，
 *     不会变成死寂画面。
 *  4. **filter: brightness / saturate** —— 给整个歌词元素加亮度摆动。
 *  5. **--lyric-beat-glow** 暴露给 CSS，供 text-shadow / drop-shadow 增量使用。
 *
 * 入参 sampleInterval（仅 overlay 模式有效）允许 desktop-lyrics 用节流过的 beatIntensity
 * 驱动；主窗口 useFrame 链路 sampleInterval=0。
 *
 * 性能：使用 useVisibleRaf，后台/不可见时暂停动画计算。
 */
type SampleOpts = {
  /** 0..1 beat intensity（detector 命中瞬间为 1, 后续指数衰减） */
  intensity?: number;
  /** 0..1 低频能量（驱动 bass 分量） */
  bass?: number;
  /** 0..1 高亮 solar/glow 上界（来自主窗口 stageLyrics.highBloom） */
  highBloom?: number;
};

export type LyricMode = "immersive" | "cinema" | "overlay";

export function useLyricMotion(
  ref: React.MutableRefObject<HTMLElement | null>,
  opts?: { mode?: LyricMode; sample?: SampleOpts }
) {
  const mode = opts?.mode ?? "immersive";
  const live = useRef({ solar: 0, beat: 0, bass: 0, scale: 1, lift: 0, glow: 0 });

  useVisibleRaf(
    () => {
      const nowSec = performance.now() / 1000;
      const beat = readBeat();
      const intensity = clamp(opts?.sample?.intensity ?? beat.intensity, 0, 1.4);
      const bass = clamp(opts?.sample?.bass ?? beat.bass, 0, 1.2);
      const highBloom = clamp(opts?.sample?.highBloom ?? 0, 0, 1.45);

      // ===== MineRadio:834 updateMotion =====
      const beatSource = Math.max(highBloom, intensity * 0.86);
      const localBeat = Math.pow(Math.max(0, Math.sin(nowSec * 2.35)), 8)
        * (mode === "overlay" ? 0.10 : 0.44);
      const cameraBeat = Math.max(beatSource, localBeat);

      const fallbackSolar =
        0.18 +
        (0.5 + 0.5 * Math.sin(nowSec * 1.05)) * 0.16 +
        Math.max(bass * 0.32, cameraBeat * 0.12) +
        cameraBeat * 1.18;

      const solarTarget = Math.min(
        1.45,
        Math.max(highBloom, fallbackSolar * 0.56 + localBeat * 0.18)
      );
      const beatTarget = Math.min(1.35, Math.max(cameraBeat, localBeat));

      live.current.solar = lerp(
        live.current.solar, solarTarget, solarTarget > live.current.solar ? 0.36 : 0.10
      );
      live.current.beat = lerp(
        live.current.beat, beatTarget, beatTarget > live.current.beat ? 0.62 : 0.18
      );
      live.current.bass = lerp(live.current.bass, bass, 0.22);

      // ===== MineRadio:854 applyStageMotion =====
      const motionBeat = live.current.beat;
      const motionSolar = live.current.solar;
      const motionBass = live.current.bass;
      const targetLift = clamp(
        motionBeat * 18 + motionSolar * 5.2 + motionBass * 4.4,
        0, 22
      );
      live.current.lift = lerp(
        live.current.lift, targetLift, targetLift > live.current.lift ? 0.46 : 0.16
      );

      const floatY = Math.sin(nowSec * 1.08) * -9.8 + Math.sin(nowSec * 2.10 + 0.7) * 3.1;
      const floatX = Math.sin(nowSec * 0.70 + 0.4) * 6.2 + Math.sin(nowSec * 1.18 + 1.1) * 2.6;
      const bobY = floatY - live.current.lift;
      const bobX = floatX + Math.sin(nowSec * 1.55) * motionBeat * 3.4;
      const rotX = Math.sin(nowSec * 0.86 + 0.2) * 3.25 - motionBeat * 0.92;
      const rotY = Math.sin(nowSec * 0.74 + 1.3) * -2.75 + motionBeat * 0.34;
      const scaleTarget = 1 + motionBeat * 0.115 + motionSolar * 0.034 + motionBass * 0.026;
      live.current.scale = lerp(
        live.current.scale, scaleTarget, scaleTarget > live.current.scale ? 0.46 : 0.16
      );

      const el = ref.current;
      if (el) {
        const transform =
          `translate3d(${bobX.toFixed(2)}px,${bobY.toFixed(2)}px,0) ` +
          `rotateX(${rotX.toFixed(3)}deg) rotateY(${rotY.toFixed(3)}deg) ` +
          `scale(${live.current.scale.toFixed(4)})`;
        el.style.transform = transform;
        if (mode !== "overlay") {
          el.style.filter =
            `brightness(${(1.04 + motionBeat * 0.12 + motionSolar * 0.05).toFixed(3)}) ` +
            `saturate(${(1.08 + motionBeat * 0.10).toFixed(3)})`;
        }
        el.style.setProperty(
          "--lyric-beat-glow",
          clamp(motionBeat * 8 + motionSolar * 3, 0, 12).toFixed(2) + "px"
        );
      }
    },
    { enabled: true, pauseOnHidden: true }
  );
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
