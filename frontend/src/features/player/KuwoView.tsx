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

type View = "search" | "popular" | "chart";

interface ChartOption { id: string; name: string }

const CHARTS: ChartOption[] = [
  { id: "93", name: "飙升榜" },
  { id: "17", name: "热歌榜" },
  { id: "16", name: "新歌榜" },
  { id: "286", name: "抖音热歌榜" },
  { id: "279", name: "电音榜" },
];

/** 酷我音乐视图：搜索 + 推荐 + 榜单 */
export function KuwoView() {
  const [songs, setSongs] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [view, setView] = useState<View>("search");
  const [chartId, setChartId] = useState(CHARTS[0].id);
  const [quality, setQuality] = useState<string>("high");

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  // 启动时读取当前音质设置
  useState(() => {
    invoke<string>("kuwo_get_quality")
      .then(setQuality)
      .catch(() => {});
  });

  const onQualityChange = async (q: string) => {
    setQuality(q);
    try {
      await invoke("kuwo_set_quality", { quality: q });
    } catch { /* 静默 */ }
  };

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    setPage(1); setHasMore(true);
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

  const loadPopular = async () => {
    setLoading(true); setError("");
    try {
      const list = await invoke<Track[]>("kuwo_popular", { limit: 50 });
      setSongs(list);
      setQueue(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadChart = async (id: string) => {
    setChartId(id);
    setLoading(true); setError("");
    try {
      const list = await invoke<Track[]>("kuwo_chart_detail", { bangId: id, limit: 50 });
      setSongs(list);
      setQueue(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const switchView = (v: View) => {
    setView(v);
    setSongs([]);
    setError("");
    if (v === "popular") loadPopular();
    if (v === "chart") loadChart(chartId);
  };

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  const renderRow = (t: Track, i: number) => (
    <>
      <span className="col-title" onClick={() => handlePlay(t, i)}>
        {coverOf(t) && <img src={coverOf(t)!} alt="" className="col-title__cover" loading="lazy" />}
        <span className="col-title__txt">{t.meta.title}</span>
        <span className="q-badge q-high">KW</span>
      </span>
      <span className="col-artist">{t.meta.artist}</span>
      <span className="col-album">{t.meta.album || "—"}</span>
      <span className="col-dur">
        <TrackActions track={t} size={14} />
      </span>
    </>
  );

  return (
    <div className="library">
      <div className="section-title">
        <h3>酷我音乐</h3>
        <span className="section-title__sub">
          {view === "search" ? "搜索" : view === "popular" ? "推荐" : "榜单"}
        </span>
      </div>

      {/* 音质选择 */}
      <div className="kuwo-quality" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>音质：</span>
        {[
          { v: "standard", label: "标准" },
          { v: "high", label: "高品" },
          { v: "lossless", label: "无损 FLAC" },
        ].map((opt) => (
          <button
            key={opt.v}
            type="button"
            className={`search-tabs__tab ${quality === opt.v ? "search-tabs__tab--active" : ""}`}
            style={{ padding: "2px 10px", fontSize: 12 }}
            onClick={() => onQualityChange(opt.v)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="search-tabs" role="tablist" aria-label="酷我视图">
        <button
          type="button"
          role="tab"
          className={`search-tabs__tab ${view === "search" ? "search-tabs__tab--active" : ""}`}
          onClick={() => switchView("search")}
        >
          搜索
        </button>
        <button
          type="button"
          role="tab"
          className={`search-tabs__tab ${view === "popular" ? "search-tabs__tab--active" : ""}`}
          onClick={() => switchView("popular")}
        >
          推荐
        </button>
        <button
          type="button"
          role="tab"
          className={`search-tabs__tab ${view === "chart" ? "search-tabs__tab--active" : ""}`}
          onClick={() => switchView("chart")}
        >
          榜单
        </button>
      </div>

      {view === "search" && (
        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <ConsoleSearch
            value={keyword}
            onChange={setKeyword}
            onSubmit={doSearch}
            loading={loading}
            placeholder="搜索酷我音乐…"
          />
        </div>
      )}

      {view === "chart" && (
        <div className="search-tabs" style={{ marginTop: 12, marginBottom: 12 }} role="tablist">
          {CHARTS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              className={`search-tabs__tab ${chartId === c.id ? "search-tabs__tab--active" : ""}`}
              onClick={() => loadChart(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="library__error">{error}</div>
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
          <div className="library__empty-desc">
            {view === "search" ? "输入关键词搜索" : view === "popular" ? "暂无推荐数据" : "选择榜单加载"}
          </div>
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
              onItemsRendered={view === "search" ? onItemsRendered : undefined}
              renderRow={renderRow}
            />
          </div>
        </div>
      )}
    </div>
  );
}
