import { useEffect, useState, useCallback, useRef } from "react";
import { EmptyStateIcon } from "../../components/EmptyState";
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

interface UserInfo {
  uid: string;
  nickname: string;
  avatar_url?: string;
  vip: boolean;
}

interface PlaylistInfo {
  id: string;
  name: string;
  cover_url?: string;
  track_count?: number;
}

type View = "search" | "playlists" | "playlist";

function coverOf(t: Track): string | null { return getCoverUrl(t); }

/** 酷狗音乐视图：搜索 + Cookie 登录 + 我的歌单 + 歌单详情 + 歌词 */
export function KugouView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [viewStack, setViewStack] = useState<View[]>(["search"]);
  const view = viewStack[viewStack.length - 1];
  const canGoBack = viewStack.length > 1;

  const goToTab = useCallback((root: View) => {
    setViewStack((prev) => (prev.length === 1 && prev[0] === root ? prev : [root]));
  }, []);
  const goToDetail = useCallback((detail: View) => {
    setViewStack((prev) => [...prev, detail]);
  }, []);
  const goBack = useCallback(() => {
    setViewStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // 搜索数据
  const [songs, setSongs] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // 歌单数据
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [currentPlaylistId, setCurrentPlaylistId] = useState("");
  const [currentPlaylistName, setCurrentPlaylistName] = useState("");
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const viewRef = useRef(view);
  viewRef.current = view;

  // 检查登录态并加载用户信息
  useEffect(() => {
    invoke<boolean>("kugou_status")
      .then((ok) => {
        setLoggedIn(ok);
        if (ok) loadUserInfo();
      })
      .catch(() => {});
  }, []);

  const loadUserInfo = async () => {
    try {
      const info = await invoke<UserInfo | null>("kugou_current_user");
      setUserInfo(info);
    } catch { /* 静默失败 */ }
  };

  const loadPlaylists = async () => {
    if (!loggedIn) return;
    setPlaylistLoading(true);
    try {
      const list = await invoke<PlaylistInfo[]>("kugou_playlists");
      setPlaylists(list);
    } catch (e: any) {
      console.warn("[酷狗] 加载歌单失败:", e);
      setPlaylists([]);
    } finally {
      setPlaylistLoading(false);
    }
  };

  useEffect(() => {
    if (view === "playlists") loadPlaylists();
  }, [view, loggedIn]);

  const doLogin = async () => {
    if (!cookieInput.trim()) return;
    setLoading(true); setError("");
    try {
      await invoke("kugou_login", { cookie: cookieInput });
      setLoggedIn(true); setCookieInput("");
      loadUserInfo();
      goToTab("playlists");
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const doLogout = async () => {
    try {
      await invoke("kugou_logout");
      setLoggedIn(false);
      setUserInfo(null);
      setPlaylists([]);
      goToTab("search");
    } catch (e: any) { setError(e?.message || String(e)); }
  };

  const openPlaylist = useCallback(async (id: string, name: string) => {
    setCurrentPlaylistId(id);
    setCurrentPlaylistName(name);
    setPlaylistTracks([]);
    goToDetail("playlist");
    setLoading(true);
    try {
      const list = await invoke<Track[]>("kugou_playlist_detail", { playlistId: id });
      setPlaylistTracks(list);
      usePlayerStore.getState().setQueue(list);
    } catch (e: any) {
      setError(e?.message || "歌单加载失败");
    } finally {
      setLoading(false);
    }
  }, [goToDetail]);

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    setPage(1); setHasMore(true);
    try {
      const list = await invoke<Track[]>("kugou_search", { keyword, page: 1 });
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
    if (loading || !hasMore || !keyword.trim() || viewRef.current !== "search") return;
    const next = page + 1;
    setLoading(true);
    try {
      const list = await invoke<Track[]>("kugou_search", { keyword, page: next });
      if (list.length === 0) setHasMore(false);
      else {
        setSongs((prev) => [...prev, ...list]);
        usePlayerStore.getState().addManyToQueue(list);
        setPage(next);
      }
    } catch { /* 静默失败 */ }
    finally { setLoading(false); }
  }, [page, hasMore, loading, keyword]);

  const onItemsRendered = useVirtualInfiniteScroll({ hasMore, loading, onLoadMore: loadMore });

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  const renderTrackRow = (t: Track, i: number) => {
    const cover = coverOf(t);
    return (
      <>
        <span className="col-title" onClick={() => handlePlay(t, i)}>
          {cover && <img src={cover} alt="" className="col-title__cover" loading="lazy" />}
          <span className="col-title__txt">{t.meta.title}</span>
          <span className="q-badge q-high">KG</span>
        </span>
        <span className="col-artist">{t.meta.artist}</span>
        <span className="col-album">{t.meta.album || "—"}</span>
        <span className="col-dur">
          <TrackActions track={t} size={14} />
        </span>
      </>
    );
  };

  return (
    <div className="library">
      {/* 顶部导航 */}
      <div className="section-title">
        <h3>酷狗音乐</h3>
        <span className="section-title__sub">
          {loggedIn ? userInfo?.nickname || "已登录" : "免登录搜索 · Cookie 登录解锁歌单"}
        </span>
      </div>

      {/* 登录区 */}
      {!loggedIn ? (
        <div className="kugou-login">
          <div className="kugou-login__hint">
            粘贴酷狗网页端 Cookie（需包含 uid / token 等登录态字段）即可同步「我的歌单」。
          </div>
          <textarea
            className="kugou-login__input"
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            placeholder="kg_mid=...; uid=...; ..."
            rows={3}
          />
          <button
            type="button"
            className="kugou-login__btn"
            onClick={doLogin}
            disabled={loading || !cookieInput.trim()}
          >
            {loading ? "登录中…" : "Cookie 登录"}
          </button>
        </div>
      ) : (
        <div className="kugou-user">
          <div className="kugou-user__avatar">
            {userInfo?.avatar_url ? (
              <img src={userInfo.avatar_url} alt="" />
            ) : (
              <span>♪</span>
            )}
          </div>
          <div className="kugou-user__meta">
            <div className="kugou-user__name">{userInfo?.nickname || "酷狗用户"}</div>
            {userInfo?.vip && <span className="kugou-user__vip">VIP</span>}
          </div>
          <button type="button" className="kugou-user__logout" onClick={doLogout}>退出</button>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="search-tabs" role="tablist" aria-label="酷狗视图">
        <button
          type="button"
          role="tab"
          className={`search-tabs__tab ${view === "search" ? "search-tabs__tab--active" : ""}`}
          onClick={() => goToTab("search")}
        >
          搜索
        </button>
        <button
          type="button"
          role="tab"
          className={`search-tabs__tab ${view === "playlists" || view === "playlist" ? "search-tabs__tab--active" : ""}`}
          onClick={() => goToTab("playlists")}
        >
          我的歌单
        </button>
        {view === "playlist" && (
          <button type="button" className="search-tabs__tab" onClick={goBack}>← {currentPlaylistName}</button>
        )}
      </div>

      {error && (
        <div className="library__error">{error}</div>
      )}

      {/* 搜索视图 */}
      {view === "search" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <ConsoleSearch
              value={keyword}
              onChange={setKeyword}
              onSubmit={doSearch}
              loading={loading}
              placeholder="搜索酷狗音乐…"
            />
          </div>
          {songs.length === 0 && !loading ? (
            <div className="library__empty">
              <div className="library__empty-icon"><EmptyStateIcon kind="music" /></div>
              <div className="library__empty-title">{error ? "加载失败" : "酷狗音乐"}</div>
              <div className="library__empty-desc">输入关键词搜索歌曲</div>
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
                  renderRow={renderTrackRow}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* 歌单列表 */}
      {view === "playlists" && (
        <>
          {!loggedIn ? (
            <div className="library__empty">
              <div className="library__empty-title">登录后查看歌单</div>
              <div className="library__empty-desc">在上方粘贴 Cookie 登录</div>
            </div>
          ) : playlistLoading ? (
            <div className="library__empty"><div className="library__empty-title">加载歌单…</div></div>
          ) : playlists.length === 0 ? (
            <div className="library__empty">
              <div className="library__empty-title">暂无歌单</div>
              <div className="library__empty-desc">登录后未获取到歌单，可能 Cookie 已过期或接口变动</div>
            </div>
          ) : (
            <div className="kugou-playlist-grid">
              {playlists.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="kugou-playlist-card"
                  onClick={() => openPlaylist(p.id, p.name)}
                >
                  <div className="kugou-playlist-card__cover">
                    {p.cover_url ? (
                      <img src={p.cover_url} alt={p.name} loading="lazy" />
                    ) : (
                      <div className="kugou-playlist-card__fallback">♪</div>
                    )}
                  </div>
                  <div className="kugou-playlist-card__name">{p.name}</div>
                  {p.track_count != null && (
                    <div className="kugou-playlist-card__count">{p.track_count} 首</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* 歌单详情 */}
      {view === "playlist" && (
        <>
          {playlistTracks.length === 0 ? (
            <div className="library__empty">
              <div className="library__empty-title">{loading ? "加载中…" : "歌单为空"}</div>
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
                  tracks={playlistTracks}
                  activeId={currentTrack?.id}
                  isPlaying={isPlaying}
                  onPlay={handlePlay}
                  renderRow={renderTrackRow}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
