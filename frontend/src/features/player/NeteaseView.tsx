import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import QRCode from "qrcode";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { getCoverUrl } from "./useCover";
import { TrackActions } from "./TrackActions";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

type View = "search" | "playlists" | "playlist";
type LoginMode = "cookie" | "qrcode" | null;

/** 提取歌曲封面 URL */
function coverOf(t: Track): string | null { return getCoverUrl(t); }

/** 网易云歌单信息（含封面） */
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
const MUSIC_GLYPH = "🎵";

/** 网易云音乐视图 */
export function NeteaseView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>(null);
  // 扫码登录状态
  const [qrKey, setQrKey] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrStatus, setQrStatus] = useState("");
  const pollRef = useRef<number>(0);
  // 导航
  const [view, setView] = useState<View>("playlists");
  // 数据
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [currentPlaylist, setCurrentPlaylist] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [coverErrors, setCoverErrors] = useState<Record<string, boolean>>({});
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => {
    invoke<boolean>("netease_status").then((ok) => {
      setLoggedIn(ok);
      // 登录成功后自动加载歌单（持久化恢复也算登录）
      if (ok) loadPlaylists();
    }).catch(() => {});
    // 设置网易云解析器：歌曲ID → 播放URL
    engineRef.resolver = async (trackId: string) => {
      return invoke<string>("netease_stream", { trackId });
    };
    return () => { engineRef.resolver = null; };
  }, []);

  // 监听全局 "重新登录" 请求（来自 toast / settings）
  const pendingLogin = usePlayerStore((s) => s.pendingLoginSource);
  useEffect(() => {
    if (pendingLogin === "netease") {
      setLoginMode("qrcode");
      startQrLogin();
      usePlayerStore.getState().clearRelogin();
    }
  }, [pendingLogin]);

  useEffect(() => () => window.clearInterval(pollRef.current), []);

  // 扫码登录：调用后端拿 unikey → 用 QRCode 渲染 → 轮询状态
  const startQrLogin = async () => {
    setError(""); setQrDataUrl(""); setQrStatus("生成二维码中…");
    try {
      const info = await invoke<{ key: string; qr_url: string }>("netease_qrcode_create");
      setQrKey(info.key);
      // 后端返回的是文本 URL（如 https://music.163.com/login?codekey=xxx），
      // 前端用 qrcode 包生成 base64 图片再喂给 <img>
      const dataUrl = await QRCode.toDataURL(info.qr_url, {
        width: 220,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
      setQrStatus("请用网易云 APP 扫码");
      pollQrStatus(info.key);
    } catch (e: any) {
      setError(e?.message || "获取二维码失败");
      setQrStatus("");
    }
  };

  const pollQrStatus = (key: string) => {
    window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const status = await invoke<{ code: number; message: string }>("netease_qrcode_check", { key });
        setQrStatus(status.message);
        if (status.code === 803) {
          window.clearInterval(pollRef.current);
          setLoggedIn(true);
          setLoginMode(null);
          loadPlaylists();
        } else if (status.code === 800) {
          window.clearInterval(pollRef.current);
          setQrStatus("二维码已过期，请重新生成");
        } else if (status.code === 8821) {
          // 网易云安全风控：非官方客户端被识别。直接切到 Cookie 登录界面引导用户
          window.clearInterval(pollRef.current);
          setError(status.message || "网易云风控拦截，请改用 Cookie 登录");
          setLoginMode("cookie");
        }
      } catch {
        // 忽略单次轮询错误
      }
    }, 2000);
  };

  const doLogin = async () => {
    if (!cookieInput.trim()) return;
    setLoading(true); setError("");
    try {
      await invoke("netease_login", { cookie: cookieInput });
      setLoggedIn(true); setCookieInput(""); setLoginMode(null);
      loadPlaylists();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError(""); setView("search");
    try {
      const list = await invoke<Track[]>("netease_search", { keyword });
      if (list.length === 0) setError("搜索无结果");
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const loadPlaylists = async () => {
    setLoading(true); setError(""); setView("playlists"); setCoverErrors({});
    try {
      const list = await invoke<PlaylistInfo[]>("netease_playlists");
      setPlaylists(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const loadDaily = async () => {
    setLoading(true); setError(""); setView("search");
    try {
      const list = await invoke<Track[]>("netease_daily");
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const openPlaylist = async (id: string, name: string) => {
    setLoading(true); setError(""); setView("playlist"); setCurrentPlaylist(name);
    try {
      const list = await invoke<Track[]>("netease_playlist_detail", { playlistId: id });
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

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
        <div className="library__empty-icon">🎵</div>
        <div className="library__empty-title">登录网易云音乐</div>
        <div className="library__empty-desc" style={{ marginBottom: 16 }}>扫码登录最方便，登录态会自动加密保存，下次启动不用重新登录</div>
        {!loginMode && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn-scan" onClick={() => { setLoginMode("qrcode"); startQrLogin(); }}>📱 扫码登录</button>
            <button className="btn-scan" style={{ background: "#333" }} onClick={() => setLoginMode("cookie")}>🍪 Cookie 登录</button>
          </div>
        )}
        {/* 扫码登录 */}
        {loginMode === "qrcode" && (
          <div style={{ marginTop: 20, textAlign: "center" }}>
            {qrDataUrl && (
              <div style={{ display: "inline-block", padding: 12, background: "#fff", borderRadius: 12, marginBottom: 12 }}>
                <img src={qrDataUrl} alt="网易云登录二维码" style={{ width: 220, height: 220 }} />
              </div>
            )}
            <div style={{ fontSize: 13, color: qrStatus.includes("过期") ? "#ff6b6b" : "#aaa7b8" }}>{qrStatus}</div>
            <div style={{ marginTop: 12 }}>
              <button className="btn-scan" style={{ background: "#333" }} onClick={startQrLogin}>刷新二维码</button>
              <button className="btn-scan" style={{ background: "#333", marginLeft: 8 }} onClick={() => { window.clearInterval(pollRef.current); setLoginMode(null); }}>返回</button>
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
            <textarea className="library__search-input" style={{ height: 70, paddingTop: 10, resize: "none", fontFamily: "monospace" }}
              placeholder="MUSIC_U=xxx" value={cookieInput} onChange={(e) => setCookieInput(e.target.value)} />
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
      {/* 导航栏 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button className={`nav-pill ${view === "playlists" ? "nav-pill--active" : ""}`} onClick={loadPlaylists}>🎵 我的歌单</button>
        <button className="nav-pill nav-pill--green" onClick={loadDaily}>📅 每日推荐</button>
        <button className={`nav-pill ${view === "search" ? "nav-pill--active" : ""}`} onClick={() => setView("search")}>🔍 搜索</button>
        <div style={{ flex: 1 }} />
        <button className="nav-pill nav-pill--ghost" onClick={async () => { await invoke("netease_logout"); setLoggedIn(false); }}>退出</button>
      </div>

      {/* 搜索框 */}
      {view === "search" && (
        <div className="library__toolbar" style={{ marginBottom: 16 }}>
          <div className="library__search">
            <svg className="library__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input className="library__search-input" placeholder="搜索网易云歌曲…" value={keyword}
              onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
          </div>
        </div>
      )}

      {error && <div style={{ padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, marginBottom: 16 }}>⚠️ {error}</div>}

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

      {/* 歌曲列表（搜索/每日推荐/歌单详情共用） */}
      {(view === "search" || view === "playlist") && tracks.length > 0 && (
        <>
          {view === "playlist" && (
            <div className="section-title">
              <h3>{currentPlaylist}</h3>
              <span className="section-title__sub">{tracks.length} 首</span>
              <button className="nav-pill nav-pill--active" style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 12 }}
                onClick={() => handlePlay(tracks[0], 0)}>▶ 播放全部</button>
            </div>
          )}
          <div className="library__list">
            <div className="lib-header"><span className="col-i">#</span><span className="col-title">标题</span>
              <span className="col-artist">艺术家</span><span className="col-album">{view === "playlist" ? "专辑" : "专辑"}</span><span className="col-dur">操作</span></div>
            <div className="lib-rows">
              {tracks.map((t, i) => {
                const active = currentIndex === i;
                const d = t.meta.duration_secs;
                return (
                  <div key={t.id} className={`lib-row ${active ? "lib-row--active" : ""}`} onDoubleClick={() => handlePlay(t, i)}>
                    <span className="col-i">{active && isPlaying ? <span className="eq-bars"><i></i><i></i><i></i></span> : <><span className="idx">{i + 1}</span><svg className="play-hover" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></>}</span>
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
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {loading && tracks.length === 0 && view !== "playlists" && (
        <div className="library__empty"><div className="library__empty-title">加载中…</div></div>
      )}
    </div>
  );
}
