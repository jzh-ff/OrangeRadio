import { usePlayerStore } from "../stores/playerStore";
import "../styles/sidebar.css";

const NAV: { key: "player" | "studio"; label: string; icon: string }[] = [
  { key: "player", label: "播放器", icon: "🎵" },
  { key: "studio", label: "创作工作室", icon: "🎹" },
];

const MENU = [
  { label: "我的音乐库", icon: "📚" },
  { label: "网络电台", icon: "📻" },
  { label: "播客", icon: "🎙️" },
  { label: "AI 推荐", icon: "✨" },
  { label: "懂你模式", icon: "🧠" },
  { label: "一起听", icon: "👥" },
  { label: "创意市场", icon: "🎨" },
  { label: "设置", icon: "⚙️" },
];

export function Sidebar() {
  const view = usePlayerStore((s) => s.view);
  const setView = usePlayerStore((s) => s.setView);

  return (
    <aside className="sidebar">
      <div className="sidebar__logo">
        <span className="sidebar__logo-icon">🍊</span>
        <span className="sidebar__logo-text">OrangeRadio</span>
      </div>

      <nav className="sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${view === item.key ? "nav-item--active" : ""}`}
            onClick={() => setView(item.key)}
          >
            <span className="nav-item__icon">{item.icon}</span>
            <span className="nav-item__label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar__menu">
        {MENU.map((item) => (
          <button key={item.label} className="menu-item">
            <span className="menu-item__icon">{item.icon}</span>
            <span className="menu-item__label">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__version">v0.2.0 · 播放器内核</div>
      </div>
    </aside>
  );
}
