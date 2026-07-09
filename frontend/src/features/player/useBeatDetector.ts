import { useEffect, useRef } from "react";
import { usePlayerStore, type BeatCombo, type BeatHit } from "../../stores/playerStore";
import { readSpectrum, readBeat, writeBeat } from "../../stores/spectrumBus";
import { scheduleBeatCameraFromHit } from "../../lib/beatCam";
import { engineRef } from "../../App";

/**
 * 纯前端实时节拍检测 Hook
 *
 * 算法灵感来自 Mineradio 的 dj-analyzer.js（服务端低频带通 + 能量阈值），
 * 但纯客户端实现：直接消费 AnalyserNode 产出的 spectrum（64 频段），
 * 用滑动窗口的"均值 + 标准差"判定低频能量突变 → 节拍。
 *
 * 频段划分（spectrum 有 64 个 bin，fftSize=128 → binCount=64）：
 *   - bass:   bin 0~3   （极低频，kick/底鼓）
 *   - mid:    bin 4~16  （中频，人声/吉他主体）
 *   - treble: bin 17~63 （高频，镲片/空气感）
 *
 * 把结果写入 spectrumBus.beat，供视觉层（BeatParticles 等）消费。
 * 检测到节拍时，若当前没有 beatmap，则合成 BeatHit 入队 BeatCam 事件，驱动电影镜头。
 */

/** 根据实时三频能量给一个镜头角色（对标 beatCam.ts 的 combo 语义） */
function classifyLiveCombo(bass: number, mid: number, treble: number): BeatCombo {
  if (treble > bass * 1.3 && treble > mid * 1.1) return "accent";
  if (mid > bass * 1.2) return "push";
  return "downbeat";
}

/** 无参：通过 engineRef.getCurrentTime() 拿到当前音频时间，避免闭包陈旧 */
export function useBeatDetector() {
  const rafRef = useRef<number>(0);
  // 历史低频能量滑动窗口（用于计算局部均值/方差）
  const historyRef = useRef<number[]>([]);
  // 节拍冷却时间戳（ms），防止一次鼓点多次触发
  const lastBeatRef = useRef<number>(0);
  // 节拍强度（命中=1，每帧指数衰减）
  const intensityRef = useRef<number>(0);
  const HISTORY_LEN = 43; // ~1 秒（@43fps）

  useEffect(() => {
    const tick = () => {
      const { isPlaying, visualParams } = usePlayerStore.getState();
      const spectrum = readSpectrum();
      const beat = readBeat();
      const sens = visualParams.sensitivity;

      // 节拍图谱存在时，由 useAudioEngine.loopSpectrum 负责按时间轴回放，实时检测退出
      if (usePlayerStore.getState().beatmap) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (!isPlaying || spectrum.length === 0) {
        // 不播放时：能量衰减归零，清空历史
        if (beat.intensity > 0.001 || beat.bass > 0.001) {
          writeBeat({ isBeat: false, intensity: 0, bass: 0, mid: 0, treble: 0 });
        }
        historyRef.current = [];
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // ===== 1. 计算三频段能量（归一化到 0~1） =====
      let bassSum = 0;
      for (let i = 0; i < 4 && i < spectrum.length; i++) bassSum += spectrum[i];
      const bass = bassSum / (4 * 255);

      let midSum = 0;
      for (let i = 4; i < 17 && i < spectrum.length; i++) midSum += spectrum[i];
      const mid = midSum / (13 * 255);

      let trebleSum = 0;
      const trebleCount = Math.max(1, spectrum.length - 17);
      for (let i = 17; i < spectrum.length; i++) trebleSum += spectrum[i];
      const treble = trebleSum / (trebleCount * 255);

      // ===== 2. 节拍检测（低频能量突变） =====
      const history = historyRef.current;
      history.push(bass);
      if (history.length > HISTORY_LEN) history.shift();

      let isBeat = false;
      if (history.length >= 10) {
        // 局部均值
        let sum = 0;
        for (const v of history) sum += v;
        const mean = sum / history.length;
        // 局部方差
        let varSum = 0;
        for (const v of history) varSum += (v - mean) * (v - mean);
        const stddev = Math.sqrt(varSum / history.length);

        // 阈值 = 均值 + 灵敏度×标准差；同时要求绝对能量足够（避免静音段误判）
        const threshold = mean + sens * stddev;
        const now = performance.now();
        if (
          bass > threshold &&
          bass > 0.04 &&            // 绝对能量门槛
          bass > mean * 1.15 &&     // 比均值高 15% 以上
          now - lastBeatRef.current > 220 // 冷却 220ms（≈最块 272 BPM）
        ) {
          isBeat = true;
          lastBeatRef.current = now;
          intensityRef.current = Math.min(1, (bass - mean) / (stddev + 0.001) * 0.4 + 0.6);
        }
      }

      // ===== 3. 节拍强度指数衰减 =====
      intensityRef.current *= 0.92; // 每帧衰减 8%
      if (isBeat) {
        // 命中时拉到峰值（与衰减后的值取大者，避免抖动）
        intensityRef.current = Math.max(intensityRef.current, 1);
      }
      const intensity = Math.max(0, Math.min(1, intensityRef.current));

      // 写入频谱 bus（不再每帧写 store，避免高频 setState）
      writeBeat({ isBeat, bass, mid, treble, intensity, currentCombo: null });

      // ===== 4. 无 beatmap 时，把检测到的节拍合成 BeatCam 事件入队，驱动电影镜头 =====
      // 每帧调 engineRef.getCurrentTime()，不捕获闭包，避免 0 noop 永远生效
      if (isBeat) {
        const t = engineRef.getCurrentTime();
        const hit: BeatHit = {
          time: t,
          impact: intensity,
          low: bass,
          body: mid,
          snap: treble,
          combo: classifyLiveCombo(bass, mid, treble),
        };
        const ev = scheduleBeatCameraFromHit(hit, t);
        usePlayerStore.getState().pushBeatCamEvent(ev);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);
}
