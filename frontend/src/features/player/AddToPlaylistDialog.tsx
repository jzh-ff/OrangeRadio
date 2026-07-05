import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../../stores/libraryStore";

interface UserPlaylist {
  id: string;
  name: string;
  created_at: string;
  track_count: number;
}

/**
 * "添加到歌单" 弹窗
 *
 * 关键：用 React Portal 渲染到 document.body，
 * 避免 .lib-row:hover 的 transform 导致 position:fixed 失效（CSS 经典陷阱）。
 */
export function AddToPlaylistDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => {
    invoke<UserPlaylist[]>("all_playlists").then(setPlaylists).catch(() => {});
  };

  useEffect(() => {
    load();
    // ESC 关闭
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const doAdd = async (playlistId: string) => {
    setLoading(true);
    setMsg("");
    try {
      await invoke("add_to_playlist", { playlistId, track });
      setMsg("✓ 已添加");
      setTimeout(onClose, 600);
    } catch (e: any) {
      setMsg(e?.message || "添加失败");
    } finally {
      setLoading(false);
    }
  };

  const doCreate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const id = await invoke<string>("create_playlist", { name: newName.trim() });
      await invoke("add_to_playlist", { playlistId: id, track });
      setMsg("✓ 已创建并添加");
      setTimeout(onClose, 600);
    } catch (e: any) {
      setMsg(e?.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="atp-overlay" onClick={onClose}>
      <div className="atp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="atp-head">
          <span className="atp-title">添加到歌单</span>
          <button className="atp-close" onClick={onClose}>✕</button>
        </div>
        <div className="atp-track-info">
          <span className="atp-track-name">{track.meta.title}</span>
          <span className="atp-track-artist">{track.meta.artist}</span>
        </div>
        <div className="atp-list">
          {playlists.length === 0 && !newName && (
            <div className="atp-empty">还没有歌单，在下方创建一个吧</div>
          )}
          {playlists.map((p) => (
            <button
              key={p.id}
              className="atp-item"
              onClick={() => doAdd(p.id)}
              disabled={loading}
            >
              <span className="atp-item-name">🎵 {p.name}</span>
              <span className="atp-item-count">{p.track_count} 首</span>
            </button>
          ))}
        </div>
        <div className="atp-create">
          <input
            className="atp-input"
            placeholder="新建歌单名称…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doCreate()}
          />
          <button className="atp-create-btn" onClick={doCreate} disabled={loading || !newName.trim()}>
            新建并添加
          </button>
        </div>
        {msg && <div className="atp-msg">{msg}</div>}
      </div>
    </div>,
    document.body
  );
}
