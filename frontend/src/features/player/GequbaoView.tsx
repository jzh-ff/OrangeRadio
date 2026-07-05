import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { VirtualTrackList } from "../../components/TrackRow";
import { useVirtualInfiniteScroll } from "../../hooks/useInfiniteScroll";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

/** 歌曲宝视图（第三方聚合音源，免登录） */
export function GequbaoView() {
  const [songs, setSongs] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => {
    loadPopular();
  }, []);

  const loadPopular = async () => {
    setLoading(true);
    setError("");
    setHasMore(false);
    try {
      const list = await invoke<Track[]>("gequbao_popular", { limit: 30 });
      setSongs(list);
      setQueue(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const doSearch = async () => {
    if (!keyword.trim()) {
      loadPopular();
      return;
    }
    setLoading(true);
    setError("");
    setPage(1); setHasMore(true);
    try {
      const list = await invoke<Track[]>("gequbao_search", { keyword, page: 1 });
      if (list.length === 0) setHasMore(false);
      setSongs(list);
      setQueue(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !keyword.trim()) return;
    const next = page + 1;
    setLoading(true);
    try {
      const list = await invoke<Track[]>("gequbao_search", { keyword, page: next });
      if (list.length === 0) setHasMore(false);
      else {
        setSongs((prev) => [...prev, ...list]);
        usePlayerStore.getState().addManyToQueue(list);
        setPage(next);
      }
    } catch { /* 静默 */ }
    finally { setLoading(false); }
  }, [page, hasMore, loading, keyword]);

  const onItemsRendered = useVirtualInfiniteScroll({ hasMore, loading, onLoadMore: loadMore });

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
            placeholder="搜索歌曲（周杰伦 / 晴天…）"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
        </div>
        <button className="btn-scan" onClick={loadPopular} disabled={loading}>
          🎵 {loading ? "加载中…" : "热门推荐"}
        </button>
      </div>

      {error && (
        <div style={{ padding: 16, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 10, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {songs.length === 0 && !loading ? (
        <div className="library__empty">
          <div className="library__empty-icon">🎵</div>
          <div className="library__empty-title">{error ? "加载失败" : "正在加载…"}</div>
          <div className="library__empty-desc">歌曲宝 · 第三方聚合音源</div>
        </div>
      ) : (
        <div className="library__list">
          <div className="lib-header cols-4">
            <span className="col-i">#</span>
            <span className="col-title">歌曲</span>
            <span className="col-artist">歌手</span>
            <span className="col-dur">音质</span>
          </div>
          <div className="lib-rows">
            <VirtualTrackList
              tracks={songs}
              activeId={currentTrack?.id}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              cols={4}
              onItemsRendered={keyword.trim() ? onItemsRendered : undefined}
              renderRow={(t, i) => (
                <>
                  <span className="col-title" onClick={() => handlePlay(t, i)}>
                    <span className="col-title__txt">{t.meta.title}</span>
                    <span className="q-badge q-hi">HQ</span>
                  </span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-dur">{t.quality === "high" ? "HQ" : "STD"}</span>
                </>
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
