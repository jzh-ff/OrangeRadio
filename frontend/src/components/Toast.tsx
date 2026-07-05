import { useEffect, useState } from "react";
import "./Toast.css";

export type ToastKind = "info" | "warning" | "error";

export interface ToastAction {
  label: string;
  /** 点击回调（一般用于"重新扫码"等快捷动作）。点击后 toast 自动消失 */
  onClick: () => void;
  /** 可选：是否禁用 */
  disabled?: boolean;
}

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  /** 自动消失时间（毫秒），默认 5000 */
  ttl?: number;
  /** 可选操作按钮（如"重新扫码"） */
  action?: ToastAction;
}

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

/**
 * 全局 toast 栈：右下角浮窗，垂直堆叠，自动消失
 * 用法：父组件维护 toast state，调用 pushToast 添加
 */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [exiting, setExiting] = useState(false);
  const ttl = item.ttl ?? 5000;
  // 有 action 时给更长时间，让用户有机会点
  const effectiveTtl = item.action ? Math.max(ttl, 8000) : ttl;

  useEffect(() => {
    const fadeTimer = setTimeout(() => setExiting(true), effectiveTtl - 300);
    const removeTimer = setTimeout(() => onDismiss(item.id), effectiveTtl);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [item.id, effectiveTtl, onDismiss]);

  const icon =
    item.kind === "error" ? "⚠️" : item.kind === "warning" ? "⚠️" : "ℹ️";

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.action?.disabled) return;
    item.action?.onClick();
    onDismiss(item.id);
  };

  return (
    <div
      className={`toast toast--${item.kind} ${exiting ? "toast--exit" : ""}`}
      onClick={item.action ? undefined : () => onDismiss(item.id)}
      title={item.action ? undefined : "点击关闭"}
    >
      <span className="toast__icon">{icon}</span>
      <span className="toast__msg">{item.message}</span>
      {item.action && (
        <button
          className="toast__action"
          onClick={handleAction}
          disabled={item.action.disabled}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}

/**
 * 轻量 hook：返回 [toasts, pushToast]
 */
export function useToasts(): {
  toasts: ToastItem[];
  pushToast: (msg: string, kind?: ToastKind, ttl?: number, action?: ToastAction) => void;
  dismiss: (id: number) => void;
} {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = (
    message: string,
    kind: ToastKind = "info",
    ttl = 5000,
    action?: ToastAction,
  ) => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, message, kind, ttl, action }]);
  };
  const dismiss = (id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  };
  return { toasts, pushToast, dismiss };
}