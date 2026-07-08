import { useMemo, useState } from "react";
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
  unknown: { label: "其他", cls: "q-std" },
};

/** tab 顺序：按主流 → 长尾排（"全部" 永远在最左） */
const TAB_ORDER = [
  "local",
  "netease_cloud_music",
  "qq_music",
  "kugou",
  "kuwo",
  "qishui",
  "spotify",
  "web_radio",
  "podcast",
  "unknown",
] as const;
type SourceKindKey = (typeof TAB_ORDER)[number];

/** 聚合搜索结果视图（tab 切换 = 按源过滤；"全部" = 混合列表） */
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

  // "all" 或具体的 source_kind —— 决定列表显示哪个源的结果
  // 类型用 string 兜底：TAB_ORDER 里的 key 是合法的 SourceKind 子集但比全局 SourceKind 多一个 kuwo
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  // 统计各源结果数 —— 兜底：source_kind 为空 / 不在 TAB_ORDER 里都归到 "unknown"
  const sourceCounts = useMemo(() => {
    return results.reduce((acc, t) => {
      const k = (t.source_kind && (TAB_ORDER as readonly string[]).includes(t.source_kind))
        ? t.source_kind
        : "unknown";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [results]);

  // 根据当前 tab 过滤可见结果
  const visibleResults = useMemo(() => {
    if (sourceFilter === "all") return results;
    return results.filter((t) => {
      const k = (t.source_kind && (TAB_ORDER as readonly string[]).includes(t.source_kind))
        ? t.source_kind
        : "unknown";
      return k === sourceFilter;
    });
  }, [results, sourceFilter]);

  // 切 tab 时重置虚拟滚动 / loadMore 状态：如果该源结果数 < page_size(50)，
  // 就别触发 loadMore（按"满 page_size 才认为有更多"的保守规则在 store 里）
  const visibleHasMore = sourceFilter === "all" ? hasMore : visibleResults.length >= 50;
  const onItemsRendered = useVirtualInfiniteScroll({
    hasMore: visibleHasMore,
    loading,
    onLoadMore: loadMore,
  });

  // 列出实际有结果的 tab（只展示有命中的源，不浪费横向空间）
  const availableTabs = useMemo(() => {
    return TAB_ORDER.filter((k) => sourceCounts[k] && sourceCounts[k] > 0);
  }, [sourceCounts]);

  return (
    <div className="library">
      <div className="section-title">
        <h3>全网搜索</h3>
        <span className="section-title__sub">
          {results.length > 0
            ? sourceFilter === "all"
              ? `${results.length} 条结果`
              : `${visibleResults.length} 条来自 ${SOURCE_BADGE[sourceFilter]?.label || sourceFilter}`
            : ""}
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

      {/* 来源 tab：「全部」+ 各命中源；点击切换列表过滤 */}
      {results.length > 0 && (
        <div className="search-tabs" role="tablist" aria-label="按来源筛选结果">
          <button
            type="button"
            role="tab"
            aria-selected={sourceFilter === "all"}
            className={`search-tabs__tab ${sourceFilter === "all" ? "search-tabs__tab--active" : ""}`}
            onClick={() => setSourceFilter("all")}
          >
            全部
            <span className="search-tabs__count">{results.length}</span>
          </button>
          {availableTabs.map((kind) => {
            const badge = SOURCE_BADGE[kind] || { label: kind, cls: "q-std" };
            return (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={sourceFilter === kind}
                className={`search-tabs__tab ${sourceFilter === kind ? "search-tabs__tab--active" : ""}`}
                onClick={() => setSourceFilter(kind)}
              >
                {badge.label}
                <span className={`search-tabs__count search-tabs__count--${badge.cls.replace("q-", "")}`}>
                  {sourceCounts[kind]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 结果列表 */}
      {visibleResults.length > 0 ? (
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
              tracks={visibleResults}
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
      ) : keyword && results.length > 0 ? (
        // 已搜出结果但当前 tab 下没有（极少出现 —— 比如切到一个空源 tab）
        <div className="library__empty">
          <div className="library__empty-title">该来源暂无结果</div>
          <div className="library__empty-desc">切到其他来源试试</div>
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
