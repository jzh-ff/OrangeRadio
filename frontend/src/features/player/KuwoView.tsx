import { useState, useCallback } from "react";
import { ConsoleSearch } from "../../components/ConsoleSearch";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { getCoverUrl } from "./useCover";
import { TrackActions } from "./TrackActions";
import { VirtualTrackList } from "../../components/TrackRow";
import { useVirtualInfiniteScroll } from "../../hooks/useInfiniteScroll";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

function coverOf(t: Track): string | null { return getCoverUrl(t); }

/** 酷我音乐视图（免登录搜索 + 播放） */
export function KuwoView() {
  const [songs, setSongs] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError("");
    setPage(1);
    setHasMore(true);
    try {
      const list = await invoke<Track[]>("kuwo_search", { keyword, page: 1 });
      if (list.length === 0) {
        setError("搜索无结果");
        setHasMore(false);
      }
      setSongs(list);
      setQueue(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !keyword.trim()) return;
    const next = page + 1;
    setLoading(true);
    try {
      const list = await invoke<Track[]>("kuwo_search", { keyword, page: next });
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
      <div style={{ marginBottom: 16 }}>
        <ConsoleSearch
          value={keyword}
          onChange={setKeyword}
          onSubmit={doSearch}
          loading={loading}
          placeholder="搜索酷我音乐…"
        />
      </div>

      {error && (
        <div className="library__error">
          {error}
        </div>
      )}

      {songs.length === 0 && !loading ? (
        <div className="library__empty">
          <div className="library__empty-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="library__empty-title">{error ? "加载失败" : "酷我音乐"}</div>
          <div className="library__empty-desc">输入关键词搜索，曲库千万级</div>
        </div>
      ) : (
        <div className="library__list">
          <div className="lib-header">
            <span className="col-i">#</span>
            <span className="col-title">歌曲</span>
            <span className="col-artist">歌手</span>
            <span className="col-album">专辑</span>
            <span className="col-dur">操作</span>
          </div>
          <div className="lib-rows">
            <VirtualTrackList
              tracks={songs}
              activeId={currentTrack?.id}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onItemsRendered={onItemsRendered}
              renderRow={(t, i) => (
                <>
                  <span className="col-title" onClick={() => handlePlay(t, i)}>
                    {coverOf(t) && <img src={coverOf(t)!} alt="" className="col-title__cover" loading="lazy" />}
                    <span className="col-title__txt">{t.meta.title}</span>
                    <span className="q-badge q-high">KW</span>
                  </span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
                  <span className="col-dur">
                    <TrackActions track={t} />
                  </span>
                </>
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
