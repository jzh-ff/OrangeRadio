import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

/** 网络电台视图（RadioBrowser） */
export function RadioView() {
  const [stations, setStations] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => {
    loadPopular();
  }, []);

  const loadPopular = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await invoke<Track[]>("radio_popular", { limit: 30 });
      setStations(list);
      setQueue(list);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const doSearch = async () => {
    if (!keyword.trim()) {
      loadPopular();
      return;
    }
    setLoading(true);
    setError("");
    try {
      const list = await invoke<Track[]>("radio_search", { keyword });
      setStations(list);
      setQueue(list);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  return (
    <div className="library">
      <div className="library__toolbar">
        <div className="library__search">
          <svg className="library__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="library__search-input"
            placeholder="搜索全球电台（Jazz / Rock / 中国…）"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
        </div>
        <button className="btn-scan" onClick={loadPopular} disabled={loading}>
          📻 {loading ? "加载中…" : "热门电台"}
        </button>
      </div>

      {error && (
        <div style={{ padding: 16, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 10, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {stations.length === 0 && !loading ? (
        <div className="library__empty">
          <div className="library__empty-icon">📻</div>
          <div className="library__empty-title">{error ? "加载失败" : "正在加载电台…"}</div>
          <div className="library__empty-desc">RadioBrowser · 全球 4 万+ 网络电台</div>
        </div>
      ) : (
        <div className="library__list">
          <div className="lib-header">
            <span className="col-i">#</span>
            <span className="col-title">电台</span>
            <span className="col-artist">地区</span>
            <span className="col-album">类型</span>
            <span className="col-dur">码率</span>
          </div>
          <div className="lib-rows">
            {stations.map((t, i) => {
              const active = currentIndex === i;
              return (
                <div
                  key={t.id}
                  className={`lib-row ${active ? "lib-row--active" : ""}`}
                  onDoubleClick={() => handlePlay(t, i)}
                >
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
                    <span className="q-badge q-std">LIVE</span>
                  </span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
                  <span className="col-dur">{t.quality === "high" ? "HQ" : "STD"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
