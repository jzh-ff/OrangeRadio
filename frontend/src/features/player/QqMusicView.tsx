import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

/** QQ 音乐视图 */
export function QqMusicView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => {
    invoke<boolean>("qqmusic_status").then(setLoggedIn).catch(() => {});
    engineRef.resolver = async (trackId: string) => {
      return invoke<string>("qqmusic_stream", { trackId });
    };
    return () => { engineRef.resolver = null; };
  }, []);

  const doLogin = async () => {
    if (!cookieInput.trim()) return;
    setLoading(true); setError("");
    try {
      await invoke("qqmusic_login", { cookie: cookieInput });
      setLoggedIn(true); setShowLogin(false); setCookieInput("");
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    try {
      const list = await invoke<Track[]>("qqmusic_search", { keyword });
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const handlePlay = async (track: Track, index: number) => {
    try {
      const url = await invoke<string>("qqmusic_stream", { trackId: track.source_track_id });
      usePlayerStore.getState().setCurrent(track, index);
      engineRef.playPath(url);
    } catch (e: any) { setError(e?.message || "获取播放地址失败"); }
  };

  if (!loggedIn) {
    return (
      <div className="library__empty">
        <div className="library__empty-icon">🎵</div>
        <div className="library__empty-title">QQ音乐未登录</div>
        <div className="library__empty-desc" style={{ marginBottom: 20 }}>绑定你的 QQ 音乐账号</div>
        {!showLogin ? (
          <button className="btn-scan" onClick={() => setShowLogin(true)}>登录QQ音乐</button>
        ) : (
          <div style={{ maxWidth: 500, width: "100%", textAlign: "left" }}>
            <p style={{ fontSize: 12, color: "#9a9ab0", marginBottom: 8, lineHeight: 1.6 }}>
              1. 浏览器打开 y.qq.com 并登录<br/>
              2. F12 → Application → Cookies → 复制含 <code style={{ color: "#ff9248" }}>uin</code> 和 <code style={{ color: "#ff9248" }}>qqmusic_key</code> 的 Cookie<br/>
              3. 粘贴到下方
            </p>
            <textarea className="library__search-input" style={{ height: 70, paddingTop: 10, resize: "none", fontFamily: "monospace" }}
              placeholder="uin=xxx; qqmusic_key=xxx" value={cookieInput} onChange={(e) => setCookieInput(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-scan" onClick={doLogin} disabled={loading}>{loading ? "登录中…" : "确认登录"}</button>
              <button className="btn-scan" style={{ background: "#333" }} onClick={() => setShowLogin(false)}>取消</button>
            </div>
          </div>
        )}
        {error && <div style={{ marginTop: 16, padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, maxWidth: 500 }}>⚠️ {error}</div>}
      </div>
    );
  }

  return (
    <div className="library">
      <div className="library__toolbar">
        <div className="library__search">
          <svg className="library__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input className="library__search-input" placeholder="搜索QQ音乐…" value={keyword}
            onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
        </div>
      </div>
      {error && <div style={{ padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, marginBottom: 16 }}>⚠️ {error}</div>}
      {tracks.length === 0 ? (
        <div className="library__empty"><div className="library__empty-icon">🎵</div>
          <div className="library__empty-title">搜索QQ音乐</div>
          <div className="library__empty-desc">实验性 · 依赖QQ接口</div></div>
      ) : (
        <div className="library__list">
          <div className="lib-header"><span className="col-i">#</span><span className="col-title">标题</span>
            <span className="col-artist">歌手</span><span className="col-album">专辑</span><span className="col-dur">时长</span></div>
          <div className="lib-rows">
            {tracks.map((t, i) => {
              const active = currentIndex === i;
              const d = t.meta.duration_secs;
              return (
                <div key={t.id} className={`lib-row ${active ? "lib-row--active" : ""}`} onDoubleClick={() => handlePlay(t, i)}>
                  <span className="col-i">{active && isPlaying ? <span className="eq-bars"><i></i><i></i><i></i></span> : <><span className="idx">{i + 1}</span><svg className="play-hover" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></>}</span>
                  <span className="col-title" onClick={() => handlePlay(t, i)}><span className="col-title__txt">{t.meta.title}</span><span className="q-badge q-high">QQ</span></span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
                  <span className="col-dur">{d ? `${Math.floor(d/60)}:${Math.floor(d%60).toString().padStart(2,"0")}` : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
