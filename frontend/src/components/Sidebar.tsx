import { usePlayerStore } from "../stores/playerStore";
import "../styles/sidebar.css";

const NAV: { key: "player" | "studio"; label: string; icon: string; kicker: string }[] = [
  { key: "player", label: "播放器", icon: "FM", kicker: "Local signal" },
  { key: "studio", label: "创作工作室", icon: "OS", kicker: "AI console" },
];

const MENU: { label: string; icon: string; status: string; sub?: "library" | "radio" | "netease" | "podcast" | "qqmusic" | "spotify" }[] = [
  { label: "我的音乐库", icon: "LIB", status: "", sub: "library" },
  { label: "网络电台", icon: "RAD", status: "", sub: "radio" },
  { label: "网易云音乐", icon: "NE", status: "实验", sub: "netease" },
  { label: "QQ音乐", icon: "QQ", status: "实验", sub: "qqmusic" },
  { label: "Spotify", icon: "SP", status: "30s", sub: "spotify" },
  { label: "播客", icon: "POD", status: "", sub: "podcast" },
  { label: "AI 推荐", icon: "AI", status: "v0.5" },
  { label: "懂你模式", icon: "YOU", status: "v0.5" },
  { label: "一起听", icon: "SYNC", status: "v0.7" },
  { label: "创意市场", icon: "MKT", status: "v0.7" },
  { label: "设置", icon: "SET", status: "" },
];

export function Sidebar() {
  const view = usePlayerStore((s) => s.view);
  const subView = usePlayerStore((s) => s.subView);
  const setView = usePlayerStore((s) => s.setView);
  const setSubView = usePlayerStore((s) => s.setSubView);

  return (
    <aside className="sidebar">
      <div className="sidebar__logo">
        <span className="sidebar__logo-icon">OR</span>
        <span>
          <span className="sidebar__logo-text">OrangeRadio</span>
          <span className="sidebar__logo-sub">private wave console</span>
        </span>
      </div>

      <div className="sidebar__onair">
        <span className="sidebar__onair-dot" />
        <span>ON AIR</span>
        <strong>92.6</strong>
      </div>

      <nav className="sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${view === item.key ? "nav-item--active" : ""}`}
            onClick={() => setView(item.key)}
          >
            <span className="nav-item__icon">{item.icon}</span>
            <span className="nav-item__copy">
              <span className="nav-item__label">{item.label}</span>
              <span className="nav-item__kicker">{item.kicker}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="sidebar__menu">
        {MENU.map((item) => {
          const active = item.sub && view === "player" && subView === item.sub;
          return (
            <button
              key={item.label}
              className={`menu-item ${active ? "menu-item--active" : ""}`}
              onClick={() => item.sub && setSubView(item.sub)}
            >
              <span className="menu-item__icon">{item.icon}</span>
              <span className="menu-item__label">{item.label}</span>
              {item.status && <span className="menu-item__status">{item.status}</span>}
            </button>
          );
        })}
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__meter">
          <span style={{ height: "34%" }} />
          <span style={{ height: "62%" }} />
          <span style={{ height: "44%" }} />
          <span style={{ height: "78%" }} />
          <span style={{ height: "52%" }} />
        </div>
        <div className="sidebar__version">v0.3.0 · 音源生态</div>
      </div>
    </aside>
  );
}
