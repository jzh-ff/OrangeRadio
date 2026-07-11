import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../../stores/libraryStore";
import { usePlayerStore } from "../../stores/playerStore";
import { AddToPlaylistDialog } from "./AddToPlaylistDialog";

/**
 * 歌曲行的操作按钮组
 *
 * - 爱心：统一加入/移除本地“我的收藏”歌单（add_to_favorites / remove_from_favorites）
 * - ＋：添加到歌单（所有歌曲通用）
 * - ▶▸：下一首播放（插入到当前播放位置之后）
 */
export function TrackActions({ track, size = 15, showLike = true, showPlayNext = true }: { track: Track; size?: number; showLike?: boolean; showPlayNext?: boolean }) {
  const [liked, setLiked] = useState(track.liked);
  const [showAdd, setShowAdd] = useState(false);
  const [liking, setLiking] = useState(false);

  const toggleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (liking) return;
    setLiking(true);
    const next = !liked;
    try {
      if (next) {
        await invoke("add_to_favorites", { track });
      } else {
        await invoke("remove_from_favorites", { track });
      }
      setLiked(next);
      track.liked = next;
      // 只同步更新 playerStore 的 currentTrack（如果正在播放这首歌）
      const cur = usePlayerStore.getState().currentTrack;
      if (cur && cur.id === track.id) {
        usePlayerStore.setState({ currentTrack: { ...cur, liked: next } });
      }
      // 不更新 libraryStore.tracks（会导致整个列表重渲染闪屏）
    } catch (err) {
      // 失败静默
    } finally {
      setLiking(false);
    }
  };

  return (
    <>
      <span className="ta-group" onClick={(e) => e.stopPropagation()}>
        {showLike && (
          <button
            className={`ta-btn ${liked ? "ta-btn--liked" : ""}`}
            onClick={toggleLike}
            disabled={liking}
            title={liked ? "取消喜欢" : "喜欢"}
          >
            <svg width={size} height={size} viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}
        {showPlayNext && (
          <button
            className="ta-btn"
            onClick={(e) => { e.stopPropagation(); usePlayerStore.getState().insertNext(track); }}
            title="下一首播放"
          >
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 4l10 8-10 8V4z" fill="currentColor" />
              <path d="M19 5v14" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button
          className="ta-btn"
          onClick={() => setShowAdd(true)}
          title="添加到歌单"
        >
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
      </span>
      {showAdd && <AddToPlaylistDialog track={track} onClose={() => setShowAdd(false)} />}
    </>
  );
}
