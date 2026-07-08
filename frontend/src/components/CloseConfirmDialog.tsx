import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./close-confirm-dialog.css";

/**
 * CloseConfirmDialog · 关闭应用确认弹窗
 *
 * 替代旧的"无脑拦截 CloseRequested → hide"逻辑：
 * 用户点窗口右上角 X → 弹此 Modal，让用户在三种意图中明确选择。
 *
 * - 「最小化到托盘」→ win.hide()（保持后台播放）
 * - 「退出应用」    → invoke("app_exit")（Rust 端 app.exit(0)）
 * - 点遮罩 / 按 Esc / 点 ×  → 关闭 Modal（视为取消，不退出也不最小化）
 *
 * 由 App.tsx 维护 open state，WindowControls 的 onClose 触发 open=true。
 */
export function CloseConfirmDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Esc 关闭（视为取消）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onMinimizeToTray = async () => {
    try {
      await getCurrentWindow().hide();
    } catch (e) {
      console.warn("[CloseConfirmDialog] 隐藏到托盘失败:", e);
    }
    onClose();
  };

  const onExit = async () => {
    // 先关 Modal，避免 exit 异步过程中残留 UI
    onClose();
    try {
      await invoke("app_exit");
    } catch (e) {
      console.error("[CloseConfirmDialog] app_exit 失败:", e);
    }
  };

  return (
    <div
      className="ccd-overlay"
      onClick={(e) => {
        // 点遮罩关闭（视为取消）
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ccd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ccd-title"
      >
        <div className="ccd-modal__head">
          <h2 id="ccd-title" className="ccd-title">
            关闭 OrangeRadio？
          </h2>
          <button
            type="button"
            className="ccd-close"
            onClick={onClose}
            title="取消（Esc）"
            aria-label="取消"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <p className="ccd-desc">
          关闭窗口时，应用默认会继续在后台运行以保持音乐播放。
          你也可以选择完全退出。
        </p>
        <div className="ccd-actions">
          <button
            type="button"
            className="ccd-btn ccd-btn--ghost"
            onClick={onClose}
            title="返回应用"
          >
            取消
          </button>
          <button
            type="button"
            className="ccd-btn ccd-btn--primary"
            onClick={onMinimizeToTray}
            title="隐藏窗口，后台继续播放"
          >
            最小化到托盘
          </button>
          <button
            type="button"
            className="ccd-btn ccd-btn--danger"
            onClick={onExit}
            title="完全退出 OrangeRadio"
          >
            退出应用
          </button>
        </div>
      </div>
    </div>
  );
}
