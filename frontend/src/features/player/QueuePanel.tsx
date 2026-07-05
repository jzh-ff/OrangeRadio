import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { getCoverUrl } from "./useCover";
import "../../styles/queue-panel.css";

/**
 * 播放队列面板（从右侧滑出）
 *
 * 显示当前播放队列，点击任意歌曲可切换播放。
 */
export function QueuePanel() {
  const open = usePlayerStore((s) => s.queueOpen);
  const setOpen = () => usePlayerStore.setState({ queueOpen: !usePlayerStore.getState().queueOpen });
  const tracks = usePlayerStore((s) => s.tracks);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  if (!open) return null;

  const play = (track: any, index: number) => {
    engineRef.playTrack(track, index);
  };

  return (
    <>
      <div className="qp-backdrop" onClick={setOpen} />
      <aside className="qp-panel">
        <div className="qp-head">
          <span className="qp-title">播放队列</span>
          <span className="qp-count">{tracks.length} 首</span>
          <button className="qp-close" onClick={setOpen}>✕</button>
        </div>
        <div className="qp-list">
          {tracks.length === 0 && (
            <div className="qp-empty">队列为空，去添加一些歌曲吧</div>
          )}
          {tracks.map((t: any, i) => {
            const active = i === currentIndex;
            const cover = getCoverUrl(t);
            return (
              <div
                key={t.id + i}
                className={`qp-item ${active ? "qp-item--active" : ""}`}
                onClick={() => play(t, i)}
              >
                <div className="qp-item__cover">
                  {cover ? (
                    <img src={cover} alt="" loading="lazy" />
                  ) : (
                    <span className="qp-item__placeholder">🎵</span>
                  )}
                </div>
                <div className="qp-item__meta">
                  <div className="qp-item__title">{t.meta.title}</div>
                  <div className="qp-item__artist">{t.meta.artist}</div>
                </div>
                <span className="qp-item__indicator">
                  {active && isPlaying ? (
                    <span className="eq-bars"><i></i><i></i><i></i></span>
                  ) : (
                    <span className="qp-item__index">{i + 1}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
