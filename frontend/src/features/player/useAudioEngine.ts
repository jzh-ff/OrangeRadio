import { useRef, useCallback, useEffect } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import type { Track } from "../../stores/libraryStore";
import { recordPlayback } from "../../lib/playback";

/**
 * 把后端返回的播放源 URL 转成 webview 实际能加载的 URL。
 *
 * 三种情况：
 * 1. `http(s)://` 直链 —— 原样返回（网易云 / 电台 / 远端 URL）。
 * 2. 自定义协议 `<scheme>://localhost/...`（QQ 音乐的 `orangeradio://localhost/qqstream?url=...`）——
 *    Tauri 2 在 Windows/Android 上把自定义协议路由成 `http://<scheme>.localhost/...`，
 *    直接喂 `orangeradio://` 给 `<audio>` 既不被识别、又被 convertFileSrc 误包成 asset URL，
 *    这是 QQ 音乐“双击播放没反应”的根因。这里按平台拼正确形式。
 * 3. 其他（本地文件路径）—— 走 convertFileSrc（asset 协议）。
 */
function toWebviewUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const m = raw.match(/^([a-z][a-z0-9+.-]*):\/\/localhost\//i);
  if (m) {
    const scheme = m[1].toLowerCase();
    const rest = raw.slice(m[0].length); // 保留 path?query
    const isWinLike =
      navigator.userAgent.includes("Windows") || /Android/i.test(navigator.userAgent);
    return isWinLike
      ? `http://${scheme}.localhost/${rest}`
      : `${scheme}://localhost/${rest}`;
  }
  return convertFileSrc(raw);
}

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
export function useAudioEngine(autoNext?: () => void) {
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

  // 频谱采样循环（真实优先，回退模拟）+ 节拍图谱回放
  const loopSpectrum = useCallback(() => {
    const tick = () => {
      // 节拍图谱回放（优先于实时检测：预知 hit 时间点，消除"慢半拍"）
      const audio = audioRef.current;
      const { beatmap, beatmapIndex } = usePlayerStore.getState();
      if (beatmap && beatmap.length > 0 && audio) {
        const t = audio.currentTime;
        const cur = usePlayerStore.getState().beat;
        let intensity = cur.intensity * 0.92; // 命中后指数衰减
        let bass = cur.bass;
        let body = cur.mid;
        let treble = cur.treble;
        let isBeat = intensity > 0.3;
        let combo = cur.currentCombo;
        let idx = beatmapIndex;
        while (idx < beatmap.length && beatmap[idx].time <= t) {
          const hit = beatmap[idx];
          intensity = Math.max(intensity, hit.impact);
          bass = hit.low;
          body = hit.body;
          treble = hit.snap;
          combo = hit.combo;
          isBeat = true;
          idx++;
        }
        if (
          idx !== beatmapIndex ||
          isBeat !== cur.isBeat ||
          Math.abs(intensity - cur.intensity) > 0.01
        ) {
          usePlayerStore.setState({
            beatmapIndex: idx,
            beat: { isBeat, bass, mid: body, treble, intensity, currentCombo: combo },
          });
        }
      }
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
      // 网络 URL / 自定义协议（orangeradio://）/ 本地路径 统一在此归类
      const url = toWebviewUrl(filePath);
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

  // next/prev 只选歌 + 设置 currentTrack，实际播放由 onTrackChange 回调处理
  // 这样网易云/QQ可以在回调里先解析播放地址
  const next = useCallback((onPlay?: (track: any, index: number) => void) => {
    const { tracks, currentIndex, mode, currentTrack } = usePlayerStore.getState();
    // 顺序/循环的兜底选歌
    const fallback = () => {
      if (tracks.length === 0) return;
      const ni = currentIndex + 1 >= tracks.length ? 0 : currentIndex + 1;
      const t = tracks[ni];
      usePlayerStore.setState({ currentIndex: ni, currentTrack: t });
      if (onPlay) onPlay(t, ni);
      else playPath(t.source_track_id);
    };
    // 懂你模式：异步拉推荐（基于用户画像 + 跳过反馈）
    if (mode === "understand_you") {
      void invoke<Track[]>("recommend_next", {
        limit: 1,
        currentTrackId: (currentTrack as { id?: string } | null)?.id,
      })
        .then((list) => {
          if (list[0]) {
            usePlayerStore.setState({ currentTrack: list[0], currentIndex: -1 });
            if (onPlay) onPlay(list[0], -1);
            else playPath(list[0].source_track_id);
          } else {
            fallback();
          }
        })
        .catch(() => fallback());
      return;
    }
    if (tracks.length === 0) return;
    if (mode === "shuffle") {
      const ni = Math.floor(Math.random() * tracks.length);
      const t = tracks[ni];
      usePlayerStore.setState({ currentIndex: ni, currentTrack: t });
      if (onPlay) onPlay(t, ni);
      else playPath(t.source_track_id);
      return;
    }
    if (mode === "single_loop") {
      const t = tracks[currentIndex];
      usePlayerStore.setState({ currentTrack: t });
      if (onPlay) onPlay(t, currentIndex);
      else playPath(t.source_track_id);
      return;
    }
    fallback(); // sequence / list_loop
  }, [playPath]);

  const prev = useCallback((onPlay?: (track: any, index: number) => void) => {
    const { tracks, currentIndex } = usePlayerStore.getState();
    if (tracks.length === 0) return;
    const pi = currentIndex - 1 < 0 ? tracks.length - 1 : currentIndex - 1;
    const t = tracks[pi];
    usePlayerStore.setState({ currentIndex: pi, currentTrack: t });
    if (onPlay) onPlay(t, pi);
    else playPath(t.source_track_id);
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
      recordPlayback(true, false); // 自然播完 = 正反馈
      if (autoNext) autoNext();
      else next();
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
