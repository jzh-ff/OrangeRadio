import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./window-controls.css";

/**
 * WindowControls · 紧凑悬浮的窗口控制按钮（min / max / close）
 *
 * 替代旧 TitleBar 的窗口操作功能。固定在右上角，只占 ~96×32px，
 * 跟 Sidebar 顶部留 8px 间距，跟全局暗色玻璃语言统一。
 *
 * 关闭按钮：交给外部 onRequestClose 回调（App 端弹 CloseConfirmDialog
 * 让用户选"最小化到托盘 / 退出 / 取消"），不再直接 win.close()。
 */
export function WindowControls({
  onRequestClose,
}: {
  onRequestClose: () => void;
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    // 初始化：拉一次当前状态 + 订阅变化（Tauri 2 提供了 resize 事件，但 isMaximized
    // 没内置事件，简单点：监听 resize 事件后重新查询）
    win.isMaximized().then(setIsMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [win]);

  const onMinimize = () => win.hide(); // 隐藏到托盘（不是任务栏）
  const onToggleMax = () => win.toggleMaximize();
  const onClose = () => onRequestClose(); // 交给上层弹 CloseConfirmDialog

  return (
    <div className="window-controls" data-tauri-drag-region={false}>
      <button
        type="button"
        className="window-controls__btn"
        onClick={onMinimize}
        title="最小化到托盘"
        aria-label="最小化"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="window-controls__btn"
        onClick={onToggleMax}
        title={isMaximized ? "还原" : "最大化"}
        aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
      >
        {isMaximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="2.5" y="3.5" width="6" height="6" rx="0.6" stroke="currentColor" strokeWidth="1.1" />
            <path d="M4 3.5V2.5a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1V7" stroke="currentColor" strokeWidth="1.1" fill="none" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="8" height="8" rx="0.6" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-controls__btn window-controls__btn--close"
        onClick={onClose}
        title="关闭（选择最小化到托盘或退出）"
        aria-label="关闭窗口"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
