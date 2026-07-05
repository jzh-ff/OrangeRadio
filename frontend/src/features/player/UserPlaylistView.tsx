import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import { getCoverUrl } from "./useCover";
import { TrackActions } from "./TrackActions";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

/**
 * 用户自建歌单视图
 *
 * 展示歌单内歌曲（支持跨源：网易云歌曲也能播放）。
 * 播放时 engineRef.playTrack 根据 source_kind 自动取流。
 */
export function UserPlaylistView() {
  const playlistId = usePlayerStore((s) => s.currentPlaylistId);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlistName, setPlaylistName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!playlistId) return;
    setLoading(true);
    invoke<Track[]>("playlist_tracks", { playlistId })
      .then((list) => {
        setTracks(list);
        setQueue(list);
        // 取歌单名（从 all_playlists 查）
        invoke<{ id: string; name: string }[]>("all_playlists").then((ps) => {
          const p = ps.find((x) => x.id === playlistId);
          if (p) setPlaylistName(p.name);
        }).catch(() => {});
      })
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, [playlistId]);

  const handlePlay = (track: Track, index: number) => {
    engineRef.playTrack(track, index);
  };

  if (!playlistId) {
    return (
      <div className="library__empty">
        <div className="library__empty-icon">🎵</div>
        <div className="library__empty-title">选择一个歌单</div>
        <div className="library__empty-desc">在左侧栏点击你的歌单，或新建一个</div>
      </div>
    );
  }

  if (loading) {
    return <div className="library__empty"><div className="library__empty-title">加载中…</div></div>;
  }

  return (
    <div className="library">
      <div className="section-title">
        <h3>{playlistName || "歌单"}</h3>
        <span className="section-title__sub">{tracks.length} 首</span>
        {tracks.length > 0 && (
          <button
            className="nav-pill nav-pill--active"
            style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 12 }}
            onClick={() => handlePlay(tracks[0], 0)}
          >▶ 播放全部</button>
        )}
      </div>

      {tracks.length === 0 ? (
        <div className="library__empty">
          <div className="library__empty-icon">🎵</div>
          <div className="library__empty-title">歌单是空的</div>
          <div className="library__empty-desc">去网易云或本地库，点击歌曲旁的 + 加入歌单</div>
        </div>
      ) : (
        <div className="library__list">
          <div className="lib-header">
            <span className="col-i">#</span>
            <span className="col-title">标题</span>
            <span className="col-artist">艺术家</span>
            <span className="col-album">来源</span>
            <span className="col-dur">操作</span>
          </div>
          <div className="lib-rows">
            {tracks.map((t, i) => {
              const active = currentIndex === i;
              const d = t.meta.duration_secs;
              const sourceLabel = t.source_kind === "netease_cloud_music" ? "网易云"
                : t.source_kind === "qq_music" ? "QQ" : "本地";
              const cover = getCoverUrl(t);
              return (
                <div key={t.id} className={`lib-row ${active ? "lib-row--active" : ""}`} onDoubleClick={() => handlePlay(t, i)}>
                  <span className="col-i">
                    {active && isPlaying ? <span className="eq-bars"><i></i><i></i><i></i></span>
                    : <><span className="idx">{i + 1}</span>
                      <svg className="play-hover" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></>}
                  </span>
                  <span className="col-title" onClick={() => handlePlay(t, i)}>
                    {cover && <img src={cover} alt="" className="col-title__cover" loading="lazy" />}
                    <span className="col-title__txt">{t.meta.title}</span>
                  </span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album"><span className="q-badge q-high">{sourceLabel}</span></span>
                  <span className="col-dur">
                    <TrackActions track={t} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
