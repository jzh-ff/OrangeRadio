import { usePlayerStore, type PlaybackMode } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { getCoverUrl } from "./useCover";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toggleLyricOverlay, setLyricLock } from "../../lib/lyricWindow";
import { joinRoom, leaveRoom } from "../../lib/listenTogether";
import "../../styles/player-bar.css";

const MODE_LABELS: Record<PlaybackMode, string> = {
  sequence: "顺序播放",
  list_loop: "列表循环",
  single_loop: "单曲循环",
  shuffle: "随机播放",
  understand_you: "懂你模式",
};

const MODE_ORDER: PlaybackMode[] = [
  "sequence",
  "list_loop",
  "single_loop",
  "shuffle",
  "understand_you",
];

export function PlayerBar() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const mode = usePlayerStore((s) => s.mode);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const playerBarOpacity = usePlayerStore((s) => s.visualParams.playerBarOpacity);

  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const volPct = Math.round(volume * 100);

  // 桌面歌词悬浮窗锁定态（来自 lyric-overlay 窗口的 lock-change 事件）
  const [lyricLocked, setLyricLocked] = useState(false);
  useEffect(() => {
    let un: UnlistenFn | null = null;
    (async () => {
      un = await listen<{ locked: boolean }>("lyric:lock-change", (e) =>
        setLyricLocked(e.payload.locked)
      );
    })();
    return () => {
      un?.();
    };
  }, []);

  const onLyricBtn = async () => {
    if (lyricLocked) {
      await setLyricLock(false);
      setLyricLocked(false);
    } else {
      await toggleLyricOverlay();
    }
  };

  // 一起听（Listen Together）：加入/离开房间
  const [inRoom, setInRoom] = useState(false);
  const handleJoinRoom = () => {
    if (inRoom) {
      leaveRoom();
      setInRoom(false);
    } else {
      const roomId = window.prompt("输入房间号（和朋友用同一个）", "default");
      if (roomId) {
        joinRoom(roomId);
        setInRoom(true);
      }
    }
  };

  const cycleMode = () => {
    const idx = MODE_ORDER.indexOf(mode);
    usePlayerStore.getState().setMode(MODE_ORDER[(idx + 1) % MODE_ORDER.length]);
  };

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={`playerbar ${currentTrack ? "playerbar--visible" : ""}`}
      style={{ "--ui-opacity": playerBarOpacity } as React.CSSProperties}
    >
      {/* 顶置细进度条（对标 MineRadio #progress-bar 顶部线） */}
      <div className="pb-top-progress">
        <div className="pb-top-progress__fill" style={{ width: `${progress}%` }} />
        <input
          type="range" min={0} max={duration || 0} step={0.1} value={position}
          onChange={(e) => engineRef.seek(parseFloat(e.target.value))}
          className="pb-top-progress__input"
        />
      </div>
      {/* 左：曲目信息 */}
      <div className="pb-left">
        <div
          className={`pb-cover ${isPlaying ? "pb-cover--spin" : ""}`}
          onClick={() => usePlayerStore.getState().setFullPlayer(true)}
          title="点击进入全屏播放"
          style={{ cursor: "pointer" }}
        >
          {getCoverUrl(currentTrack) ? (
            <img className="pb-cover__img" src={getCoverUrl(currentTrack)!} alt={currentTrack?.meta.title} />
          ) : (
            <span className="pb-cover__disc">OR</span>
          )}
        </div>
        <div className="pb-meta">
          <div className="pb-title">{currentTrack?.meta.title || "OrangeRadio"}</div>
          <div className="pb-artist">{currentTrack?.meta.artist || "选择一首歌开始"}</div>
          <div className="pb-state">
            <span className={isPlaying ? "is-live" : ""} />
            {isPlaying ? "LIVE SIGNAL" : "STANDBY"}
          </div>
        </div>
        {/* 爱心收藏按钮 */}
        {currentTrack && (
          <button
            className={`pb-like ${currentTrack.liked ? "pb-like--active" : ""}`}
            onClick={async () => {
              const next = !currentTrack.liked;
              currentTrack.liked = next;
              usePlayerStore.setState({ currentTrack: { ...currentTrack } });
              try { await invoke("toggle_liked", { trackId: currentTrack.id, liked: next }); } catch {}
            }}
            title={currentTrack.liked ? "取消喜欢" : "喜欢"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={currentTrack.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}
      </div>

      {/* 中：控制 + 进度 */}
      <div className="pb-center">
        <div className="pb-controls">
          <button className="pb-btn" onClick={() => engineRef.prev()} title="上一首">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
          </button>
          <button className="pb-btn pb-btn--play" onClick={() => engineRef.toggle()} title={isPlaying ? "暂停" : "播放"}>
            {isPlaying ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button className="pb-btn" onClick={() => engineRef.next()} title="下一首">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6v12z" /></svg>
          </button>
        </div>
        <div className="pb-progress">
          <span className="pb-time">{fmt(position)}</span>
          <div className="pb-slider">
            <div className="pb-slider__track">
              <div className="pb-slider__fill" style={{ width: `${progress}%` }} />
              <div className="pb-slider__thumb" style={{ left: `${progress}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={position}
              onChange={(e) => engineRef.seek(parseFloat(e.target.value))}
              className="pb-slider__input"
            />
          </div>
          <span className="pb-time">{fmt(duration)}</span>
        </div>
      </div>

      {/* 右：模式 + 音量 */}
      <div className="pb-right">
        {/* 爱心收藏 */}
        {currentTrack && (
          <button
            className={`pb-btn pb-like-btn ${currentTrack.liked ? "pb-like-btn--active" : ""}`}
            onClick={async () => {
              const track = currentTrack;
              const isNetease = (track as any).source_kind === "netease_cloud_music";
              try {
                if (isNetease) {
                  await invoke("netease_like_track", { songId: track.source_track_id });
                  usePlayerStore.setState({ currentTrack: { ...track, liked: true } });
                } else {
                  const next = !track.liked;
                  usePlayerStore.setState({ currentTrack: { ...track, liked: next } });
                  await invoke("toggle_liked", { trackId: track.id, liked: next });
                }
              } catch {}
            }}
            title="收藏"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={currentTrack.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}
        {/* 播放队列 */}
        <button
          className="pb-btn"
          onClick={() => usePlayerStore.setState({ queueOpen: !usePlayerStore.getState().queueOpen })}
          title="播放队列"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h13M3 12h13M3 18h9M17 14v6m-3-3h6" strokeLinecap="round" />
          </svg>
        </button>
        {/* 桌面歌词悬浮窗 */}
        <button
          className="pb-btn"
          onClick={onLyricBtn}
          title={lyricLocked ? "桌面歌词已锁定·点此解锁" : "桌面歌词"}
          style={lyricLocked ? { color: "#ff9248" } : undefined}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h10M4 18h13" strokeLinecap="round" />
          </svg>
        </button>
        {/* 一起听 */}
        <button
          className="pb-btn"
          onClick={handleJoinRoom}
          title={inRoom ? "离开一起听" : "一起听"}
          style={inRoom ? { color: "#ff9248" } : undefined}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 20h5v-2a4 4 0 0 0-3-3.87M9 20H4v-2a4 4 0 0 1 3-3.87m6-2.13a4 4 0 1 0-4-4 4 4 0 0 0 4 4z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="pb-btn pb-btn--mode" onClick={cycleMode} title={MODE_LABELS[mode]}>
          {mode === "understand_you" ? "🧠" : mode === "shuffle" ? "🔀" : mode === "single_loop" ? "🔂" : mode === "list_loop" ? "🔁" : "➡️"}
          <span className="pb-mode-label">{MODE_LABELS[mode]}</span>
        </button>
        <div className="pb-vol">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" />
            {volume > 0.3 && <path d="M15.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
            {volume > 0.6 && <path d="M18.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
          </svg>
          <span className="pb-vol-pct">{volPct}</span>
          <div className="pb-vol-slider">
            <div className="pb-vol-track">
              <div className="pb-vol-fill" style={{ width: `${volPct}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => engineRef.setVol(parseFloat(e.target.value))}
              className="pb-vol-input"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
