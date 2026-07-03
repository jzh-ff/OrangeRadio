import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

/** Spotify 视图 */
export function SpotifyView() {
  const [configured, setConfigured] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => { invoke<boolean>("spotify_status").then(setConfigured).catch(() => {}); }, []);

  const doConfig = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setLoading(true); setError("");
    try {
      await invoke("spotify_configure", { clientId, clientSecret });
      setConfigured(true); setShowConfig(false);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    try {
      const list = await invoke<Track[]>("spotify_search", { keyword });
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  if (!configured) {
    return (
      <div className="library__empty">
        <div className="library__empty-icon">🎧</div>
        <div className="library__empty-title">Spotify 未配置</div>
        <div className="library__empty-desc" style={{ marginBottom: 20 }}>
          需要 Spotify Developer 的 Client ID 和 Secret<br/>
          <a href="https://developer.spotify.com/dashboard" target="_blank" style={{ color: "#1DB954" }}>前往 Spotify Developer 控制台 →</a>
        </div>
        {!showConfig ? (
          <button className="btn-scan" onClick={() => setShowConfig(true)}>配置 Spotify</button>
        ) : (
          <div style={{ maxWidth: 500, width: "100%", textAlign: "left" }}>
            <p style={{ fontSize: 12, color: "#9a9ab0", marginBottom: 8, lineHeight: 1.6 }}>
              1. 登录 developer.spotify.com/dashboard<br/>
              2. 创建 App，获取 Client ID 和 Secret<br/>
              3. 填入下方
            </p>
            <input className="library__search-input" style={{ marginBottom: 8 }} placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            <input className="library__search-input" placeholder="Client Secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-scan" onClick={doConfig} disabled={loading}>{loading ? "配置中…" : "确认"}</button>
              <button className="btn-scan" style={{ background: "#333" }} onClick={() => setShowConfig(false)}>取消</button>
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
          <input className="library__search-input" placeholder="搜索 Spotify（试听30秒）…" value={keyword}
            onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
        </div>
      </div>
      {error && <div style={{ padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, marginBottom: 16 }}>⚠️ {error}</div>}
      {tracks.length === 0 ? (
        <div className="library__empty"><div className="library__empty-icon">🎧</div>
          <div className="library__empty-title">搜索 Spotify</div>
          <div className="library__empty-desc">仅显示有试听片段的曲目（30秒）</div></div>
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
                  <span className="col-title" onClick={() => handlePlay(t, i)}><span className="col-title__txt">{t.meta.title}</span><span className="q-badge" style={{ background: "rgba(29,185,84,0.15)", color: "#1DB954" }}>SP</span></span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
                  <span className="col-dur">{d ? `${Math.floor(d/60)}:${Math.floor(d%60).toString().padStart(2,"0")}` : "30s"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
