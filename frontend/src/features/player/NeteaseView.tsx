import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-shell";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

/** 网易云音乐视图（Cookie 登录） */
export function NeteaseView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
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
    setLoading(true); setError("");
    try {
      const list = await invoke<Track[]>("netease_search", { keyword });
      if (list.length === 0) {
        setError("搜索无结果（网易云接口可能受限，请尝试 Cookie 登录后重试）");
      }
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const handlePlay = async (track: Track, index: number) => {
    try {
      const url = await invoke<string>("netease_stream", { trackId: track.source_track_id });
      usePlayerStore.getState().setCurrent(track, index);
      engineRef.playPath(url);
    } catch (e: any) { setError(e?.message || "获取播放地址失败"); }
  };

  if (!loggedIn) {
    return (
      <div className="library__empty">
        <div className="library__empty-icon">🎵</div>
        <div className="library__empty-title">登录网易云音乐</div>
        <div className="library__empty-desc" style={{ marginBottom: 16 }}>
          用浏览器登录后导入 Cookie（扫码登录被网易云风控拦截）
        </div>
        <div style={{ maxWidth: 500, width: "100%", textAlign: "left", background: "rgba(255,107,26,0.06)", border: "1px solid rgba(255,107,26,0.2)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#ff9248", marginBottom: 8 }}>操作步骤：</div>
          <ol style={{ fontSize: 12, color: "#9a9ab0", lineHeight: 1.8, paddingLeft: 16 }}>
            <li>点击下方按钮打开网易云网页并登录</li>
            <li>登录后按 F12 → Application → Cookies → music.163.com</li>
            <li>复制 <code style={{ color: "#ff9248" }}>MUSIC_U</code> 的值</li>
            <li>粘贴到输入框，格式：<code>MUSIC_U=你的值</code></li>
          </ol>
        </div>
        <button className="btn-scan" style={{ background: "#1DB954", marginBottom: 12 }} onClick={() => openUrl("https://music.163.com/#/login")}>
          🔗 打开网易云网页登录
        </button>
        <input className="library__search-input" style={{ maxWidth: 500, fontFamily: "monospace" }}
          placeholder="MUSIC_U=你的cookie值" value={cookieInput} onChange={(e) => setCookieInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doLogin()} />
        <button className="btn-scan" style={{ marginTop: 8 }} onClick={doLogin} disabled={loading}>
          {loading ? "登录中…" : "确认登录"}
        </button>
        {error && (
          <div style={{ marginTop: 16, padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, maxWidth: 500, textAlign: "left" }}>
            ⚠️ {error}
          </div>
        )}
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
          <input className="library__search-input" placeholder="搜索网易云歌曲…" value={keyword}
            onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
        </div>
        <button className="btn-scan" style={{ background: "#333" }} onClick={async () => { await invoke("netease_logout"); setLoggedIn(false); setTracks([]); }}>退出</button>
      </div>
      {error && <div style={{ padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, marginBottom: 16 }}>⚠️ {error}</div>}
      {tracks.length === 0 ? (
        <div className="library__empty"><div className="library__empty-icon">🎵</div>
          <div className="library__empty-title">搜索网易云音乐</div>
          <div className="library__empty-desc">依赖网易云接口，可能受限</div></div>
      ) : (
        <div className="library__list">
          <div className="lib-header"><span className="col-i">#</span><span className="col-title">标题</span>
            <span className="col-artist">艺术家</span><span className="col-album">专辑</span><span className="col-dur">时长</span></div>
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
    </div>
  );
}
