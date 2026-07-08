import { useEffect, useRef, useState, useCallback } from "react";
import { EmptyStateIcon } from "../../components/EmptyState";
import { ConsoleSearch } from "../../components/ConsoleSearch";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { getCoverUrl } from "./useCover";
import { TrackActions } from "./TrackActions";
import { VirtualTrackList } from "../../components/TrackRow";
import { useVirtualInfiniteScroll } from "../../hooks/useInfiniteScroll";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

type View = "search" | "playlists" | "playlist" | "daily" | "toplists" | "toplist";
type LoginMode = "cookie" | "browser" | null;

interface UserInfo {
  uid: string;
  nickname: string;
  avatar_url?: string;
  vip: boolean;
}

const QUALITY_OPTIONS = [
  { value: "standard", label: "标准" },
  { value: "higher", label: "较高" },
  { value: "exhigh", label: "极高" },
  { value: "lossless", label: "无损" },
  { value: "hires", label: "Hi-Res" },
  { value: "jyeffect", label: "鲸云臻音" },
  { value: "jymaster", label: "鲸云母带" },
  { value: "sky", label: "沉浸环绕声" },
  { value: "dolby", label: "杜比全景声" },
];

const STORAGE_QUALITY_KEY = "orangeradio-netease-quality";

/** 各 tab 的根 view（点击 tab 即跳到此 view，栈被重置为单元素） */
const TAB_ROOTS = {
  myPlaylists: "playlists" as View,
  daily: "daily" as View,
  toplists: "toplists" as View,
  search: "search" as View,
};

/** 提取歌曲封面 URL */
function coverOf(t: Track): string | null { return getCoverUrl(t); }

/** 网易云歌单/榜单信息（含封面） */
interface PlaylistInfo {
  id: string;
  name: string;
  count: number;
  cover: string;
  playCount: number;
}

/** 格式化播放次数：10000+ → 1万 */
function fmtPlay(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

/** 音乐符号占位（无封面时显示） */
const MUSIC_GLYPH = "♪";

/** 网易云音乐视图 */
export function NeteaseView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [quality, setQuality] = useState("standard");
  // 导航：栈式历史，tab 切换 = 重置栈为根，点详情 = 压栈，返回 = 弹栈
  const [viewStack, setViewStack] = useState<View[]>(["playlists"]);
  const view = viewStack[viewStack.length - 1];
  const canGoBack = viewStack.length > 1;
  /** 切到某 tab 的根：清栈，单元素 */
  const goToTab = useCallback((root: View) => {
    setViewStack((prev) => (prev.length === 1 && prev[0] === root ? prev : [root]));
  }, []);
  /** 压栈进入详情 */
  const goToDetail = useCallback((detail: View) => {
    setViewStack((prev) => [...prev, detail]);
  }, []);
  /** 弹栈返回（仅多于一帧时才生效） */
  const goBack = useCallback(() => {
    setViewStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);
  // 数据刷新用 —— 不动栈，只 bump 计数让 useEffect 重新执行
  const [refreshKey, setRefreshKey] = useState(0);
  // 数据
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [toplists, setToplists] = useState<PlaylistInfo[]>([]);
  const [currentPlaylist, setCurrentPlaylist] = useState("");
  const [currentPlaylistId, setCurrentPlaylistId] = useState("");
  const [currentToplist, setCurrentToplist] = useState("");
  const [currentToplistId, setCurrentToplistId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [coverErrors, setCoverErrors] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);       // 搜索分页（仅 search 视图）
  const [hasMore, setHasMore] = useState(false);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => {
    invoke<boolean>("netease_status").then((ok) => {
      setLoggedIn(ok);
      // 登录成功后自动加载歌单（持久化恢复也算登录）
      if (ok) goToTab(TAB_ROOTS.myPlaylists);
    }).catch(() => {});
    // 设置网易云解析器：歌曲ID → 播放URL
    engineRef.resolver = async (trackId: string) => {
      return invoke<string>("netease_stream", { trackId });
    };
    return () => { engineRef.resolver = null; };
  }, [goToTab]);

  // 监听全局 "重新登录" 请求（来自 toast / settings）
  const pendingLogin = usePlayerStore((s) => s.pendingLoginSource);
  useEffect(() => {
    if (pendingLogin === "netease") {
      setLoginMode("browser");
      startBrowserLogin();
      usePlayerStore.getState().clearRelogin();
    }
  }, [pendingLogin]);

  // 浏览器内嵌登录
  const startBrowserLogin = async () => {
    setBrowserLoading(true); setError("");
    try {
      await invoke("netease_login_with_webview");
      setLoggedIn(true); setLoginMode(null);
      goToTab(TAB_ROOTS.myPlaylists);
      // 强制刷新当前 tab 数据：登录态切换后 viewStack 可能没变，需要 bump refreshKey 触发 useEffect 加载
      setRefreshKey((k) => k + 1);
      loadUserInfo();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBrowserLoading(false); }
  };

  const doLogin = async () => {
    if (!cookieInput.trim()) return;
    setLoading(true); setError("");
    try {
      await invoke("netease_login", { cookie: cookieInput });
      setLoggedIn(true); setCookieInput(""); setLoginMode(null);
      goToTab(TAB_ROOTS.myPlaylists);
      // 强制刷新当前 tab 数据
      setRefreshKey((k) => k + 1);
      loadUserInfo();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  // 加载当前登录用户信息
  const loadUserInfo = async () => {
    try {
      const info = await invoke<UserInfo | null>("netease_current_user");
      setUserInfo(info);
    } catch { /* 静默失败 */ }
  };

  // 音质切换：持久化到 localStorage 并同步到后端
  const handleQualityChange = async (level: string) => {
    setQuality(level);
    localStorage.setItem(STORAGE_QUALITY_KEY, level);
    try {
      await invoke("netease_set_quality", { level });
    } catch (e: any) { setError(e?.message || "音质设置失败"); }
  };

  // 组件挂载 + 登录态变化时恢复/同步音质
  useEffect(() => {
    const restoreQuality = async () => {
      const saved = localStorage.getItem(STORAGE_QUALITY_KEY);
      const level = saved && QUALITY_OPTIONS.some((o) => o.value === saved) ? saved : "standard";
      setQuality(level);
      try {
        await invoke("netease_set_quality", { level });
      } catch { /* 后端可能还没 ready */ }
    };
    restoreQuality();
  }, []);

  // 登录态从 false -> true 时加载账号信息
  useEffect(() => {
    if (loggedIn) loadUserInfo();
    else setUserInfo(null);
  }, [loggedIn]);

  const doSearch = useCallback(async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    setPage(1); setHasMore(true);
    try {
      const list = await invoke<Track[]>("netease_search", { keyword, page: 1 });
      if (list.length === 0) { setError("搜索无结果"); setHasMore(false); }
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  }, [keyword, setQueue]);

  // 触发刷新（不动栈）：search 视图走 doSearch，其他走 refreshKey 让 useEffect 重跑
  // viewRef 读最新 view 避免和"view 改变 → useEffect 重跑 → triggerRefresh 调用"形成循环
  const viewRef = useRef(view);
  viewRef.current = view;
  const triggerRefresh = useCallback(() => {
    if (viewRef.current === "search") doSearch();
    else setRefreshKey((k) => k + 1);
  }, [doSearch]);

  /** 加载下一页搜索结果（追加，不覆盖队列原内容） */
  const loadMore = useCallback(async () => {
    if (loading || !hasMore || view !== "search") return;
    const next = page + 1;
    setLoading(true);
    try {
      const list = await invoke<Track[]>("netease_search", { keyword, page: next });
      if (list.length === 0) setHasMore(false);
      else {
        setTracks((prev) => [...prev, ...list]);
        usePlayerStore.getState().addManyToQueue(list);
        setPage(next);
      }
    } catch { /* 静默失败，保留已加载 */ }
    finally { setLoading(false); }
  }, [page, hasMore, loading, keyword, view]);

  const onItemsRendered = useVirtualInfiniteScroll({ hasMore, loading, onLoadMore: loadMore });

  // 进入歌单详情（不改 view，只设置 ID/名称 + 压栈 —— useEffect 负责拉数据）
  const openPlaylist = useCallback((id: string, name: string) => {
    setCurrentPlaylist(name);
    setCurrentPlaylistId(id);
    goToDetail("playlist");
  }, [goToDetail]);

  // 进入榜单详情
  const openToplist = useCallback((id: string, name: string) => {
    setCurrentToplist(name);
    setCurrentToplistId(id);
    goToDetail("toplist");
  }, [goToDetail]);

  // 数据加载 effect：栈顶视图或详情 ID 变化时重新拉数据
  // search 视图不自动加载（等待用户输入）
  useEffect(() => {
    if (view === "search") return;
    setLoading(true); setError("");
    const load = async () => {
      try {
        if (view === "playlists") {
          setCoverErrors({});
          const list = await invoke<PlaylistInfo[]>("netease_playlists");
          setPlaylists(list);
        } else if (view === "toplists") {
          setCoverErrors({});
          const list = await invoke<[string, string, string, number][]>("netease_toplists");
          setToplists(list.map(([id, name, cover, playCount]) => ({ id, name, count: 0, cover, playCount })));
        } else if (view === "daily") {
          const list = await invoke<Track[]>("netease_daily");
          setTracks(list); setQueue(list);
        } else if (view === "playlist" && currentPlaylistId) {
          const list = await invoke<Track[]>("netease_playlist_detail", { playlistId: currentPlaylistId });
          setTracks(list); setQueue(list);
        } else if (view === "toplist" && currentToplistId) {
          const list = await invoke<Track[]>("netease_toplist_detail", { toplistId: currentToplistId });
          setTracks(list); setQueue(list);
        }
      } catch (e: any) { setError(e?.message || String(e)); }
      finally { setLoading(false); }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentPlaylistId, currentToplistId, refreshKey]);

  const handlePlay = async (track: Track, index: number) => {
    try {
      const url = await invoke<string>("netease_stream", { trackId: track.source_track_id });
      usePlayerStore.getState().setCurrent(track, index);
      engineRef.playPath(url);
    } catch (e: any) { setError(e?.message || "播放失败（可能需VIP）"); }
  };

  // ===== 未登录 =====
  if (!loggedIn) {
    return (
      <div className="library__empty">
        <div className="library__empty-icon"><EmptyStateIcon kind="music" /></div>
        <div className="library__empty-title">登录网易云音乐</div>
        <div className="library__empty-desc" style={{ marginBottom: 16 }}>用内嵌浏览器登录最方便，登录态会自动加密保存，下次启动不用重新登录</div>
        {!loginMode && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn-scan" onClick={() => { setLoginMode("browser"); startBrowserLogin(); }}>浏览器登录</button>
            <button className="btn-scan" style={{ background: "#333" }} onClick={() => setLoginMode("cookie")}>Cookie 登录</button>
          </div>
        )}
        {/* 浏览器登录等待中 */}
        {loginMode === "browser" && (
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#aaa7b8" }}>
              {browserLoading ? "已弹出登录窗口，请在窗口中完成登录…" : "正在启动登录窗口…"}
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn-scan" style={{ background: "#333" }} onClick={() => { setLoginMode(null); setBrowserLoading(false); }}>取消</button>
            </div>
          </div>
        )}
        {/* Cookie 登录 */}
        {loginMode === "cookie" && (
          <div style={{ maxWidth: 500, width: "100%", textAlign: "left", marginTop: 20 }}>
            <p style={{ fontSize: 12, color: "#9a9ab0", marginBottom: 8, lineHeight: 1.6 }}>
              1. 浏览器打开 <a style={{ color: "#ff9248" }} onClick={() => open("https://music.163.com/#/login")}>music.163.com</a> 并登录<br />
              2. F12 → Application → Cookies → 复制含 <code style={{ color: "#ff9248" }}>MUSIC_U</code> 的 Cookie<br />
              3. 粘贴到下方
            </p>
            <textarea className="or-input or-input--area" style={{ width: "100%", resize: "none", fontFamily: "var(--font-mono)" }}
              placeholder="MUSIC_U=xxx" value={cookieInput} onChange={(e) => setCookieInput(e.target.value)} />
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
      {/* 导航栏（零 emoji，全部 SVG icon，对标 MineRadio #controls-cluster） */}
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
        <button
          className={`nav-pill ${view === "daily" ? "nav-pill--active" : ""} nav-pill--green`}
          onClick={() => goToTab(TAB_ROOTS.daily)}
        >
          <svg className="nav-pill__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 9h18" />
            <path d="M8 3v4" />
            <path d="M16 3v4" />
            <path d="M8 14l2 2 4-4" />
          </svg>
          每日推荐
        </button>
        <button
          className={`nav-pill ${view === "toplists" || view === "toplist" ? "nav-pill--active" : ""}`}
          onClick={() => goToTab(TAB_ROOTS.toplists)}
        >
          <svg className="nav-pill__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          排行榜
        </button>
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
        <div style={{ flex: 1 }} />
        {/* 账号信息 + 音质选择 */}
        {userInfo && (
          <div
            title={`UID: ${userInfo.uid}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 10px",
              background: "rgba(255,255,255,0.06)",
              borderRadius: 20,
              marginRight: 8,
              fontSize: 12,
              color: "#e8e8ef",
            }}
          >
            {userInfo.avatar_url ? (
              <img
                src={userInfo.avatar_url}
                alt=""
                style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "#ff9248",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  color: "#fff",
                }}
              >
                {userInfo.nickname.charAt(0)}
              </div>
            )}
            <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userInfo.nickname}
            </span>
            {userInfo.vip && (
              <span
                style={{
                  padding: "1px 5px",
                  background: "#ff9248",
                  borderRadius: 4,
                  fontSize: 10,
                  color: "#fff",
                  fontWeight: 600,
                }}
              >
                VIP
              </span>
            )}
          </div>
        )}
        <select
          value={quality}
          onChange={(e) => handleQualityChange(e.target.value)}
          title="网易云播放音质"
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "#e8e8ef",
            border: "none",
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 12,
            marginRight: 8,
            cursor: "pointer",
            outline: "none",
          }}
        >
          {QUALITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} style={{ background: "#1a1a24", color: "#e8e8ef" }}>
              {o.label}
            </option>
          ))}
        </select>
        {/* 刷新：search 视图重搜，其他视图重拉数据（不动栈） */}
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
        <button className="nav-pill nav-pill--ghost" onClick={async () => { await invoke("netease_logout"); setLoggedIn(false); }}>退出</button>
      </div>

      {/* 搜索框 */}
      {view === "search" && (
        <div style={{ marginBottom: 16 }}>
          <ConsoleSearch
            value={keyword}
            onChange={setKeyword}
            onSubmit={doSearch}
            loading={loading}
            placeholder="搜索网易云歌曲…"
          />
        </div>
      )}

      {error && <div style={{ padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {/* 歌单封面网格（MineRadio 风格） */}
      {view === "playlists" && (
        <>
          <div className="section-title">
            <h3>我的歌单</h3>
            <span className="section-title__sub">{playlists.length > 0 ? `${playlists.length} 个歌单` : ""}</span>
          </div>
          <div className="pl-grid">
            {playlists.map((p) => {
              const coverOk = p.cover && !coverErrors[p.id];
              return (
                <div key={p.id} className="pl-card" onClick={() => openPlaylist(p.id, p.name)}>
                  <div className="pl-card__cover">
                    {coverOk ? (
                      <img src={p.cover} alt={p.name} loading="lazy"
                        onError={() => setCoverErrors((m) => ({ ...m, [p.id]: true }))} />
                    ) : (
                      <div className="pl-card__cover-placeholder">{MUSIC_GLYPH}</div>
                    )}
                    {/* 播放次数 */}
                    {p.playCount > 0 && (
                      <div className="pl-card__plays">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        {fmtPlay(p.playCount)}
                      </div>
                    )}
                    {/* 悬停播放按钮 */}
                    <button className="pl-card__play" onClick={(e) => { e.stopPropagation(); openPlaylist(p.id, p.name); }}
                      title="打开歌单">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    </button>
                  </div>
                  <div className="pl-card__meta">
                    <div className="pl-card__name">{p.name}</div>
                    <div className="pl-card__count">{p.count} 首</div>
                  </div>
                </div>
              );
            })}
          </div>
          {loading && playlists.length === 0 && (
            <div className="library__empty"><div className="library__empty-title">加载歌单中…</div></div>
          )}
          {!loading && playlists.length === 0 && (
            <div className="library__empty"><div className="library__empty-title">暂无歌单</div></div>
          )}
        </>
      )}

      {/* 排行榜封面网格 */}
      {view === "toplists" && (
        <>
          <div className="section-title">
            <h3>官方排行榜</h3>
            <span className="section-title__sub">{toplists.length > 0 ? `${toplists.length} 个榜单` : ""}</span>
          </div>
          <div className="pl-grid">
            {toplists.map((p) => {
              const coverOk = p.cover && !coverErrors[p.id];
              return (
                <div key={p.id} className="pl-card" onClick={() => openToplist(p.id, p.name)}>
                  <div className="pl-card__cover">
                    {coverOk ? (
                      <img src={p.cover} alt={p.name} loading="lazy"
                        onError={() => setCoverErrors((m) => ({ ...m, [p.id]: true }))} />
                    ) : (
                      <div className="pl-card__cover-placeholder">{MUSIC_GLYPH}</div>
                    )}
                    {p.playCount > 0 && (
                      <div className="pl-card__plays">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        {fmtPlay(p.playCount)}
                      </div>
                    )}
                    <button className="pl-card__play" onClick={(e) => { e.stopPropagation(); openToplist(p.id, p.name); }}
                      title="打开榜单">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    </button>
                  </div>
                  <div className="pl-card__meta">
                    <div className="pl-card__name">{p.name}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {loading && toplists.length === 0 && (
            <div className="library__empty"><div className="library__empty-title">加载榜单中…</div></div>
          )}
          {!loading && toplists.length === 0 && (
            <div className="library__empty"><div className="library__empty-title">暂无榜单</div></div>
          )}
        </>
      )}

      {/* 歌曲列表（搜索/每日推荐/歌单详情/榜单详情共用） */}
      {(view === "search" || view === "playlist" || view === "daily" || view === "toplist") && tracks.length > 0 && (
        <>
          {(view === "playlist" || view === "toplist") && (
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
              <h3>{view === "playlist" ? currentPlaylist : currentToplist}</h3>
              <span className="section-title__sub">{tracks.length} 首</span>
              <button className="nav-pill nav-pill--active" style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 12 }}
                onClick={() => handlePlay(tracks[0], 0)}>播放全部</button>
            </div>
          )}
          {view === "daily" && (
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
              <h3>每日推荐</h3>
              <span className="section-title__sub">{tracks.length} 首</span>
              <button className="nav-pill nav-pill--active" style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 12 }}
                onClick={() => handlePlay(tracks[0], 0)}>播放全部</button>
            </div>
          )}
          {view === "search" && (
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
              <h3>搜索结果</h3>
              <span className="section-title__sub">{tracks.length} 首</span>
              <button className="nav-pill nav-pill--active" style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 12 }}
                onClick={() => handlePlay(tracks[0], 0)}>播放全部</button>
            </div>
          )}
          <div className="library__list">
            <div className="lib-header"><span className="col-i">#</span><span className="col-title">标题</span>
              <span className="col-artist">艺术家</span><span className="col-album">{view === "playlist" || view === "toplist" ? "专辑" : "专辑"}</span><span className="col-dur">操作</span></div>
            <div className="lib-rows">
              <VirtualTrackList
                tracks={tracks}
                activeId={currentTrack?.id}
                isPlaying={isPlaying}
                onPlay={handlePlay}
                onItemsRendered={view === "search" ? onItemsRendered : undefined}
                renderRow={(t, i) => (
                  <>
                    <span className="col-title" onClick={() => handlePlay(t, i)}>
                      {coverOf(t) && <img src={coverOf(t)!} alt="" className="col-title__cover" loading="lazy" />}
                      <span className="col-title__txt">{t.meta.title}</span>
                      <span className="q-badge q-high">NE</span>
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
        </>
      )}

      {loading && tracks.length === 0 && view !== "playlists" && view !== "toplists" && (
        <div className="library__empty"><div className="library__empty-title">加载中…</div></div>
      )}
    </div>
  );
}
