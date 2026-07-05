import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../stores/playerStore";
import { useSearchStore } from "../stores/searchStore";
import { getCoverUrl, DEFAULT_COVER } from "../features/player/useCover";
import { engineRef } from "../App";
import { SpectrumPulse } from "./SpectrumPulse";
import "../styles/sidebar.css";

interface UserPlaylist {
  id: string;
  name: string;
  created_at: string;
  track_count: number;
}

type SubView =
  | "home" | "library" | "wallpaper" | "radio" | "netease"
  | "podcast" | "qqmusic" | "spotify" | "gequbao";

interface MenuItem {
  label: string;
  icon: string;
  sub?: SubView;
  status?: string;
  disabled?: boolean;
  /** 特殊动作（非页面跳转） */
  action?: "recommend" | "understand_you";
}

const PRIMARY: { key: "player" | "studio"; label: string; kicker: string }[] = [
  { key: "player", label: "播放器", kicker: "Listen" },
  { key: "studio", label: "创作工作室", kicker: "Create" },
];

const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: "发现",
    items: [
      { label: "首页", icon: "HM", sub: "home" },
      { label: "我的音乐库", icon: "LIB", sub: "library" },
      { label: "壁纸", icon: "WP", sub: "wallpaper" },
    ],
  },
  {
    title: "智能",
    items: [
      { label: "AI 推荐", icon: "AI", status: "新", sub: "home", action: "recommend" },
      { label: "懂你模式", icon: "YOU", status: "🧠", sub: "home", action: "understand_you" },
    ],
  },
  {
    title: "音源",
    items: [
      { label: "网络电台", icon: "RAD", sub: "radio" },
      { label: "网易云音乐", icon: "NE", sub: "netease", status: "Beta" },
      { label: "QQ 音乐", icon: "QQ", sub: "qqmusic", status: "Beta" },
      { label: "Spotify", icon: "SP", sub: "spotify", status: "30s" },
      { label: "歌曲宝", icon: "GQB", sub: "gequbao", status: "Beta" },
      { label: "播客", icon: "POD", sub: "podcast" },
    ],
  },
  {
    title: "即将推出",
    items: [
      { label: "一起听", icon: "SYNC", status: "v0.7", disabled: true },
    ],
  },
];

export function Sidebar() {
  const view = usePlayerStore((s) => s.view);
  const subView = usePlayerStore((s) => s.subView);
  const smartAction = usePlayerStore((s) => s.smartAction);
  const setView = usePlayerStore((s) => s.setView);
  const setSubView = usePlayerStore((s) => s.setSubView);
  const currentPlaylistId = usePlayerStore((s) => s.currentPlaylistId);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setFullPlayer = usePlayerStore((s) => s.setFullPlayer);
  const sidebarOpacity = usePlayerStore((s) => s.visualParams.sidebarOpacity);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const searchKeyword = useSearchStore((s) => s.keyword);
  const setKeyword = useSearchStore((s) => s.setKeyword);
  const doSearch = useSearchStore((s) => s.doSearch);

  const onSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchKeyword.trim()) {
      doSearch();
      setSubView("search");
    }
  };

  const loadPlaylists = () => {
    invoke<UserPlaylist[]>("all_playlists").then(setPlaylists).catch(() => {});
  };

  useEffect(() => {
    loadPlaylists();
    const t = setInterval(loadPlaylists, 5000);
    return () => clearInterval(t);
  }, []);

  const onItemAction = (item: MenuItem) => {
    if (item.disabled) return;
    if (item.action === "understand_you") {
      // 懂你模式：切播放模式 + 跳首页（下一首自动走 AI 推荐选歌）
      usePlayerStore.getState().setSmartAction("understand_you");
      usePlayerStore.getState().setMode("understand_you");
      setView("player");
      setSubView("home");
      return;
    }
    if (item.action === "recommend") {
      // AI 推荐：拉一批推荐队列并立即播放
      usePlayerStore.getState().setSmartAction("recommend");
      setView("player");
      setSubView("home");
      invoke<unknown[]>("recommend_next", { limit: 10 })
        .then((list) => {
          const tracks = list as import("../stores/libraryStore").Track[];
          if (tracks.length) {
            usePlayerStore.getState().setQueue(tracks);
            void engineRef.playTrack(tracks[0], 0);
          }
        })
        .catch(() => {});
      return;
    }
    // 普通菜单项：清除智能动作激活态,再跳子页面
    usePlayerStore.getState().setSmartAction(null);
    if (item.sub) {
      setSubView(item.sub);
    }
  };

  const openPlaylist = (id: string) => {
    usePlayerStore.setState({ currentPlaylistId: id });
    setSubView("user_playlist");
  };

  const createPlaylist = async () => {
    const name = window.prompt("歌单名称");
    if (!name?.trim()) return;
    try {
      await invoke("create_playlist", { name: name.trim() });
      loadPlaylists();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(msg || "创建失败");
    }
  };

  const cover = getCoverUrl(currentTrack);

  return (
    <aside
      className={`sidebar ${isPlaying ? "sidebar--live" : ""}`}
      style={{ "--ui-opacity": sidebarOpacity } as React.CSSProperties}
    >
      <SpectrumPulse />

      <div className="sb-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="sb-search__icon" aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          className="sb-search__input"
          placeholder="搜索音乐、电台、播客…"
          value={searchKeyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={onSearch}
          onFocus={() => setSubView("search")}
        />
      </div>

      <div className="sidebar__live">
        <span className={`sidebar__live-dot ${isPlaying ? "is-on" : ""}`} />
        <span className="sidebar__live-label">{isPlaying ? "ON AIR" : "STANDBY"}</span>
        <span className="sidebar__live-freq">92.6</span>
      </div>

      <nav className="sidebar__primary" aria-label="主模块">
        {PRIMARY.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`sb-primary ${view === item.key ? "sb-primary--active" : ""}`}
            onClick={() => setView(item.key)}
          >
            <span className="sb-primary__label">{item.label}</span>
            <span className="sb-primary__kicker">{item.kicker}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar__scroll">
        {SECTIONS.map((section) => (
          <div key={section.title} className="sidebar__section">
            <div className="sidebar__section-title">{section.title}</div>
            {section.items.map((item) => {
              // 智能动作项用 smartAction 判活,避免与"首页"等共享 subView 的项联动
              const active = !!item.action
                ? smartAction === item.action
                : !!item.sub && view === "player" && subView === item.sub;
              return (
                <button
                  key={item.label}
                  type="button"
                  className={`sb-item ${active ? "sb-item--active" : ""} ${item.disabled ? "sb-item--disabled" : ""}`}
                  disabled={item.disabled}
                  onClick={() => onItemAction(item)}
                >
                  <span className="sb-item__icon">{item.icon}</span>
                  <span className="sb-item__label">{item.label}</span>
                  {item.status && <span className="sb-item__badge">{item.status}</span>}
                </button>
              );
            })}
          </div>
        ))}

        <div className="sidebar__section">
          <div className="sidebar__section-head">
            <span className="sidebar__section-title">我的歌单</span>
            <button type="button" className="sidebar__section-add" onClick={createPlaylist} title="新建歌单">+</button>
          </div>
          {playlists.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`sb-playlist ${currentPlaylistId === p.id && subView === "user_playlist" ? "sb-playlist--active" : ""}`}
              onClick={() => openPlaylist(p.id)}
            >
              <span className="sb-playlist__dot" />
              <span className="sb-playlist__name">{p.name}</span>
              <span className="sb-playlist__count">{p.track_count}</span>
            </button>
          ))}
        </div>
      </div>

      {currentTrack && (
        <button
          type="button"
          className="sidebar__now"
          onClick={() => setFullPlayer(true)}
          title="打开播放详情"
        >
          <div className="sidebar__now-cover">
            {cover ? <img src={cover} alt="" /> : <img src={DEFAULT_COVER} alt="" />}
          </div>
          <div className="sidebar__now-copy">
            <span className="sidebar__now-title">{currentTrack.meta.title}</span>
            <span className="sidebar__now-artist">{currentTrack.meta.artist}</span>
          </div>
          <span className={`sidebar__now-wave ${isPlaying ? "is-live" : ""}`} aria-hidden />
        </button>
      )}

      <div className="sidebar__foot">
        <button
          type="button"
          className="sb-item sb-item--settings"
          onClick={() => usePlayerStore.getState().setSettingsOpen(true)}
        >
          <span className="sb-item__icon">SET</span>
          <span className="sb-item__label">设置</span>
        </button>
        <div className="sidebar__version">v0.4 · 沉浸视觉</div>
      </div>
    </aside>
  );
}
