import { usePlayerStore } from "../stores/playerStore";
import "./layout-controls.css";

/**
 * LayoutControls · VS Code 风格右上角布局开关
 *
 * 固定在右上角窗口控制按钮左侧，提供：
 * - 左侧面板（侧边栏）开关
 * - 底部面板（播放控制栏）开关
 *
 * 按钮激活态 = 对应面板当前可见，与 VS Code 标题栏行为一致。
 */
export function LayoutControls() {
  const sidebarHidden = usePlayerStore((s) => s.sidebarHidden);
  const playerBarHidden = usePlayerStore((s) => s.playerBarHidden);
  const setSidebarHidden = usePlayerStore((s) => s.setSidebarHidden);
  const setPlayerBarHidden = usePlayerStore((s) => s.setPlayerBarHidden);

  return (
    <div className="layout-controls" data-tauri-drag-region={false}>
      <button
        type="button"
        className={`layout-controls__btn ${sidebarHidden ? "" : "layout-controls__btn--active"}`}
        onClick={() => setSidebarHidden(!sidebarHidden)}
        title={sidebarHidden ? "展开侧边栏" : "收起侧边栏"}
        aria-label={sidebarHidden ? "展开侧边栏" : "收起侧边栏"}
        aria-pressed={!sidebarHidden}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
          <line x1="7.5" y1="4" x2="7.5" y2="20" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>
      <button
        type="button"
        className={`layout-controls__btn ${playerBarHidden ? "" : "layout-controls__btn--active"}`}
        onClick={() => setPlayerBarHidden(!playerBarHidden)}
        title={playerBarHidden ? "展开底部控制栏" : "收起底部控制栏"}
        aria-label={playerBarHidden ? "展开底部控制栏" : "收起底部控制栏"}
        aria-pressed={!playerBarHidden}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
          <line x1="3" y1="15.5" x2="21" y2="15.5" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>
    </div>
  );
}
