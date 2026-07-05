import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { getCoverUrl } from "./useCover";
import "../../styles/queue-panel.css";

const QP_ROW_HEIGHT = 56;

/**
 * 播放队列面板（从右侧滑出）
 *
 * 显示当前播放队列 + 电台列表（双队列隔离），点击任意歌曲可切换播放。
 * 队列用 react-window 虚拟化（行高 56px）。
 */
export function QueuePanel() {
  const open = usePlayerStore((s) => s.queueOpen);
  const setOpen = () => usePlayerStore.setState({ queueOpen: !usePlayerStore.getState().queueOpen });
  const tracks = usePlayerStore((s) => s.tracks);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const radioTracks = usePlayerStore((s) => s.radioTracks);
  const radioIndex = usePlayerStore((s) => s.radioIndex);
  const activeQueue = usePlayerStore((s) => s.activeQueue);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  if (!open) return null;

  const play = (track: any, index: number, queue: "tracks" | "radio") => {
    // 切到对应活跃队列（点电台时切到 radio，点单曲时切到 tracks）
    if (usePlayerStore.getState().activeQueue !== queue) {
      usePlayerStore.setState({ activeQueue: queue });
    }
    engineRef.playTrack(track, index);
  };

  const renderRow = (t: any, i: number, active: boolean, queue: "tracks" | "radio") => {
    const cover = getCoverUrl(t);
    const remove = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (queue === "tracks") usePlayerStore.getState().removeAt(i);
      else {
        // 电台队列删除（store 无专用 API，直接操作）
        const rt = usePlayerStore.getState().radioTracks.filter((_, idx) => idx !== i);
        usePlayerStore.setState({ radioTracks: rt });
      }
    };
    const playNext = (e: React.MouseEvent) => {
      e.stopPropagation();
      // 单曲队列才支持「下一首播放」（电台是流，无此语义）
      if (queue === "tracks") usePlayerStore.getState().insertNext(t);
    };
    return (
      <div
        className={`qp-item ${active ? "qp-item--active" : ""}`}
        onClick={() => play(t, i, queue)}
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
        <div className="qp-item__actions">
          {/* 下一首播放（仅单曲队列，电台流无此语义） */}
          {queue === "tracks" && (
            <button className="qp-item__btn qp-item__playnext" onClick={playNext} title="下一首播放">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 4l10 8-10 8V4z" fill="currentColor" />
                <path d="M19 5v14" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {/* 删除按钮（始终可见，hover 高亮） */}
          <button className="qp-item__btn qp-item__remove" onClick={remove} title="从队列移除">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // 虚拟化渲染单曲队列
  const TrackRow = ({ index, style }: ListChildComponentProps) => (
    <div style={style}>
      {renderRow(tracks[index], index, activeQueue === "tracks" && index === currentIndex, "tracks")}
    </div>
  );
  // 虚拟化渲染电台队列
  const RadioRow = ({ index, style }: ListChildComponentProps) => (
    <div style={style}>
      {renderRow(radioTracks[index], index, activeQueue === "radio" && index === radioIndex, "radio")}
    </div>
  );

  const clearTracks = () => usePlayerStore.getState().clearQueue();
  const clearRadio = () => usePlayerStore.setState({ radioTracks: [], radioIndex: -1 });

  const isEmpty = tracks.length === 0 && radioTracks.length === 0;

  return (
    <>
      <div className="qp-backdrop" onClick={setOpen} />
      <aside className="qp-panel">
        <div className="qp-head">
          <span className="qp-title">播放队列</span>
          <span className="qp-count">{tracks.length} 首</span>
          {tracks.length > 0 && (
            <button className="qp-clear" onClick={clearTracks} title="清空单曲队列">清空</button>
          )}
          <button className="qp-close" onClick={setOpen}>✕</button>
        </div>
        <div className="qp-list">
          {isEmpty && <div className="qp-empty">队列为空，去添加一些歌曲吧</div>}
          {tracks.length > 0 && (
            <List
              height={Math.min(tracks.length * QP_ROW_HEIGHT, 10000)}
              itemCount={tracks.length}
              itemSize={QP_ROW_HEIGHT}
              width="100%"
              overscanCount={6}
            >
              {TrackRow}
            </List>
          )}
          {radioTracks.length > 0 && (
            <>
              <div className="qp-section">
                📻 电台列表 <span className="qp-count">{radioTracks.length}</span>
                <button className="qp-clear qp-clear--section" onClick={clearRadio} title="清空电台列表">清空</button>
              </div>
              <List
                height={Math.min(radioTracks.length * QP_ROW_HEIGHT, 4000)}
                itemCount={radioTracks.length}
                itemSize={QP_ROW_HEIGHT}
                width="100%"
                overscanCount={6}
              >
                {RadioRow}
              </List>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
