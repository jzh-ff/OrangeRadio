import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../../stores/libraryStore";
import { AddToPlaylistDialog } from "./AddToPlaylistDialog";

/**
 * 歌曲行的操作按钮组（智能：根据音源选择收藏方式）
 *
 * - 网易云歌曲：爱心 → 收藏到网易云远端「我喜欢的音乐」
 * - 本地歌曲：爱心 → 本地收藏（toggle_liked）
 * - ＋：添加到本地歌单（所有歌曲通用）
 */
export function TrackActions({ track, size = 15, showLike = true }: { track: Track; size?: number; showLike?: boolean }) {
  const [liked, setLiked] = useState(track.liked);
  const [showAdd, setShowAdd] = useState(false);
  const [liking, setLiking] = useState(false);
  const isNetease = track.source_kind === "netease_cloud_music";

  const toggleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (liking) return;
    setLiking(true);
    try {
      if (isNetease) {
        // 网易云：收藏到远端歌单
        await invoke("netease_like_track", { songId: track.source_track_id });
        setLiked(true);
        track.liked = true;
      } else {
        // 本地：切换收藏
        const next = !liked;
        setLiked(next);
        track.liked = next;
        await invoke("toggle_liked", { trackId: track.id, liked: next });
      }
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
            title={isNetease ? "收藏到网易云「我喜欢的音乐」" : (liked ? "取消喜欢" : "喜欢")}
          >
            <svg width={size} height={size} viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
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
