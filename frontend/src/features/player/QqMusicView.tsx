import { useEffect, useState, useRef, useCallback } from "react";
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
  const [view, setView] = useState<View>("search");
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

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError(""); setView("search");
    setPage(1); setHasMore(true);
    try {
      const list = await invoke<Track[]>("qqmusic_search", { keyword, page: 1 });
      if (list.length === 0) setHasMore(false);
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

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

  /** 打开歌单详情（修复：原卡片无 onClick） */
  const openPlaylist = async (id: string, name: string) => {
    setLoading(true); setError(""); setView("playlist"); setCurrentPlaylist(name);
    try {
      const list = await invoke<Track[]>("qqmusic_playlist_detail", { playlistId: id });
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const loadPlaylists = async () => {
    setLoading(true); setError(""); setView("playlists");
    try {
      const list = await invoke<PlaylistInfo[]>("qqmusic_playlists");
      setPlaylists(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  // ===== 未登录 =====
  if (!loggedIn) {
    return (
      <div className="library__empty">
        <div className="library__empty-icon">🎵</div>
        <div className="library__empty-title">QQ音乐未登录</div>
        <div className="library__empty-desc" style={{ marginBottom: 20 }}>选择登录方式</div>
        {!loginMode && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn-scan" onClick={() => { setLoginMode("qrcode"); startQrLogin(); }}>📱 扫码登录</button>
            <button className="btn-scan" style={{ background: "#333" }} onClick={() => setLoginMode("cookie")}>🍪 Cookie 登录</button>
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
            <textarea className="library__search-input" style={{ height: 70, paddingTop: 10, resize: "none", fontFamily: "monospace" }}
              placeholder="uin=xxx; qqmusic_key=xxx" value={cookieInput} onChange={(e) => setCookieInput(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-scan" onClick={doLogin} disabled={loading}>{loading ? "登录中…" : "确认登录"}</button>
              <button className="btn-scan" style={{ background: "#333" }} onClick={() => setLoginMode(null)}>返回</button>
            </div>
          </div>
        )}
        {error && <div style={{ marginTop: 16, padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, maxWidth: 500 }}>⚠️ {error}</div>}
      </div>
    );
  }

  // ===== 已登录 =====
  return (
    <div className="library">
      {/* 导航栏（零 emoji，全部 SVG icon） */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button className={`nav-pill ${view === "search" ? "nav-pill--active" : ""}`} onClick={() => setView("search")}>
          <svg className="nav-pill__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          搜索
        </button>
        <button className={`nav-pill ${view === "playlists" ? "nav-pill--active" : ""}`} onClick={loadPlaylists}>
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
        <button className="nav-pill nav-pill--ghost" onClick={async () => { await invoke("qqmusic_logout" as any).catch(() => {}); setLoggedIn(false); }}>退出</button>
      </div>

      {/* 搜索框 */}
      {view === "search" && (
        <div className="library__toolbar" style={{ marginBottom: 16 }}>
          <div className="library__search">
            <svg className="library__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input className="library__search-input" placeholder="搜索QQ音乐…" value={keyword}
              onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
          </div>
        </div>
      )}

      {error && <div style={{ padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, marginBottom: 16 }}>⚠️ {error}</div>}

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
                  {p.cover ? <img src={p.cover} alt={p.name} loading="lazy" /> : <div className="pl-card__cover-placeholder">🎵</div>}
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

      {/* 歌单详情列表（修复：原 view 缺 playlist） */}
      {view === "playlist" && tracks.length > 0 && (
        <>
          <div className="section-title">
            <h3>{currentPlaylist}</h3>
            <span className="section-title__sub">{tracks.length} 首</span>
            <button className="nav-pill nav-pill--active" style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 12 }}
              onClick={() => handlePlay(tracks[0], 0)}>▶ 播放全部</button>
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
        <div className="library__empty"><div className="library__empty-icon">🎵</div><div className="library__empty-title">搜索QQ音乐</div></div>
      )}
    </div>
  );
}
