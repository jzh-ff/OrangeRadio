import { useEffect, useState, useRef, useCallback } from "react";
import { ConsoleSearch } from "../../components/ConsoleSearch";
import { EmptyStateIcon } from "../../components/EmptyState";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { TrackActions } from "./TrackActions";
import { VirtualTrackList } from "../../components/TrackRow";
import { useVirtualInfiniteScroll } from "../../hooks/useInfiniteScroll";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

type View = "search" | "playlists" | "playlist";
type LoginMode = "cookie" | "qrcode" | null;

/** 各 tab 的根 view（点击 tab 即跳到此 view，栈被重置为单元素） */
const TAB_ROOTS = {
  search: "search" as View,
  myPlaylists: "playlists" as View,
};

interface PlaylistInfo {
  id: string;
  name: string;
  count: number;
  cover: string;
}

/** QQ 音乐视图 */
export function QqMusicView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>(null);
  // 导航：栈式历史，tab 切换 = 重置栈为根，点详情 = 压栈，返回 = 弹栈
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
  // 刷新用 —— 不动栈
  const [refreshKey, setRefreshKey] = useState(0);
  // 扫码登录状态
  const [qrKey, setQrKey] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [qrStatus, setQrStatus] = useState("");
  const pollRef = useRef<number>(0);
  // 数据
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentPlaylist, setCurrentPlaylist] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => {
    invoke<boolean>("qqmusic_status").then(setLoggedIn).catch(() => {});
  }, []);

  // 监听全局 "重新登录" 请求（来自 toast / settings）
  const pendingLogin = usePlayerStore((s) => s.pendingLoginSource);
  useEffect(() => {
    if (pendingLogin === "qqmusic") {
      setLoginMode("qrcode");
      startQrLogin();
      usePlayerStore.getState().clearRelogin();
    }
  }, [pendingLogin]);

  // 扫码登录：生成二维码 + 轮询
  const startQrLogin = async () => {
    setError("");
    try {
      const info = await invoke<{ key: string; qr_url: string }>("qqmusic_qrcode_create");
      setQrKey(info.key);
      setQrUrl(info.qr_url);
      setQrStatus("请用 QQ APP 扫码");
      // 开始轮询
      pollQrStatus(info.key);
    } catch (e: any) {
      setError(e?.message || "获取二维码失败");
    }
  };

  const pollQrStatus = (key: string) => {
    window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const status = await invoke<{ code: number; message: string }>("qqmusic_qrcode_check", { key });
        setQrStatus(status.message);
        if (status.code === 0) {
          // 登录成功
          window.clearInterval(pollRef.current);
          setLoggedIn(true);
          setLoginMode(null);
        } else if (status.code === 65) {
          // 过期，停止轮询
          window.clearInterval(pollRef.current);
          setQrStatus("二维码已过期，请重新生成");
        }
      } catch {
        // 忽略单次轮询错误
      }
    }, 2000);
  };

  useEffect(() => () => window.clearInterval(pollRef.current), []);

  const doLogin = async () => {
    if (!cookieInput.trim()) return;
    setLoading(true); setError("");
    try {
      await invoke("qqmusic_login", { cookie: cookieInput });
      setLoggedIn(true); setLoginMode(null); setCookieInput("");
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const doSearch = useCallback(async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    setPage(1); setHasMore(true);
    try {
      const list = await invoke<Track[]>("qqmusic_search", { keyword, page: 1 });
      if (list.length === 0) setHasMore(false);
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  }, [keyword, setQueue]);

  // 刷新（不动栈）：search 视图走 doSearch，其他走 refreshKey 让 useEffect 重跑
  const viewRef = useRef(view);
  viewRef.current = view;
  const triggerRefresh = useCallback(() => {
    if (viewRef.current === "search") doSearch();
    else setRefreshKey((k) => k + 1);
  }, [doSearch]);

  /** 加载下一页搜索结果 */
  const loadMore = useCallback(async () => {
    if (loading || !hasMore || view !== "search") return;
    const next = page + 1;
    setLoading(true);
    try {
      const list = await invoke<Track[]>("qqmusic_search", { keyword, page: next });
      if (list.length === 0) setHasMore(false);
      else {
        setTracks((prev) => [...prev, ...list]);
        usePlayerStore.getState().addManyToQueue(list);
        setPage(next);
      }
    } catch { /* 静默 */ }
    finally { setLoading(false); }
  }, [page, hasMore, loading, keyword, view]);

  const onItemsRendered = useVirtualInfiniteScroll({ hasMore, loading, onLoadMore: loadMore });

  /** 打开歌单详情（不改 view，只设置 ID/名称 + 压栈 —— useEffect 负责拉数据） */
  const [currentPlaylistId, setCurrentPlaylistId] = useState("");
  const openPlaylist = useCallback((id: string, name: string) => {
    setCurrentPlaylist(name);
    setCurrentPlaylistId(id);
    goToDetail("playlist");
  }, [goToDetail]);

  // 数据加载 effect：栈顶视图变化时拉数据
  // search 视图不自动加载（等待用户输入）
  useEffect(() => {
    if (view === "search") return;
    setLoading(true); setError("");
    const load = async () => {
      try {
        if (view === "playlists") {
          const list = await invoke<PlaylistInfo[]>("qqmusic_playlists");
          setPlaylists(list);
        } else if (view === "playlist" && currentPlaylistId) {
          const list = await invoke<Track[]>("qqmusic_playlist_detail", { playlistId: currentPlaylistId });
          setTracks(list); setQueue(list);
        }
      } catch (e: any) { setError(e?.message || String(e)); }
      finally { setLoading(false); }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentPlaylistId, refreshKey]);

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  // ===== 未登录 =====
  if (!loggedIn) {
    return (
      <div className="library__empty">
        <div className="library__empty-icon"><EmptyStateIcon kind="music" /></div>
        <div className="library__empty-title">QQ音乐未登录</div>
        <div className="library__empty-desc" style={{ marginBottom: 20 }}>选择登录方式</div>
        {!loginMode && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn-scan" onClick={() => { setLoginMode("qrcode"); startQrLogin(); }}>扫码登录</button>
            <button className="btn-scan" style={{ background: "#333" }} onClick={() => setLoginMode("cookie")}>Cookie 登录</button>
          </div>
        )}
        {/* 扫码登录 */}
        {loginMode === "qrcode" && (
          <div style={{ marginTop: 20, textAlign: "center" }}>
            {qrUrl && (
              <div style={{ display: "inline-block", padding: 12, background: "#fff", borderRadius: 12, marginBottom: 12 }}>
                <img src={qrUrl} alt="QQ登录二维码" style={{ width: 200, height: 200 }} />
              </div>
            )}
            <div style={{ fontSize: 13, color: qrStatus.includes("过期") ? "#ff6b6b" : "#aaa7b8" }}>{qrStatus}</div>
            <button className="btn-scan" style={{ background: "#333", marginTop: 12 }} onClick={startQrLogin}>刷新二维码</button>
            <button className="btn-scan" style={{ background: "#333", marginTop: 12, marginLeft: 8 }} onClick={() => { window.clearInterval(pollRef.current); setLoginMode(null); }}>返回</button>
          </div>
        )}
        {/* Cookie 登录 */}
        {loginMode === "cookie" && (
          <div style={{ maxWidth: 500, width: "100%", textAlign: "left", marginTop: 20 }}>
            <p style={{ fontSize: 12, color: "#9a9ab0", marginBottom: 8, lineHeight: 1.6 }}>
              1. 浏览器打开 y.qq.com 并登录<br />
              2. F12 → Application → Cookies → 复制含 <code style={{ color: "#ff9248" }}>uin</code> 和 <code style={{ color: "#ff9248" }}>qqmusic_key</code> 的 Cookie<br />
              3. 粘贴到下方
            </p>
            <textarea className="or-input or-input--area" style={{ width: "100%", resize: "none", fontFamily: "var(--font-mono)" }}
              placeholder="uin=xxx; qqmusic_key=xxx" value={cookieInput} onChange={(e) => setCookieInput(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-scan" onClick={doLogin} disabled={loading}>{loading ? "登录中…" : "确认登录"}</button>
              <button className="btn-scan" style={{ background: "#333" }} onClick={() => setLoginMode(null)}>返回</button>
            </div>
          </div>
        )}
        {error && <div style={{ marginTop: 16, padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, maxWidth: 500 }}>{error}</div>}
      </div>
    );
  }

  // ===== 已登录 =====
  return (
    <div className="library">
      {/* 导航栏（零 emoji，全部 SVG icon） */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {/* 栈式「返回上一级」：栈深 > 1 时显示，弹栈（useEffect 重新加载数据） */}
        {canGoBack && (
          <button
            className="nav-pill nav-pill--ghost"
            onClick={goBack}
            title="返回上一级"
            aria-label="返回上一级"
          >
            <svg className="nav-pill__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            返回
          </button>
        )}
        <button
          className={`nav-pill ${view === "search" ? "nav-pill--active" : ""}`}
          onClick={() => goToTab(TAB_ROOTS.search)}
        >
          <svg className="nav-pill__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          搜索
        </button>
        <button
          className={`nav-pill ${view === "playlists" || view === "playlist" ? "nav-pill--active" : ""}`}
          onClick={() => goToTab(TAB_ROOTS.myPlaylists)}
        >
          <svg className="nav-pill__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h13" />
            <path d="M3 12h13" />
            <path d="M3 18h9" />
            <path d="M17 14v6" />
            <path d="M14 17h6" />
          </svg>
          我的歌单
        </button>
        <div style={{ flex: 1 }} />
        {/* 刷新：search 视图重搜，其他视图重拉（不动栈） */}
        {view !== "search" || keyword.trim() ? (
          <button className="nav-pill nav-pill--ghost" onClick={triggerRefresh} title="刷新">
            <svg className="nav-pill__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            刷新
          </button>
        ) : null}
        <button className="nav-pill nav-pill--ghost" onClick={async () => { await invoke("qqmusic_logout" as any).catch(() => {}); setLoggedIn(false); }}>退出</button>
      </div>

      {/* 搜索框 */}
      {view === "search" && (
        <div style={{ marginBottom: 16 }}>
          <ConsoleSearch
            value={keyword}
            onChange={setKeyword}
            onSubmit={doSearch}
            loading={loading}
            placeholder="搜索 QQ 音乐…"
          />
        </div>
      )}

      {error && <div style={{ padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {/* 歌单网格 */}
      {view === "playlists" && (
        <>
          <div className="section-title">
            <h3>我的歌单</h3>
            <span className="section-title__sub">{playlists.length > 0 ? `${playlists.length} 个歌单` : ""}</span>
          </div>
          <div className="pl-grid">
            {playlists.map((p) => (
              <div key={p.id} className="pl-card" onClick={() => openPlaylist(p.id, p.name)}>
                <div className="pl-card__cover">
                  {p.cover ? <img src={p.cover} alt={p.name} loading="lazy" /> : <div className="pl-card__cover-placeholder">♪</div>}
                </div>
                <div className="pl-card__meta">
                  <div className="pl-card__name">{p.name}</div>
                  <div className="pl-card__count">{p.count} 首</div>
                </div>
              </div>
            ))}
          </div>
          {loading && playlists.length === 0 && <div className="library__empty"><div className="library__empty-title">加载中…</div></div>}
          {!loading && playlists.length === 0 && <div className="library__empty"><div className="library__empty-title">暂无歌单</div></div>}
        </>
      )}

      {/* 歌曲列表（搜索，带分页） */}
      {view === "search" && tracks.length > 0 && (
        <div className="library__list">
          <div className="lib-header"><span className="col-i">#</span><span className="col-title">标题</span>
            <span className="col-artist">歌手</span><span className="col-album">专辑</span><span className="col-dur">操作</span></div>
          <div className="lib-rows">
            <VirtualTrackList
              tracks={tracks}
              activeId={currentTrack?.id}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onItemsRendered={onItemsRendered}
              renderRow={(t, i) => (
                <>
                  <span className="col-title">
                    <span className="col-title__txt">{t.meta.title}</span>
                    <span className="q-badge q-high">QQ</span>
                  </span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
                  <span className="col-dur"><TrackActions track={t} /></span>
                </>
              )}
            />
          </div>
        </div>
      )}

      {/* 歌单详情列表 */}
      {view === "playlist" && tracks.length > 0 && (
        <>
          <div className="section-title">
            <button
              className="section-title__back"
              onClick={goBack}
              title="返回上一级"
              aria-label="返回上一级"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </button>
            <h3>{currentPlaylist}</h3>
            <span className="section-title__sub">{tracks.length} 首</span>
            <button className="nav-pill nav-pill--active" style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 12 }}
              onClick={() => handlePlay(tracks[0], 0)}>播放全部</button>
          </div>
          <div className="library__list">
            <div className="lib-header"><span className="col-i">#</span><span className="col-title">标题</span>
              <span className="col-artist">歌手</span><span className="col-album">专辑</span><span className="col-dur">操作</span></div>
            <div className="lib-rows">
              <VirtualTrackList
                tracks={tracks}
                activeId={currentTrack?.id}
                isPlaying={isPlaying}
                onPlay={handlePlay}
                renderRow={(t, i) => (
                  <>
                    <span className="col-title">
                      <span className="col-title__txt">{t.meta.title}</span>
                      <span className="q-badge q-high">QQ</span>
                    </span>
                    <span className="col-artist">{t.meta.artist}</span>
                    <span className="col-album">{t.meta.album || "—"}</span>
                    <span className="col-dur"><TrackActions track={t} /></span>
                  </>
                )}
              />
            </div>
          </div>
        </>
      )}

      {loading && tracks.length === 0 && view === "search" && (
        <div className="library__empty"><div className="library__empty-title">加载中…</div></div>
      )}
      {!loading && view === "search" && tracks.length === 0 && (
        <div className="library__empty"><div className="library__empty-icon"><EmptyStateIcon kind="music" /></div><div className="library__empty-title">搜索QQ音乐</div></div>
      )}
    </div>
  );
}
