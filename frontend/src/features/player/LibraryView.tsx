import { useEffect, useCallback } from "react";
import { useLibraryStore, type Track } from "../../stores/libraryStore";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { VirtualTrackList } from "../../components/TrackRow";
import { useVirtualInfiniteScroll } from "../../hooks/useInfiniteScroll";
import "../../styles/library.css";

const fmtTime = (s?: number) => {
  if (!s) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const QUALITY_BADGE: Record<string, { label: string; cls: string }> = {
  lossless: { label: "无损", cls: "q-lossless" },
  high: { label: "HQ", cls: "q-high" },
  standard: { label: "STD", cls: "q-std" },
  hires: { label: "Hi-Res", cls: "q-hires" },
  master: { label: "母带", cls: "q-master" },
};

export function LibraryView() {
  const { tracks, loading, searchKeyword, loadTracks, loadMore, hasMore, scanLocal, doSearch, setSearchKeyword } =
    useLibraryStore();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  // 无限滚动（仅非搜索时分页加载本地库）
  const onLoadMore = useCallback(() => { loadMore(); }, [loadMore]);
  const onItemsRendered = useVirtualInfiniteScroll({
    hasMore,
    loading,
    onLoadMore,
  });

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  return (
    <div className="library">
      <div className="library__deck-head">
        <div>
          <span className="library__eyebrow">Local deck</span>
          <h2>音乐库控制台</h2>
        </div>
        <div className="library__deck-meta">
          <span>{tracks.length} 首曲目</span>
          <span>{loading ? "扫描信号中" : "待机就绪"}</span>
        </div>
      </div>

      <div className="library__toolbar">
        <div className="library__search">
          <svg className="library__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="library__search-input"
            placeholder="搜索歌曲、艺术家、专辑"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
        </div>
        <button className="btn-tune" onClick={() => doSearch()} disabled={loading}>
          调谐搜索
        </button>
        <button className="btn-scan" onClick={() => scanLocal()} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          {loading ? "扫描中…" : "扫描本地音乐"}
        </button>
      </div>

      {tracks.length === 0 ? (
        <div className="library__empty">
          <div className="library__empty-glow" />
          <div className="library__empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
              <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="library__empty-title">{loading ? "正在扫描你的音乐库…" : "还没有音乐"}</div>
          <div className="library__empty-desc">点击「扫描本地音乐」选择文件夹，OrangeRadio 会接入你的本地声波。</div>
        </div>
      ) : (
        <div className="library__list">
          <div className="lib-header">
            <span className="col-i">#</span>
            <span className="col-title">标题</span>
            <span className="col-artist">艺术家</span>
            <span className="col-album">专辑</span>
            <span className="col-dur">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </span>
          </div>
          <div className="lib-rows">
            <VirtualTrackList
              tracks={tracks}
              activeId={currentTrack?.id}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onItemsRendered={searchKeyword.trim() ? undefined : onItemsRendered}
              renderRow={(t, i) => {
                const q = QUALITY_BADGE[t.quality] || QUALITY_BADGE.standard;
                return (
                  <>
                    <span className="col-title" onClick={() => handlePlay(t, i)}>
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
      )}
    </div>
  );
}
