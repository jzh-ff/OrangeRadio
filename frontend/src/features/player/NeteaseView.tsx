import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

type View = "search" | "playlists" | "playlist";

/** 网易云音乐视图 */
export function NeteaseView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  // 导航
  const [view, setView] = useState<View>("search");
  // 数据
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<{ id: string; name: string; count: number }[]>([]);
  const [currentPlaylist, setCurrentPlaylist] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => { invoke<boolean>("netease_status").then(setLoggedIn).catch(() => {}); }, []);

  const doLogin = async () => {
    if (!cookieInput.trim()) return;
    setLoading(true); setError("");
    try {
      await invoke("netease_login", { cookie: cookieInput });
      setLoggedIn(true); setCookieInput("");
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
    setLoading(true); setError(""); setView("playlists");
    try {
      const list = await invoke<{ id: string; name: string; count: number }[]>("netease_playlists");
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
        <div className="library__empty-desc" style={{ marginBottom: 16 }}>用浏览器登录后导入 Cookie</div>
        <button className="btn-scan" style={{ background: "#1DB954", marginBottom: 12 }} onClick={() => open("https://music.163.com/#/login")}>🔗 打开网易云网页登录</button>
        <input className="library__search-input" style={{ maxWidth: 500, fontFamily: "monospace" }}
          placeholder="MUSIC_U=你的cookie值" value={cookieInput} onChange={(e) => setCookieInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doLogin()} />
        <button className="btn-scan" style={{ marginTop: 8 }} onClick={doLogin} disabled={loading}>{loading ? "登录中…" : "确认登录"}</button>
        {error && <div style={{ marginTop: 16, padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, maxWidth: 500 }}>⚠️ {error}</div>}
      </div>
    );
  }

  // ===== 已登录 =====
  return (
    <div className="library">
      {/* 导航栏 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button className="q-badge" style={{ cursor: "pointer", padding: "6px 12px", border: "none", background: view === "search" ? "var(--orange)" : "#1e1e30", color: "white" }} onClick={() => setView("search")}>🔍 搜索</button>
        <button className="q-badge" style={{ cursor: "pointer", padding: "6px 12px", border: "none", background: "#1DB954", color: "white" }} onClick={loadDaily}>📅 每日推荐</button>
        <button className="q-badge" style={{ cursor: "pointer", padding: "6px 12px", border: "none", background: view === "playlists" ? "var(--orange)" : "#1e1e30", color: "white" }} onClick={loadPlaylists}>📋 我的歌单</button>
        <button className="q-badge" style={{ cursor: "pointer", padding: "6px 12px", border: "none", background: "#333" }} onClick={async () => { await invoke("netease_logout"); setLoggedIn(false); }}>退出</button>
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

      {/* 歌单列表 */}
      {view === "playlists" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {playlists.map((p) => (
            <div key={p.id} onClick={() => openPlaylist(p.id, p.name)} style={{ background: "#1a1a2a", borderRadius: 12, padding: 16, cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#252540"}
              onMouseLeave={(e) => e.currentTarget.style.background = "#1a1a2a"}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>📋 {p.name}</div>
              <div style={{ fontSize: 12, color: "#5a5a70" }}>{p.count} 首</div>
            </div>
          ))}
          {playlists.length === 0 && !loading && <div style={{ color: "#5a5a70", padding: 20 }}>点击「我的歌单」加载</div>}
        </div>
      )}

      {/* 歌曲列表（搜索/每日推荐/歌单详情共用） */}
      {(view === "search" || view === "playlist") && tracks.length > 0 && (
        <div className="library__list">
          <div className="lib-header"><span className="col-i">#</span><span className="col-title">标题</span>
            <span className="col-artist">艺术家</span><span className="col-album">{view === "playlist" ? currentPlaylist : "专辑"}</span><span className="col-dur">时长</span></div>
          <div className="lib-rows">
            {tracks.map((t, i) => {
              const active = currentIndex === i;
              const d = t.meta.duration_secs;
              return (
                <div key={t.id} className={`lib-row ${active ? "lib-row--active" : ""}`} onDoubleClick={() => handlePlay(t, i)}>
                  <span className="col-i">{active && isPlaying ? <span className="eq-bars"><i></i><i></i><i></i></span> : <><span className="idx">{i + 1}</span><svg className="play-hover" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></>}</span>
                  <span className="col-title" onClick={() => handlePlay(t, i)}><span className="col-title__txt">{t.meta.title}</span><span className="q-badge q-high">NE</span></span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
                  <span className="col-dur">{d ? `${Math.floor(d/60)}:${Math.floor(d%60).toString().padStart(2,"0")}` : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading && tracks.length === 0 && view !== "playlists" && (
        <div className="library__empty"><div className="library__empty-title">加载中…</div></div>
      )}
    </div>
  );
}
