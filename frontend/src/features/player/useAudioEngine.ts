import { useRef, useCallback, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";

/**
 * Web Audio 播放引擎（v4：真实频谱）
 *
 * 播放：用 <audio> 元素直接播放（保证声音，不接 MediaElementSource 避免 CORS 静音）。
 *
 * 频谱：用 captureStream() + createMediaStreamSource() 绕过 CORS taint，
 * 取真实实时频谱驱动视觉。
 *   - captureStream 在媒体渲染层捕获，不受 createMediaElementSource 的同源限制
 *   - 对不支持 captureStream 的环境，回退到模拟频谱
 */
export function useAudioEngine() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const graphOkRef = useRef(false);

  // 立即创建 audio 元素
  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
    audioRef.current.volume = 0.7;
  }

  // 尝试用 captureStream 建立真实频谱分析（绕过 CORS）
  const tryConnectRealSpectrum = useCallback(() => {
    if (graphOkRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      // captureStream（部分浏览器带 webkit 前缀）
      const stream = (audio as any).captureStream
        ? (audio as any).captureStream()
        : (audio as any).webkitCaptureStream
        ? (audio as any).webkitCaptureStream()
        : null;
      if (!stream) {
        console.warn("[频谱] captureStream 不支持，回退模拟");
        return;
      }
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
      }
      const analyser = ctxRef.current.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.82;
      const src = ctxRef.current.createMediaStreamSource(stream);
      src.connect(analyser);
      // 注意：不连 destination（声音已由 <audio> 输出，避免双重发声）
      analyserRef.current = analyser;
      graphOkRef.current = true;
      console.log("[频谱] 真实频谱已连接（captureStream）");
    } catch (e) {
      console.warn("[频谱] 真实频谱连接失败，回退模拟:", e);
      graphOkRef.current = false;
    }
  }, []);

  // 频谱采样循环（真实优先，回退模拟）
  const loopSpectrum = useCallback(() => {
    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser && graphOkRef.current) {
        // 真实频谱
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        usePlayerStore.setState({ spectrum: Array.from(data) });
      } else {
        // 回退：模拟频谱
        const audio = audioRef.current;
        if (audio && !audio.paused) {
          const t = audio.currentTime;
          const bands = new Array(64);
          for (let i = 0; i < 64; i++) {
            const freq = i / 64;
            const base = (1 - freq) * 180 + 30;
            const beat = Math.sin(t * (2 + freq * 8) + i * 0.5) * 40;
            const noise = Math.random() * 30;
            bands[i] = Math.max(0, Math.min(255, base + beat + noise));
          }
          usePlayerStore.setState({ spectrum: bands });
        }
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
      // 网络 URL 直接用；本地路径走 asset 协议
      const url = /^https?:\/\//i.test(filePath) ? filePath : convertFileSrc(filePath);
      audio.src = url;
      try {
        await audio.play();
        usePlayerStore.setState({ isPlaying: true });
        // 播放后尝试连接真实频谱（延迟，确保 captureStream 就绪）
        setTimeout(() => {
          tryConnectRealSpectrum();
          if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
          loopSpectrum();
        }, 150);
      } catch (e: any) {
        console.error("[播放] 失败:", e?.message || e, "audio.error:", audio.error);
      }
    },
    [tryConnectRealSpectrum, loopSpectrum]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) audio.play();
    else audio.pause();
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
