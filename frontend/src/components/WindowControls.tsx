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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="7" width="12" height="12" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M8 7V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="1.2" stroke="currentColor" strokeWidth="1.7" />
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
