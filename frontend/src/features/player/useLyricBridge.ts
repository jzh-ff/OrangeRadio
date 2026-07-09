import { useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { usePlayerStore } from "../../stores/playerStore";
import { closeLyricOverlay, setLyricLock } from "../../lib/lyricWindow";
import { readBeat } from "../../stores/spectrumBus";

/** 推给 lyric-overlay 窗口的播放状态 */
interface LyricState {
  /** 当前曲目（Track 序列化） */
  track: unknown;
  /** 播放位置（秒） */
  position: number;
  /** 是否在播放 */
  isPlaying: boolean;
  /** 总时长（秒） */
  duration: number;
  /** 主窗口实时 beat intensity（0~1.4），订阅驱动歌词呼吸/扫光抖动 */
  beatIntensity?: number;
}

/** 悬浮窗回传的控件命令 */
interface LyricCmd {
  cmd: "toggle" | "close" | "unlock" | "prev" | "next";
}

/**
 * 主窗口侧的桌面歌词桥：把播放状态推给 lyric-overlay 窗口，并接收悬浮窗的控件命令。
 * 仅在主窗口（label="main"）挂载；悬浮窗自己 listen 状态。
 *
 * 推送策略：position 节流 200ms；track/isPlaying 变化时立即推（切歌/暂停要立刻反映）。
 */
export function useLyricBridge(opts?: { onToggle?: () => void; onPrev?: () => void; onNext?: () => void }) {
  const onToggleRef = useRef(opts?.onToggle);
  onToggleRef.current = opts?.onToggle;
  const onPrevRef = useRef(opts?.onPrev);
  onPrevRef.current = opts?.onPrev;
  const onNextRef = useRef(opts?.onNext);
  onNextRef.current = opts?.onNext;

  // 推送状态
  useEffect(() => {
    let lastEmit = 0;
    let lastTrackId = "";
    let lastIsPlaying: boolean | null = null;

    const unsub = usePlayerStore.subscribe((s) => {
      const now = Date.now();
      const trackId = s.currentTrack?.id ?? "";
      const trackChanged = trackId !== lastTrackId;
      const playingChanged = s.isPlaying !== lastIsPlaying;
      const positionStale = now - lastEmit > 200;
      const beatStale = now - lastEmit > 100; // 节拍推送更密，让悬浮窗跟得上鼓点

      if (!trackChanged && !playingChanged && !positionStale && !beatStale) return;
      lastEmit = now;
      lastTrackId = trackId;
      lastIsPlaying = s.isPlaying;

      const payload: LyricState = {
        track: s.currentTrack,
        position: s.position,
        isPlaying: s.isPlaying,
        duration: s.duration,
        beatIntensity: readBeat().intensity,
      };
      void emit<LyricState>("lyric:state", payload).catch(() => {});
    });
    return unsub;
  }, []);

  // 接收悬浮窗命令
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<LyricCmd>("lyric:cmd", (e) => {
        const cmd = e.payload?.cmd;
        if (cmd === "toggle") onToggleRef.current?.();
        else if (cmd === "prev") onPrevRef.current?.();
        else if (cmd === "next") onNextRef.current?.();
        else if (cmd === "close") void closeLyricOverlay();
        else if (cmd === "unlock") void setLyricLock(false);
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);
}
