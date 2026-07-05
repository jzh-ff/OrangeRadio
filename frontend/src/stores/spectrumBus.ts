/**
 * 频谱 / 节拍实时数据通道（高性能零拷贝 bus）
 *
 * 背景：早期把 `spectrum`（64-bin FFT，每帧变化）和 `beat` 写进 Zustand store，
 * 每秒 ~60 次 `setState` 新建数组，引发：
 *  - 订阅 spectrum 的组件（HeroSpectrum / RightWaveFlow / SpectrumPulse）每帧重渲染；
 *  - 其中两个 canvas 组件的 useEffect 依赖数组含 spectrum，每帧 teardown+重建 RAF/ResizeObserver；
 *  - 主线程被 React 渲染 + GC 占满 → WebView2 无响应（卡死，日志 `0x8007139F`）。
 *
 * 方案：高频瞬时态走模块级同步 bus，消费方（canvas / Three.js / 节拍检测）
 * 在各自的 RAF / useFrame 里主动 `readSpectrum()`，不再经过 React 状态。
 * 全程复用同一份 Uint8Array，零分配、零 GC、零重渲染。
 */
import type { BeatState } from "./playerStore";

/** 频谱 bin 数量（与 AnalyserNode.fftSize=128 → frequencyBinCount=64 对齐） */
export const SPECTRUM_BIN_COUNT = 64;

// ===== 频谱（Uint8Array，复用，永远不替换引用）=====
const spectrumBuf: Uint8Array = new Uint8Array(SPECTRUM_BIN_COUNT);

// ===== 节拍快照（对象复用，外部读取后不应缓存引用）=====
const beatBuf: BeatState = {
  isBeat: false,
  bass: 0,
  mid: 0,
  treble: 0,
  intensity: 0,
  currentCombo: null,
};

/**
 * 写入频谱数据（由 useAudioEngine 在 RAF 里每帧调用）。
 * 直接 copy 进复用缓冲区，不分配新对象。
 */
export function writeSpectrum(data: Uint8Array): void {
  const n = Math.min(data.length, spectrumBuf.length);
  for (let i = 0; i < n; i++) spectrumBuf[i] = data[i];
  // 多出的高位清零（避免上一首残留）
  for (let i = n; i < spectrumBuf.length; i++) spectrumBuf[i] = 0;
}

/**
 * 读取频谱数据（返回复用缓冲区的引用；调用方只读，不修改）。
 * 消费方应在自己的 RAF / useFrame 里逐帧拉取，不要缓存。
 */
export function readSpectrum(): Uint8Array {
  return spectrumBuf;
}

/** 写入节拍快照（由 useAudioEngine 图谱回放 / useBeatDetector 实时检测调用） */
export function writeBeat(b: Partial<BeatState>): void {
  if (b.isBeat !== undefined) beatBuf.isBeat = b.isBeat;
  if (b.bass !== undefined) beatBuf.bass = b.bass;
  if (b.mid !== undefined) beatBuf.mid = b.mid;
  if (b.treble !== undefined) beatBuf.treble = b.treble;
  if (b.intensity !== undefined) beatBuf.intensity = b.intensity;
  if (b.currentCombo !== undefined) beatBuf.currentCombo = b.currentCombo;
}

/**
 * 读取节拍快照（返回复用对象引用；调用方只读，不修改）。
 * 注意：返回的是同一对象，读取后立即用，不要跨帧缓存。
 */
export function readBeat(): BeatState {
  return beatBuf;
}

/** 重置频谱与节拍（切歌 / 停止时调用，清掉残留视觉） */
export function resetSpectrumBus(): void {
  for (let i = 0; i < spectrumBuf.length; i++) spectrumBuf[i] = 0;
  beatBuf.isBeat = false;
  beatBuf.bass = 0;
  beatBuf.mid = 0;
  beatBuf.treble = 0;
  beatBuf.intensity = 0;
  beatBuf.currentCombo = null;
}
