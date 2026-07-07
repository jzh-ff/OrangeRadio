import { useSearchStore } from "../../stores/searchStore";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { ConsoleSearch } from "../../components/ConsoleSearch";
import { getCoverUrl } from "./useCover";
import { TrackActions } from "./TrackActions";
import { VirtualTrackList } from "../../components/TrackRow";
import { useVirtualInfiniteScroll } from "../../hooks/useInfiniteScroll";
import type { Track, SourceKind } from "../../stores/libraryStore";
import "../../styles/library.css";

/** 来源标签配置 */
const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  local: { label: "本地", cls: "q-std" },
  netease_cloud_music: { label: "NE", cls: "q-lossless" },
  qq_music: { label: "QQ", cls: "q-high" },
  kugou: { label: "KG", cls: "q-high" },
  kuwo: { label: "KW", cls: "q-high" },
  qishui: { label: "QS", cls: "q-hires" },
  spotify: { label: "SP", cls: "q-master" },
  web_radio: { label: "LIVE", cls: "q-hires" },
  podcast: { label: "POD", cls: "q-std" },
};

/** 聚合搜索结果视图（混合列表 + 来源标签） */
export function SearchView() {
  const keyword = useSearchStore((s) => s.keyword);
  const results = useSearchStore((s) => s.results);
  const loading = useSearchStore((s) => s.loading);
  const hasMore = useSearchStore((s) => s.hasMore);
  const doSearch = useSearchStore((s) => s.doSearch);
  const loadMore = useSearchStore((s) => s.loadMore);
  const setKeyword = useSearchStore((s) => s.setKeyword);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  const onItemsRendered = useVirtualInfiniteScroll({ hasMore, loading, onLoadMore: loadMore });

  // 统计各源结果数
  const sourceCounts = results.reduce((acc, t) => {
    const k = (t.source_kind || "local") as SourceKind;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="library">
      <div className="section-title">
        <h3>全网搜索</h3>
        <span className="section-title__sub">
          {results.length > 0 ? `${results.length} 条结果` : ""}
        </span>
      </div>

      {/* 搜索框 */}
      <div style={{ marginBottom: 16 }}>
        <ConsoleSearch
          value={keyword}
          onChange={setKeyword}
          onSubmit={doSearch}
          loading={loading}
          placeholder="搜索本地、网易云、QQ 音乐、Spotify、电台…"
        />
      </div>

      {/* 各源结果统计 */}
      {results.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {Object.entries(sourceCounts).map(([kind, count]) => {
            const badge = SOURCE_BADGE[kind] || { label: kind, cls: "q-std" };
            return (
              <span key={kind} className={`q-badge ${badge.cls}`} style={{ fontSize: 11, padding: "4px 10px" }}>
                {badge.label} · {count}
              </span>
            );
          })}
        </div>
      )}

      {/* 结果列表 */}
      {results.length > 0 ? (
        <div className="library__list">
          <div className="lib-header">
            <span className="col-i">#</span>
            <span className="col-title">标题</span>
            <span className="col-artist">艺术家</span>
            <span className="col-album">专辑</span>
            <span className="col-dur">操作</span>
          </div>
          <div className="lib-rows">
            <VirtualTrackList
              tracks={results}
              activeId={currentTrack?.id}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onItemsRendered={onItemsRendered}
              renderRow={(t, i) => {
                const kind = (t.source_kind || "local") as string;
                const badge = SOURCE_BADGE[kind] || { label: "?", cls: "q-std" };
                const cover = getCoverUrl(t);
                const d = t.meta.duration_secs;
                return (
                  <>
                    <span className="col-title" onClick={() => handlePlay(t, i)}>
                      {cover && <img src={cover} alt="" className="col-title__cover" loading="lazy" />}
                      <span className="col-title__txt">{t.meta.title}</span>
                      <span className={`q-badge ${badge.cls}`}>{badge.label}</span>
                    </span>
                    <span className="col-artist">{t.meta.artist}</span>
                    <span className="col-album">{t.meta.album || "—"}</span>
                    <span className="col-dur">
                      {d ? `${Math.floor(d / 60)}:${Math.floor(d % 60).toString().padStart(2, "0")}` : "—"}
                      <TrackActions track={t} size={14} />
                    </span>
                  </>
                );
              }}
            />
          </div>
        </div>
      ) : loading ? (
        <div className="library__empty">
          <div className="library__empty-title">正在搜索全网音乐…</div>
        </div>
      ) : keyword ? (
        <div className="library__empty">
          <div className="library__empty-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="library__empty-title">无搜索结果</div>
        </div>
      ) : (
        <div className="library__empty">
          <div className="library__empty-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="library__empty-title">输入关键词搜索</div>
          <div className="library__empty-desc">同时搜索本地库、网易云、QQ音乐、Spotify、电台</div>
        </div>
      )}
    </div>
  );
}
