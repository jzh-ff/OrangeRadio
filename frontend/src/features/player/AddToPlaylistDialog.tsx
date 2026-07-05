import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../../stores/libraryStore";

/**
 * "添加到歌单" 弹窗（v0.4 分区版，对标 PlayerBar 入口 + TrackActions 复用）
 *
 * 三个分区：
 * - **本地** —— 列出 `all_playlists`，支持「创建并添加」，调用 `add_to_playlist`
 * - **网易云** —— 列出 `netease_playlists`：
 *   - 第一项（约定是「我喜欢的音乐」）走现成 `netease_like_track`
 *   - 之后是用户自建/收藏的远端歌单，走新加的 `netease_add_track_to_playlist`
 *   - 未登录网易云 → 显示提示卡，不报错打断
 * - **QQ** —— 列出 `qqmusic_playlists`，全部 disabled + tooltip「QQ 远端添加开发中」
 *
 * 默认 tab：根据当前曲目 source_kind 自动跳到匹配的源（nq → 网易云，否则本地）。
 *
 * 用 React Portal 渲染到 document.body，
 * 避免 .lib-row:hover 的 transform 导致 position:fixed 失效（CSS 经典陷阱）。
 */

type Tab = "local" | "netease" | "qq";

interface LocalPlaylist {
  id: string;
  name: string;
  created_at: string;
  track_count: number;
}
interface RemotePlaylist {
  id: string;
  name: string;
  count: number;
  cover?: string;
}

interface Props {
  track: Track;
  onClose: () => void;
}

export function AddToPlaylistDialog({ track, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(() =>
    track.source_kind === "netease_cloud_music" ? "netease" : "local"
  );
  const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>([]);
  const [neteasePlaylists, setNeteasePlaylists] = useState<RemotePlaylist[] | null>(null);
  const [neteaseErr, setNeteaseErr] = useState<string | null>(null);
  const [qqPlaylists, setQqPlaylists] = useState<RemotePlaylist[] | null>(null);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // 加载本地 / 网易云 / QQ 三个数据
  useEffect(() => {
    invoke<LocalPlaylist[]>("all_playlists").then(setLocalPlaylists).catch(() => {});

    invoke<RemotePlaylist[]>("netease_playlists")
      .then((p) => {
        setNeteasePlaylists(p);
        setNeteaseErr(null);
      })
      .catch((e) => {
        setNeteasePlaylists([]);
        setNeteaseErr(e?.message || "未登录网易云或网络异常");
      });

    invoke<RemotePlaylist[]>("qqmusic_playlists")
      .then(setQqPlaylists)
      .catch(() => setQqPlaylists([]));

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ----- 三个分支的执行 -----
  const doAddLocal = async (playlistId: string) => {
    setLoading(true);
    setMsg("");
    try {
      await invoke("add_to_playlist", { playlistId, track });
      setMsg("✓ 已添加到本地歌单");
      setTimeout(onClose, 700);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMsg(err?.message || "添加失败");
    } finally {
      setLoading(false);
    }
  };

  const doCreateLocal = async () => {
    const name = newName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const id = await invoke<string>("create_playlist", { name });
      await invoke("add_to_playlist", { playlistId: id, track });
      setMsg("✓ 已创建并添加");
      setTimeout(onClose, 700);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMsg(err?.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  /** 网易云「我喜欢的音乐」—— 走现成 netease_like_track */
  const doAddNeteaseFav = async () => {
    if (!track.source_track_id) return;
    setLoading(true);
    setMsg("");
    try {
      await invoke("netease_like_track", { songId: track.source_track_id });
      setMsg("✓ 已添加到「我喜欢的音乐」");
      setTimeout(onClose, 700);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMsg(err?.message || "添加失败（请确认已登录网易云）");
    } finally {
      setLoading(false);
    }
  };

  /** 网易云其他自建/收藏歌单 —— 新加的 netease_add_track_to_playlist */
  const doAddNetease = async (playlistId: string) => {
    if (!track.source_track_id) {
      setMsg("这首不是网易云曲目，无法直接加入网易云远端歌单");
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      const pid = parseInt(playlistId, 10);
      await invoke("netease_add_track_to_playlist", {
        playlistId: pid,
        songId: track.source_track_id,
      });
      setMsg("✓ 已添加到网易云歌单");
      setTimeout(onClose, 700);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMsg(err?.message || "添加失败");
    } finally {
      setLoading(false);
    }
  };

  // ----- 计算每个 tab 是否禁用（无登录态） -----
  const neteaseOff = neteasePlaylists === null || (neteasePlaylists.length === 0 && !!neteaseErr);
  const qqOff = qqPlaylists === null || qqPlaylists.length === 0;

  const sourceKindLabel =
    track.source_kind === "netease_cloud_music"
      ? "网易云音源"
      : track.source_kind === "qq_music"
        ? "QQ 音乐音源"
        : track.source_kind === "local"
          ? "本地音源"
          : "其他音源";

  const renderLocalSection = () => (
    <>
      <div className="atp-section">
        <div className="atp-section__title">本地歌单</div>
        <div className="atp-list">
          {localPlaylists.length === 0 && !newName && (
            <div className="atp-empty">还没有歌单，在下方创建一个吧</div>
          )}
          {localPlaylists.map((p) => (
            <button
              key={p.id}
              className="atp-item"
              onClick={() => doAddLocal(p.id)}
              disabled={loading}
            >
              <span className="atp-item-name">🎵 {p.name}</span>
              <span className="atp-item-count">{p.track_count} 首</span>
            </button>
          ))}
        </div>
      </div>
      <div className="atp-create">
        <input
          className="atp-input"
          placeholder="新建歌单名称…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doCreateLocal()}
        />
        <button
          className="atp-create-btn"
          onClick={doCreateLocal}
          disabled={loading || !newName.trim()}
        >
          新建并添加
        </button>
      </div>
    </>
  );

  const renderNeteaseSection = () => {
    if (neteasePlaylists === null) {
      return <div className="atp-empty">加载网易云歌单…</div>;
    }
    if (neteaseOff) {
      return (
        <div className="atp-notice">
          <div className="atp-notice__title">未登录网易云</div>
          <div className="atp-notice__hint">在设置里扫码登录后才能添加。</div>
          {neteaseErr && <div className="atp-notice__err">{neteaseErr}</div>}
        </div>
      );
    }
    if (neteasePlaylists.length === 0) {
      return <div className="atp-empty">网易云账号下没有歌单</div>;
    }
    return (
      <div className="atp-list">
        {neteasePlaylists.map((p, i) => {
          const isFav = i === 0; // 网易云约定第一个歌单是「我喜欢的音乐」
          if (isFav) {
            return (
              <button
                key={p.id}
                className="atp-item atp-item--fav"
                onClick={doAddNeteaseFav}
                disabled={loading || !track.source_track_id}
                title="网易云「我喜欢的音乐」收藏"
              >
                <span className="atp-item-name">♥ {p.name}</span>
                <span className="atp-item-count">{p.count} 首</span>
              </button>
            );
          }
          return (
            <button
              key={p.id}
              className="atp-item"
              onClick={() => doAddNetease(p.id)}
              disabled={loading || !track.source_track_id}
              title={
                !track.source_track_id ? "需要网易云音源才能添加" : "添加到此歌单"
              }
            >
              <span className="atp-item-name">🎵 {p.name}</span>
              <span className="atp-item-count">{p.count} 首</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderQqSection = () => {
    if (qqPlaylists === null) {
      return <div className="atp-empty">加载 QQ 歌单…</div>;
    }
    if (qqOff) {
      return (
        <div className="atp-notice">
          <div className="atp-notice__title">QQ 音乐</div>
          <div className="atp-notice__hint">
            扫码登录 QQ 后歌单会在此显示。远端「添加到歌单」功能开发中（v0.5+）。
          </div>
        </div>
      );
    }
    return (
      <>
        <div className="atp-list">
          {qqPlaylists.map((p) => (
            <button
              key={p.id}
              className="atp-item atp-item--disabled"
              disabled
              title="QQ 远端添加开发中，v0.5+"
            >
              <span className="atp-item-name">🔒 {p.name}</span>
              <span className="atp-item-count">{p.count} 首</span>
            </button>
          ))}
        </div>
        <div className="atp-notice atp-notice--foot">
          QQ 远端「添加到歌单」开发中，先用本地歌单做中转吧。
        </div>
      </>
    );
  };

  return createPortal(
    <div className="atp-overlay" onClick={onClose}>
      <div className="atp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="atp-head">
          <span className="atp-title">添加到歌单</span>
          <button className="atp-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="atp-track-info">
          <span className="atp-track-name">{track.meta.title}</span>
          <span className="atp-track-artist">{track.meta.artist}</span>
          <span className="atp-track-source">{sourceKindLabel}</span>
        </div>

        <div className="atp-tabs" role="tablist">
          <button
            type="button"
            className={`atp-tab ${tab === "local" ? "atp-tab--active" : ""}`}
            onClick={() => setTab("local")}
            role="tab"
            aria-selected={tab === "local"}
          >
            本地
          </button>
          <button
            type="button"
            className={`atp-tab ${tab === "netease" ? "atp-tab--active" : ""}`}
            onClick={() => setTab("netease")}
            role="tab"
            aria-selected={tab === "netease"}
          >
            网易云
            {neteaseOff && <span className="atp-tab__dot" title="未登录" />}
          </button>
          <button
            type="button"
            className={`atp-tab ${tab === "qq" ? "atp-tab--active" : ""}`}
            onClick={() => setTab("qq")}
            role="tab"
            aria-selected={tab === "qq"}
          >
            QQ
            {qqOff && <span className="atp-tab__dot" title="未登录" />}
          </button>
        </div>

        <div className="atp-pane">
          {tab === "local" && renderLocalSection()}
          {tab === "netease" && renderNeteaseSection()}
          {tab === "qq" && renderQqSection()}
        </div>

        {msg && <div className="atp-msg">{msg}</div>}
      </div>
    </div>,
    document.body
  );
}
