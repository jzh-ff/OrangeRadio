import { useEffect, useState, useCallback } from "react";
import { ConsoleSearch } from "../../components/ConsoleSearch";
import { EmptyStateIcon } from "../../components/EmptyState";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { VirtualTrackList } from "../../components/TrackRow";
import { useVirtualInfiniteScroll } from "../../hooks/useInfiniteScroll";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

/** 网络电台视图（RadioBrowser） */
export function RadioView() {
  const [stations, setStations] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setRadioQueue = usePlayerStore((s) => s.setRadioQueue);

  useEffect(() => {
    loadPopular();
  }, []);

  const loadPopular = async () => {
    setLoading(true);
    setError("");
    setHasMore(false);
    try {
      const list = await invoke<Track[]>("radio_popular", { limit: 30 });
      setStations(list);
      setRadioQueue(list);
    } catch (e: any) {
      setError(e?.message || String(e));
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
      const list = await invoke<Track[]>("radio_search", { keyword, page: 1 });
      if (list.length === 0) setHasMore(false);
      setStations(list);
      setRadioQueue(list);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !keyword.trim()) return;
    const next = page + 1;
    setLoading(true);
    try {
      const list = await invoke<Track[]>("radio_search", { keyword, page: next });
      if (list.length === 0) setHasMore(false);
      else {
        setStations((prev) => [...prev, ...list]);
        usePlayerStore.getState().setRadioQueue([...usePlayerStore.getState().radioTracks, ...list]);
        setPage(next);
      }
    } catch { /* 静默 */ }
    finally { setLoading(false); }
  }, [page, hasMore, loading, keyword]);

  const onItemsRendered = useVirtualInfiniteScroll({ hasMore, loading, onLoadMore: loadMore });

  const handlePlay = (track: Track, index: number) => {
    // 确保点击电台时切到电台活跃队列（用户可能在别处切走过）
    if (usePlayerStore.getState().activeQueue !== "radio") {
      usePlayerStore.setState({ activeQueue: "radio" });
    }
    engineRef.playTrack(track, index);
  };

  return (
    <div className="library">
      <div style={{ marginBottom: 16 }}>
        <ConsoleSearch
          value={keyword}
          onChange={setKeyword}
          onSubmit={doSearch}
          onSecondary={loadPopular}
          secondaryLabel="热门电台"
          loading={loading}
          placeholder="搜索全球电台（Jazz / Rock / 中国…）"
        />
      </div>

      {error && (
        <div style={{ padding: 16, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 10, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {stations.length === 0 && !loading ? (
        <div className="library__empty">
          <div className="library__empty-icon"><EmptyStateIcon kind="radio" /></div>
          <div className="library__empty-title">{error ? "加载失败" : "正在加载电台…"}</div>
          <div className="library__empty-desc">RadioBrowser · 全球 4 万+ 网络电台</div>
        </div>
      ) : (
        <div className="library__list">
          <div className="lib-header">
            <span className="col-i">#</span>
            <span className="col-title">电台</span>
            <span className="col-artist">地区</span>
            <span className="col-album">类型</span>
            <span className="col-dur">码率</span>
          </div>
          <div className="lib-rows">
            <VirtualTrackList
              tracks={stations}
              activeId={currentTrack?.id}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onItemsRendered={keyword.trim() ? onItemsRendered : undefined}
              renderRow={(t, i) => (
                <>
                  <span className="col-title" onClick={() => handlePlay(t, i)}>
                    <span className="col-title__txt">{t.meta.title}</span>
                    <span className="q-badge q-std">LIVE</span>
                  </span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
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
