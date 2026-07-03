import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

const SUGGESTED = [
  { name: "声东击西", url: "https://feeds.buzzsprout.com/1000000.rss" },
  { name: "忽左忽右", url: "https://feeds.justpod.com/r/hzyy.xml" },
];

/** 播客 RSS 视图 */
export function PodcastView() {
  const [url, setUrl] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const fetchFeed = async (rssUrl?: string) => {
    const u = (rssUrl || url).trim();
    if (!u) return;
    setLoading(true);
    setError("");
    try {
      const list = await invoke<Track[]>("podcast_fetch", { rssUrl: u });
      setTracks(list);
      setQueue(list);
      if (!rssUrl) setUrl(u);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  const fmt = (s?: number) => {
    if (!s) return "—";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="library">
      <div className="library__toolbar">
        <div className="library__search">
          <svg className="library__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="5" cy="19" r="2" stroke="currentColor" strokeWidth="2"/>
          </svg>
          <input
            className="library__search-input"
            placeholder="粘贴播客 RSS 订阅地址（https://...）"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchFeed()}
          />
        </div>
        <button className="btn-scan" onClick={() => fetchFeed()} disabled={loading}>
          🎙️ {loading ? "加载中…" : "订阅"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#5a5a70", alignSelf: "center" }}>推荐：</span>
        {SUGGESTED.map((s) => (
          <button key={s.name} className="q-badge q-std" style={{ cursor: "pointer", border: "none" }} onClick={() => fetchFeed(s.url)}>
            {s.name}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {tracks.length === 0 ? (
        <div className="library__empty">
          <div className="library__empty-icon">🎙️</div>
          <div className="library__empty-title">订阅播客</div>
          <div className="library__empty-desc">粘贴 RSS 地址，或点上方推荐播客</div>
        </div>
      ) : (
        <div className="library__list">
          <div className="lib-header">
            <span className="col-i">#</span>
            <span className="col-title">单集</span>
            <span className="col-artist">主播</span>
            <span className="col-album">节目</span>
            <span className="col-dur">时长</span>
          </div>
          <div className="lib-rows">
            {tracks.map((t, i) => {
              const active = currentIndex === i;
              return (
                <div key={t.id} className={`lib-row ${active ? "lib-row--active" : ""}`} onDoubleClick={() => handlePlay(t, i)}>
                  <span className="col-i">
                    {active && isPlaying ? (
                      <span className="eq-bars"><i></i><i></i><i></i></span>
                    ) : (
                      <>
                        <span className="idx">{i + 1}</span>
                        <svg className="play-hover" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      </>
                    )}
                  </span>
                  <span className="col-title" onClick={() => handlePlay(t, i)}>
                    <span className="col-title__txt">{t.meta.title}</span>
                    <span className="q-badge q-std">POD</span>
                  </span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
                  <span className="col-dur">{fmt(t.meta.duration_secs)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
