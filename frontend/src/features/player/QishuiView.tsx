import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { VirtualTrackList } from "../../components/TrackRow";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

/** 汽水音乐视图（接口待接入） */
export function QishuiView() {
  const [songs, setSongs] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError("");
    try {
      const list = await invoke<Track[]>("qishui_search", { keyword, page: 1 });
      if (list.length === 0) {
        setError("搜索无结果（汽水音乐接口尚未完全接入）");
      }
      setSongs(list);
      setQueue(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  return (
    <div className="library">
      <div className="library__toolbar">
        <div className="library__search">
          <svg className="library__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="library__search-input"
            placeholder="搜索汽水音乐…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
        </div>
        <button className="btn-scan" onClick={doSearch} disabled={loading}>
          {loading ? "搜索中…" : "搜索"}
        </button>
      </div>

      {error && (
        <div style={{ padding: 16, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 10, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {songs.length === 0 ? (
        <div className="library__empty">
          <div className="library__empty-icon">🎧</div>
          <div className="library__empty-title">汽水音乐</div>
          <div className="library__empty-desc">接口接入中，敬请期待</div>
        </div>
      ) : (
        <div className="library__list">
          <div className="lib-header">
            <span className="col-i">#</span>
            <span className="col-title">歌曲</span>
            <span className="col-artist">歌手</span>
            <span className="col-album">专辑</span>
          </div>
          <div className="lib-rows">
            <VirtualTrackList
              tracks={songs}
              activeId={currentTrack?.id}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              renderRow={(t) => (
                <>
                  <span className="col-title">
                    <span className="col-title__txt">{t.meta.title}</span>
                    <span className="q-badge q-high">QS</span>
                  </span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
                </>
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
