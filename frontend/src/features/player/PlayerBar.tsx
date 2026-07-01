import { usePlayerStore, type PlaybackMode } from "../../stores/playerStore";
import { engineRef } from "../../App";
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

  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const volPct = Math.round(volume * 100);

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
    <div className="playerbar">
      {/* 左：曲目信息 */}
      <div className="pb-left">
        <div className={`pb-cover ${isPlaying ? "pb-cover--spin" : ""}`}>🎵</div>
        <div className="pb-meta">
          <div className="pb-title">{currentTrack?.meta.title || "OrangeRadio"}</div>
          <div className="pb-artist">{currentTrack?.meta.artist || "选择一首歌开始"}</div>
        </div>
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
