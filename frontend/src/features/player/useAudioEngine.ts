import { useRef, useCallback, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";

/**
 * Web Audio 播放引擎（v3：纯 <audio> 播放，确保有声音）
 *
 * 关键教训：createMediaElementSource 会把音频路由到 Web Audio 图，
 * 但 asset.localhost 与 tauri.localhost 不同源，CORS 限制导致静音
 * （"MediaElementAudioSource outputs zeroes due to CORS"）。
 * 且一旦接入 MediaElementSource，原 <audio> 元素就不再直接输出。
 *
 * 解决：只用 <audio> 元素播放（保证声音）。频谱可视化用模拟数据
 * （基于播放状态 + 随机波动），后续可改用 Web Audio decodeAudioData
 * 或 Rust 端频谱分析再传入。
 */
export function useAudioEngine() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  // 立即创建 audio 元素
  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
    audioRef.current.volume = 0.7;
  }

  // 模拟频谱循环（纯 <audio> 无法直接取真实频谱）
  // 后续可接 Rust 端 FFT。目前用基于播放状态的伪频谱驱动视觉。
  const loopSpectrum = useCallback(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        // 用播放进度做相位，生成有节奏感的伪频谱
        const t = audio.currentTime;
        const bands = new Array(64);
        for (let i = 0; i < 64; i++) {
          const freq = i / 64;
          // 低频强、高频弱，叠加正弦波模拟节拍
          const base = (1 - freq) * 180 + 30;
          const beat = Math.sin(t * (2 + freq * 8) + i * 0.5) * 40;
          const noise = Math.random() * 30;
          bands[i] = Math.max(0, Math.min(255, base + beat + noise));
        }
        usePlayerStore.setState({ spectrum: bands });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ===== 播放控制 =====
  const playPath = useCallback(
    async (filePath: string) => {
      const audio = audioRef.current;
      if (!audio) return;
      const url = convertFileSrc(filePath);
      audio.src = url;
      try {
        await audio.play();
        usePlayerStore.setState({ isPlaying: true });
        loopSpectrum();
      } catch (e: any) {
        console.error("[播放] 失败:", e?.message || e, "audio.error:", audio.error);
      }
    },
    [loopSpectrum]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback((secs: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = secs;
  }, []);

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current;
    if (audio) audio.volume = v;
    usePlayerStore.setState({ volume: v });
  }, []);

  const next = useCallback(() => {
    const { tracks, currentIndex, mode } = usePlayerStore.getState();
    if (tracks.length === 0) return;
    let ni: number;
    if (mode === "shuffle") {
      ni = Math.floor(Math.random() * tracks.length);
    } else if (mode === "single_loop") {
      ni = currentIndex;
    } else {
      ni = currentIndex + 1 >= tracks.length ? 0 : currentIndex + 1;
    }
    const t = tracks[ni];
    usePlayerStore.setState({ currentIndex: ni, currentTrack: t });
    playPath(t.source_track_id);
  }, [playPath]);

  const prev = useCallback(() => {
    const { tracks, currentIndex } = usePlayerStore.getState();
    if (tracks.length === 0) return;
    const pi = currentIndex - 1 < 0 ? tracks.length - 1 : currentIndex - 1;
    const t = tracks[pi];
    usePlayerStore.setState({ currentIndex: pi, currentTrack: t });
    playPath(t.source_track_id);
  }, [playPath]);

  // ===== 事件监听 =====
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => usePlayerStore.setState({ position: audio.currentTime });
    const onMeta = () => usePlayerStore.setState({ duration: audio.duration || 0 });
    const onPlay = () => usePlayerStore.setState({ isPlaying: true });
    const onPause = () => usePlayerStore.setState({ isPlaying: false });
    const onEnd = () => {
      usePlayerStore.setState({ isPlaying: false });
      next();
    };
    const onError = () => {
      console.error("[audio error]", audio.error);
      usePlayerStore.setState({ isPlaying: false });
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onError);
      cancelAnimationFrame(rafRef.current);
    };
  }, [next]);

  return { playPath, togglePlay, seek, setVolume, next, prev };
}
