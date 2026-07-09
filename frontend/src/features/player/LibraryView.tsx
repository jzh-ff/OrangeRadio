import { useEffect, useCallback, useMemo, useState, memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useLibraryStore, type Track } from "../../stores/libraryStore";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { VirtualTrackList } from "../../components/TrackRow";
import { useVirtualInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { getCoverUrl } from "../player/useCover";
import "../../styles/library.css";

const fmtTime = (s?: number) => {
  if (!s) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const fmtHours = (secs: number) => {
  if (secs <= 0) return "0h";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const QUALITY_BADGE: Record<string, { label: string; cls: string }> = {
  lossless: { label: "无损", cls: "q-lossless" },
  high: { label: "HQ", cls: "q-high" },
  standard: { label: "STD", cls: "q-std" },
  hires: { label: "Hi-Res", cls: "q-hires" },
  master: { label: "母带", cls: "q-master" },
};

const SOURCE_LABEL: Record<string, string> = {
  local: "LOC",
  netease_cloud_music: "WY",
  qq_music: "QQ",
  kugou: "KG",
  qishui: "QS",
  spotify: "SP",
  apple_music: "AM",
  web_radio: "FM",
  podcast: "POD",
  plugin: "EXT",
};

type ViewMode = "list" | "grid";

const VIEW_STORAGE_KEY = "orangeradio.library.viewMode";

interface LibraryViewProps {
  filter?: "all" | "liked" | "local";
}

export function LibraryView({ filter = "all" }: LibraryViewProps) {
  const { tracks, loading, searchKeyword, loadTracks, refreshTracks, loadMore, hasMore, scanLocal, doSearch, setSearchKeyword } =
    useLibraryStore(
      useShallow((s) => ({
        tracks: s.tracks,
        loading: s.loading,
        searchKeyword: s.searchKeyword,
        loadTracks: s.loadTracks,
        refreshTracks: s.refreshTracks,
        loadMore: s.loadMore,
        hasMore: s.hasMore,
        scanLocal: s.scanLocal,
        doSearch: s.doSearch,
        setSearchKeyword: s.setSearchKeyword,
      }))
    );
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  // 视图模式（持久化到 localStorage）
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      return v === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });

  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, viewMode); } catch {}
  }, [viewMode]);

  useEffect(() => {
    loadTracks(filter);
  }, [loadTracks, filter]);

  const filteredTracks = useMemo(() => {
    if (filter === "liked") return tracks.filter((t) => t.liked);
    if (filter === "local") return tracks.filter((t) => (t.source_kind ?? "local") === "local");
    return tracks;
  }, [tracks, filter]);

  const onLoadMore = useCallback(() => { loadMore(); }, [loadMore]);
  const onItemsRendered = useVirtualInfiniteScroll({
    hasMore,
    loading,
    onLoadMore,
  });

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  const isSearching = searchKeyword.trim().length > 0;

  const topLabel = filter === "liked" ? "FAVORITES" : filter === "local" ? "LOCAL" : "LIBRARY";
  const topMeta = (() => {
    const list = filteredTracks;
    if (list.length === 0) {
      if (filter === "liked") return "还没有收藏歌曲";
      if (filter === "local") return "尚未接入本地音乐";
      return "尚未接入本地音乐";
    }
    const totalSecs = list.reduce((s, t) => s + (t.meta.duration_secs ?? 0), 0);
    return `${list.length} 首曲目 · 总时长 ${fmtHours(totalSecs)}`;
  })();

  const emptyTitle = loading
    ? "正在扫描你的音乐库…"
    : filter === "liked"
      ? "收藏夹还是空的"
      : "唱片店里还没有唱片";
  const emptyDesc = filter === "liked"
    ? "播放任何歌曲时点击爱心，它就会出现在这里。"
    : "点击下方按钮选择文件夹，OrangeRadio 会把本地声波接入这台深夜调音台。";
  const showScan = filter !== "liked";

  return (
    <div className="library">
      {/* 轻量级顶栏：左侧状态条 + 右侧数据概览 */}
      <div className="library__topbar">
        <div className="library__topbar-left">
          <span className="library__topbar-tag">
            <span className="library__topbar-dot" />
            {topLabel}
          </span>
          <span className="library__topbar-meta">{topMeta}</span>
        </div>
      </div>

      {/* 工具栏：磁带搜索 + 视图切换 + 扫描 */}
      <div className="library__toolbar">
        <div className="library__tape">
          <span className="library__tape-knob" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <input
            className="library__tape-input"
            placeholder="FM 调频 · 搜索标题、艺术家、专辑…"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
          <span className="library__tape-shortcut">Enter</span>
        </div>

        <div className="library__switcher" role="tablist" aria-label="视图切换">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "list"}
            className={`library__switcher-btn ${viewMode === "list" ? "library__switcher-btn--active" : ""}`}
            onClick={() => setViewMode("list")}
            title="列表视图"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "grid"}
            className={`library__switcher-btn ${viewMode === "grid" ? "library__switcher-btn--active" : ""}`}
            onClick={() => setViewMode("grid")}
            title="磁带墙视图"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
              <rect x="13" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
              <rect x="4" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
              <rect x="13" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>

        <button className="btn-tune" onClick={() => doSearch()} disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 12a9 9 0 0 1 9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="m9 15 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          调谐搜索
        </button>
        <button className="btn-scan" onClick={() => scanLocal()} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          {loading ? "扫描中…" : "扫描本地音乐"}
        </button>
        <button className="btn-refresh" onClick={() => refreshTracks()} disabled={loading} title="刷新列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 17.6-6.1M22 12.5a10 10 0 0 1-17.6 6.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          刷新
        </button>
      </div>

      {/* 内容区 */}
      {filteredTracks.length === 0 ? (
        <div className="library__empty">
          <div className="library__empty-glow" />
          <div className="library__empty-icon">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="library__empty-title">{emptyTitle}</div>
          <div className="library__empty-desc">{emptyDesc}</div>
          {showScan && (
            <button className="library__empty-cta" onClick={() => scanLocal()} disabled={loading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
              {loading ? "扫描中…" : "接入本地音乐"}
            </button>
          )}
        </div>
      ) : viewMode === "list" ? (
        <ListView
          tracks={filteredTracks}
          currentTrackId={currentTrack?.id}
          isPlaying={isPlaying}
          hasMore={hasMore}
          loading={loading}
          isSearching={isSearching}
          onPlay={handlePlay}
          onItemsRendered={onItemsRendered}
        />
      ) : (
        <GridView
          tracks={filteredTracks}
          currentTrackId={currentTrack?.id}
          onPlay={handlePlay}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 列表视图                                                                    */
/* -------------------------------------------------------------------------- */

interface ListViewProps {
  tracks: Track[];
  currentTrackId?: string;
  isPlaying: boolean;
  hasMore: boolean;
  loading: boolean;
  isSearching: boolean;
  onPlay: (track: Track, index: number) => void;
  onItemsRendered: (props: {
    visibleStartIndex: number;
    visibleStopIndex: number;
    overscanStartIndex: number;
    overscanStopIndex: number;
  }) => void;
}

function ListView({ tracks, currentTrackId, isPlaying, isSearching, onPlay, onItemsRendered }: ListViewProps) {
  return (
    <div className="library__list">
      <div className="lib-header">
        <span className="col-i">#</span>
        <span className="col-title" style={{ paddingLeft: 0 }}>标题</span>
        <span className="col-artist">艺术家</span>
        <span className="col-album">专辑</span>
        <span className="col-dur">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </div>
      <div className="lib-rows">
        <VirtualTrackList
          tracks={tracks}
          activeId={currentTrackId}
          isPlaying={isPlaying}
          onPlay={onPlay}
          onItemsRendered={isSearching ? undefined : onItemsRendered}
          renderRow={(t, i) => {
            const q = QUALITY_BADGE[t.quality] || QUALITY_BADGE.standard;
            const source = t.source_kind ?? "local";
            return (
              <>
                <span
                  className="col-title"
                  data-source={source}
                  onClick={() => onPlay(t, i)}
                  style={{ paddingLeft: 14 }}
                >
                  <CoverThumb track={t} />
                  <span className="col-title__txt">{t.meta.title}</span>
                  <span className={`q-badge ${q.cls}`}>{q.label}</span>
                </span>
                <span className="col-artist">{t.meta.artist}</span>
                <span className="col-album">{t.meta.album || "—"}</span>
                <span className="col-dur">{fmtTime(t.meta.duration_secs)}</span>
              </>
            );
          }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 磁带墙视图                                                                  */
/* -------------------------------------------------------------------------- */

interface GridViewProps {
  tracks: Track[];
  currentTrackId?: string;
  onPlay: (track: Track, index: number) => void;
}

function GridView({ tracks, currentTrackId, onPlay }: GridViewProps) {
  return (
    <div className="library__grid">
      {tracks.map((t, i) => {
        const q = QUALITY_BADGE[t.quality] || QUALITY_BADGE.standard;
        const source = t.source_kind ?? "local";
        const cover = getCoverUrl(t);
        const isActive = t.id === currentTrackId;
        return (
          <div
            key={t.id}
            className={`lib-tape ${isActive ? "lib-tape--active" : ""}`}
            data-source={source}
            onDoubleClick={() => onPlay(t, i)}
          >
            <div className={`lib-tape__case ${cover ? "" : "lib-tape__case--empty"}`}>
              {cover ? <img src={cover} alt="" loading="lazy" /> : null}
              <div className="lib-tape__label">
                <span className="lib-tape__quality">{q.label}</span>
                <span className="lib-tape__source">{SOURCE_LABEL[source] ?? "EXT"}</span>
              </div>
              <div className="lib-tape__overlay">
                <div className="lib-tape__overlay-title">{t.meta.title}</div>
                <div className="lib-tape__overlay-artist">{t.meta.artist}</div>
              </div>
              <button
                type="button"
                className="lib-tape__play"
                onClick={(e) => { e.stopPropagation(); onPlay(t, i); }}
                aria-label={`播放 ${t.meta.title}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
            <div className="lib-tape__meta">
              <span className="lib-tape__meta-title">{t.meta.title}</span>
              <span className="lib-tape__meta-artist">{t.meta.artist || "未知艺术家"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 缩略图：优先用真封面，否则用黑胶纹路占位                                  */
/* -------------------------------------------------------------------------- */

const CoverThumb = memo(function CoverThumb({ track }: { track: Track }) {
  const url = getCoverUrl(track);
  if (!url) {
    return <span className="col-title__cover col-title__cover--vinyl" aria-hidden />;
  }
  return (
    <>
      <img
        className="col-title__cover"
        src={url}
        alt=""
        loading="lazy"
        onError={(e) => {
          // 加载失败回退到黑胶占位
          const el = e.currentTarget;
          el.style.display = "none";
          const sib = el.nextElementSibling as HTMLElement | null;
          if (sib) sib.style.display = "inline-block";
        }}
      />
      <span className="col-title__cover col-title__cover--vinyl" aria-hidden style={{ display: "none" }} />
    </>
  );
});
