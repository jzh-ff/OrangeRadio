import { useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { writeSpectrum, writeBeat, readBeat, resetSpectrumBus } from "../../stores/spectrumBus";
import type { Track } from "../../stores/libraryStore";
import { recordPlayback } from "../../lib/playback";
import { getLlmConfig } from "../../lib/llmConfig";
import { toWebviewUrl } from "../../lib/webviewUrl";
import { scheduleBeatCameraFromHit, updateBeatCam, smoothBeatCam } from "../../lib/beatCam";

// 模拟频谱复用缓冲（避免每帧 new Array/Uint8Array 造成 GC 压力）
const SIM_SPECTRUM_BUF = new Uint8Array(64);

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
  // 保存 MediaStreamSource 节点引用，用于卸载时 disconnect（避免 Web Audio 资源泄漏）
  const srcNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

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
      srcNodeRef.current = src; // 保存以便卸载时断开
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
        const cur = readBeat();
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
          // ★ 同步入队 BeatCam 事件（驱动电影运镜 ADSR 包络）
          const ev = scheduleBeatCameraFromHit(hit, t);
          usePlayerStore.getState().pushBeatCamEvent(ev);
          idx++;
        }
        if (
          idx !== beatmapIndex ||
          isBeat !== cur.isBeat ||
          Math.abs(intensity - cur.intensity) > 0.01
        ) {
          // beatmapIndex 仍写 store（低频：仅在 hit 推进时变化，供回放游标判别）；
          // beat 高频快照走 bus，避免每帧 setState
          usePlayerStore.setState({ beatmapIndex: idx });
          writeBeat({ isBeat, bass, mid: body, treble, intensity, currentCombo: combo });
        }
      }
      const analyser = analyserRef.current;
      if (analyser && graphOkRef.current) {
        // 真实频谱：复用缓冲区，直接写 bus（不走 store，零分配）
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        writeSpectrum(data);
      } else {
        // 回退：模拟频谱（写入复用缓冲，不 setState）
        const audio = audioRef.current;
        if (audio && !audio.paused) {
          const t = audio.currentTime;
          for (let i = 0; i < SIM_SPECTRUM_BUF.length; i++) {
            const freq = i / SIM_SPECTRUM_BUF.length;
            const base = (1 - freq) * 180 + 30;
            const beat = Math.sin(t * (2 + freq * 8) + i * 0.5) * 40;
            const noise = Math.random() * 30;
            SIM_SPECTRUM_BUF[i] = Math.max(0, Math.min(255, base + beat + noise));
          }
          writeSpectrum(SIM_SPECTRUM_BUF);
        }
      }

      // ★ BeatCam 推进：每帧遍历事件队列算 ADSR → 平滑 → 写 5 通道 state
      //    （无 beatmap 时事件队列为空，state 全 0；CinematicCamera 自然不抖）
      const beatCamSt = usePlayerStore.getState();
      const audioForBeatCam = audioRef.current;
      const audioTimeForBeatCam = audioForBeatCam ? audioForBeatCam.currentTime : 0;
      const paused = audioForBeatCam?.paused ?? true;
      const { newEvents, state: rawTarget } = updateBeatCam(beatCamSt.beatCamEvents, audioTimeForBeatCam);
      const prevSt = beatCamSt.beatCam;
      let smoothed: typeof prevSt;
      if (paused) {
        // 暂停时快速归零（对标 Mineradio 4896-4900：punch *= 0.08^dt）
        smoothed = {
          punch: prevSt.punch * 0.08,
          thetaKick: prevSt.thetaKick * 0.05,
          phiKick: prevSt.phiKick * 0.05,
          radiusKick: prevSt.radiusKick * 0.05,
          rollKick: prevSt.rollKick * 0.05,
        };
      } else {
        smoothed = smoothBeatCam(prevSt, rawTarget);
      }
      // 仅在变化时写 store（避免每帧触发 React 重渲染）
      const changed =
        Math.abs(smoothed.punch - prevSt.punch) > 0.0005 ||
        Math.abs(smoothed.thetaKick - prevSt.thetaKick) > 0.0005 ||
        Math.abs(smoothed.phiKick - prevSt.phiKick) > 0.0005 ||
        Math.abs(smoothed.radiusKick - prevSt.radiusKick) > 0.0005 ||
        Math.abs(smoothed.rollKick - prevSt.rollKick) > 0.0005;
      if (changed || newEvents.length !== beatCamSt.beatCamEvents.length) {
        usePlayerStore.setState({
          beatCamEvents: newEvents,
          beatCam: smoothed,
        });
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
    const st = usePlayerStore.getState();
    const { mode, currentTrack } = st;
    // 队列路由：电台走 radioTracks/radioIndex，单曲走 tracks/currentIndex
    const isRadio = st.activeQueue === "radio";
    const list = isRadio ? st.radioTracks : st.tracks;
    const idx = isRadio ? st.radioIndex : st.currentIndex;
    const setIdx = (i: number) =>
      usePlayerStore.setState(isRadio ? { radioIndex: i } : { currentIndex: i });
    // 顺序/循环的兜底选歌
    const fallback = () => {
      if (list.length === 0) return;
      const ni = idx + 1 >= list.length ? 0 : idx + 1;
      const t = list[ni];
      setIdx(ni);
      usePlayerStore.setState({ currentTrack: t });
      if (onPlay) onPlay(t, ni);
      else playPath(t.source_track_id);
    };
    // 懂你模式：异步拉推荐（基于用户画像 + 跳过反馈 + 当前情绪，仅单曲队列生效）
    if (mode === "understand_you" && !isRadio) {
      const mood = usePlayerStore.getState().mood;
      void invoke<Track[]>("recommend_next", {
        limit: 1,
        currentTrackId: (currentTrack as { id?: string } | null)?.id,
        mood,
        llmConfig: getLlmConfig(),
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
    if (list.length === 0) return;
    if (mode === "shuffle") {
      const ni = Math.floor(Math.random() * list.length);
      const t = list[ni];
      setIdx(ni);
      usePlayerStore.setState({ currentTrack: t });
      if (onPlay) onPlay(t, ni);
      else playPath(t.source_track_id);
      return;
    }
    if (mode === "single_loop") {
      const t = list[idx];
      usePlayerStore.setState({ currentTrack: t });
      if (onPlay) onPlay(t, idx);
      else playPath(t.source_track_id);
      return;
    }
    fallback(); // sequence / list_loop
  }, [playPath]);

  const prev = useCallback((onPlay?: (track: any, index: number) => void) => {
    const st = usePlayerStore.getState();
    const isRadio = st.activeQueue === "radio";
    const list = isRadio ? st.radioTracks : st.tracks;
    const idx = isRadio ? st.radioIndex : st.currentIndex;
    if (list.length === 0) return;
    const pi = idx - 1 < 0 ? list.length - 1 : idx - 1;
    const t = list[pi];
    usePlayerStore.setState(isRadio ? { radioIndex: pi } : { currentIndex: pi });
    usePlayerStore.setState({ currentTrack: t });
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
      // 释放 Web Audio 资源：断开节点 + 关闭 AudioContext（避免多次重载累积泄漏）
      try {
        srcNodeRef.current?.disconnect();
      } catch { /* 已断开 */ }
      try {
        analyserRef.current?.disconnect();
      } catch { /* 已断开 */ }
      // 重置频谱 bus，清掉残留视觉
      resetSpectrumBus();
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        ctxRef.current.close().catch(() => { /* 忽略关闭失败 */ });
      }
    };
  }, [next]);

  const hasSrc = useCallback(() => !!audioRef.current?.src, []);
  const getCurrentTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  return { playPath, togglePlay, hasSrc, seek, setVolume, next, prev, getCurrentTime };
}
