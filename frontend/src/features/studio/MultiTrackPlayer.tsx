import { useEffect, useRef, useState, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

interface TrackInfo {
  /** 轨道名称（人声版/纯伴奏版） */
  label: string;
  /** 本地文件路径 */
  path: string;
  /** 颜色（用于波形/音量条标识） */
  color: string;
}

interface MultiTrackPlayerProps {
  tracks: TrackInfo[];
}

/**
 * 多轨同步播放器（Web Audio API 实现）
 *
 * - 多个轨道共享播放进度（通过同步 currentTime）
 * - 每轨独立音量滑块 + 静音/独奏
 * - 统一播放/暂停/进度条
 *
 * 注意：MiniMax 两次生成的旋律有随机差异，此播放器用于试听人声/伴奏对比，
 * 非精确混音。多轨同步精度约 ±50ms（浏览器 audio 元素限制）。
 */
export function MultiTrackPlayer({ tracks }: MultiTrackPlayerProps) {
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([]);
  const gainRefs = useRef<GainNode[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumes, setVolumes] = useState<number[]>(tracks.map(() => 1));
  const [muted, setMuted] = useState<boolean[]>(tracks.map(() => false));
  const [soloed, setSoloed] = useState<boolean[]>(tracks.map(() => false));

  // 初始化 Web Audio API（每个 audio 元素 → MediaElementSource → GainNode → destination）
  useEffect(() => {
    if (tracks.length === 0) return;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    gainRefs.current = [];

    audioRefs.current.forEach((audio, i) => {
      if (!audio) return;
      try {
        const source = ctx.createMediaElementSource(audio);
        const gain = ctx.createGain();
        gain.gain.value = volumes[i] ?? 1;
        source.connect(gain);
        gain.connect(ctx.destination);
        gainRefs.current[i] = gain;
      } catch {
        // 可能已经被连接过，忽略
      }
    });

    return () => {
      ctx.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.map((t) => t.path).join("|")]);

  // 同步播放/暂停
  const togglePlay = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx?.state === "suspended") ctx.resume();
    const allReady = audioRefs.current.every((a) => a && a.readyState >= 2);
    if (!allReady) return;

    const anyPlaying = audioRefs.current.some((a) => a && !a.paused);
    if (anyPlaying) {
      audioRefs.current.forEach((a) => a?.pause());
      setIsPlaying(false);
    } else {
      // 同步起始时间（取当前最大的 currentTime 避免某轨从头开始）
      const maxTime = Math.max(...audioRefs.current.map((a) => a?.currentTime || 0));
      audioRefs.current.forEach((a) => {
        if (a) {
          a.currentTime = maxTime;
          a.play().catch(() => {});
        }
      });
      setIsPlaying(true);
    }
  }, []);

  // 进度更新
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const first = audioRefs.current[0];
      if (first) {
        setCurrentTime(first.currentTime);
        if (first.duration && !isNaN(first.duration)) setDuration(first.duration);
        // 检查是否播放结束
        if (first.ended) {
          setIsPlaying(false);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // seek（所有轨道同步）
  const seek = useCallback((time: number) => {
    audioRefs.current.forEach((a) => {
      if (a) a.currentTime = time;
    });
    setCurrentTime(time);
  }, []);

  // 音量变化
  const onVolumeChange = (i: number, v: number) => {
    setVolumes((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
    const gain = gainRefs.current[i];
    if (gain) {
      // 应用静音/独奏逻辑
      const shouldPlay = !muted[i] && (!soloed.some((s) => s) || soloed[i]);
      gain.gain.value = shouldPlay ? v : 0;
    }
  };

  // 静音切换
  const toggleMute = (i: number) => {
    setMuted((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      // 重新计算各轨增益
      gainRefs.current.forEach((gain, idx) => {
        if (gain) {
          const shouldPlay = !next[idx] && (!soloed.some((s) => s) || soloed[idx]);
          gain.gain.value = shouldPlay ? volumes[idx] : 0;
        }
      });
      return next;
    });
  };

  // 独奏切换
  const toggleSolo = (i: number) => {
    setSoloed((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      // 重新计算各轨增益
      gainRefs.current.forEach((gain, idx) => {
        if (gain) {
          const hasSolo = next.some((s) => s);
          const shouldPlay = !muted[idx] && (!hasSolo || next[idx]);
          gain.gain.value = shouldPlay ? volumes[idx] : 0;
        }
      });
      return next;
    });
  };

  const fmtTime = (s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="studio-mixer">
      {/* 统一控制栏 */}
      <div className="studio-mixer__controls">
        <button
          className="studio-mixer__play-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <span className="studio-mixer__time">{fmtTime(currentTime)}</span>
        <input
          type="range"
          className="studio-mixer__progress"
          min={0}
          max={duration || 0}
          value={currentTime}
          step={0.1}
          onChange={(e) => seek(parseFloat(e.target.value))}
        />
        <span className="studio-mixer__time">{fmtTime(duration)}</span>
      </div>

      {/* 轨道列表 */}
      <div className="studio-mixer__tracks">
        {tracks.map((track, i) => (
          <div className="studio-mixer__track" key={track.path}>
            <div className="studio-mixer__track-head">
              <span className="studio-mixer__track-label" style={{ color: track.color }}>
                {track.label}
              </span>
              <div className="studio-mixer__track-buttons">
                <button
                  className={`studio-mixer__btn ${muted[i] ? "studio-mixer__btn--active" : ""}`}
                  onClick={() => toggleMute(i)}
                  title="静音"
                >
                  M
                </button>
                <button
                  className={`studio-mixer__btn ${soloed[i] ? "studio-mixer__btn--active" : ""}`}
                  onClick={() => toggleSolo(i)}
                  title="独奏"
                >
                  S
                </button>
              </div>
            </div>
            <audio
              ref={(el) => { audioRefs.current[i] = el; }}
              src={convertFileSrc(track.path)}
              preload="auto"
              crossOrigin="anonymous"
            />
            <div className="studio-mixer__volume-row">
              <span className="studio-mixer__vol-icon" style={{ opacity: volumes[i] > 0 ? 1 : 0.3 }}>
                ♪
              </span>
              <input
                type="range"
                className="studio-mixer__volume"
                min={0}
                max={1}
                step={0.01}
                value={volumes[i]}
                onChange={(e) => onVolumeChange(i, parseFloat(e.target.value))}
                style={{ "--track-color": track.color } as React.CSSProperties}
              />
              <span className="studio-mixer__vol-val">{Math.round(volumes[i] * 100)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
