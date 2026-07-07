import { useState, useEffect } from "react";
import { usePlayerStore } from "../stores/playerStore";
import {
  loadHotkeys, saveHotkeys, resetHotkey, normalizeHotkeyEvent, detectConflict,
  loadGlobalHotkeys, saveGlobalHotkeys, resetGlobalHotkey, registerGlobalHotkeys,
  type HotkeyBinding,
} from "../lib/hotkeys";
import "../styles/hotkeys-modal.css";

/**
 * 热键设置弹窗（对标 MineRadio #hotkey-modal）
 *
 * 局内热键：纯前端 keydown，可重绑 7 个动作，冲突检测标黄。
 * 全局热键：Tauri global_shortcut 插件，系统级，注册到 OS，窗口失焦也生效。
 */

const CATEGORIES: { id: HotkeyBinding["category"]; name: string }[] = [
  { id: "playback", name: "播放" },
  { id: "volume", name: "音量" },
  { id: "window", name: "窗口" },
  { id: "lyrics", name: "歌词" },
];

/** 把热键字符串格式化为显示文本 */
function fmtKey(key: string): string {
  return key
    .replace(/Control/g, "Ctrl")
    .replace("Key", "")
    .replace("Arrow", "")
    .replace("Digit", "");
}

/** 全局热键录入：用 e.code + 修饰键，Ctrl→Control（Tauri 格式） */
function normalizeGlobalHotkeyEvent(e: KeyboardEvent): string {
  return normalizeHotkeyEvent(e).replace("Ctrl", "Control");
}

export function HotkeysModal() {
  const open = usePlayerStore((s) => s.hotkeysModalOpen);
  const close = () => usePlayerStore.setState({ hotkeysModalOpen: false });
  const [scope, setScope] = useState<"local" | "global">("local");
  const [bindings, setBindings] = useState<HotkeyBinding[]>(() => loadHotkeys());
  const [capturingAction, setCapturingAction] = useState<string | null>(null);

  // scope 切换时重新加载对应 bindings
  useEffect(() => {
    setBindings(scope === "local" ? loadHotkeys() : loadGlobalHotkeys());
    setCapturingAction(null);
  }, [scope]);

  // 录入态：捕获 keydown
  useEffect(() => {
    if (!capturingAction) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Backspace" || e.key === "Delete") {
        setBindings((prev) => prev.map((h) => (h.action === capturingAction ? { ...h, key: "" } : h)));
        setCapturingAction(null);
        return;
      }
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      const key = scope === "local" ? normalizeHotkeyEvent(e) : normalizeGlobalHotkeyEvent(e);
      const next = bindings.map((h) => (h.action === capturingAction ? { ...h, key } : h));
      setBindings(next);
      if (scope === "local") {
        saveHotkeys(next);
      } else {
        saveGlobalHotkeys(next);
        void registerGlobalHotkeys(); // 重新注册全局热键
      }
      setCapturingAction(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturingAction, bindings, scope]);

  if (!open) return null;

  const handleReset = (action: string) => {
    if (scope === "local") {
      setBindings(resetHotkey(action));
    } else {
      setBindings(resetGlobalHotkey(action));
      void registerGlobalHotkeys();
    }
  };

  return (
    <div className="hk-overlay" onClick={close}>
      <div className="hk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hk-modal__head">
          <div>
            <h2 className="hk-modal__title">热键设置</h2>
            <p className="hk-modal__desc">
              局内热键仅在 OrangeRadio 窗口内生效；全局热键注册到系统，窗口失焦也能触发（可能与其他软件冲突）。
            </p>
          </div>
          <button className="hk-modal__close" onClick={close}>×</button>
        </div>

        <div className="hk-modal__tabs">
          <button
            className={`hk-tab ${scope === "local" ? "hk-tab--active" : ""}`}
            onClick={() => setScope("local")}
          >局内热键</button>
          <button
            className={`hk-tab ${scope === "global" ? "hk-tab--active" : ""}`}
            onClick={() => setScope("global")}
          >全局热键</button>
          <span className="hk-modal__hint">按 Backspace/Delete 清空当前功能热键</span>
        </div>

        <div className="hk-list">
          {CATEGORIES.map((cat) => (
            <div key={cat.id} className="hk-category">
              <div className="hk-category__title">{cat.name}</div>
              {bindings.filter((h) => h.category === cat.id).map((h) => {
                const conflict = !!h.key && detectConflict(bindings, h.action, h.key);
                const capturing = capturingAction === h.action;
                return (
                  <div key={h.action} className="hk-row">
                    <span className="hk-row__label">{h.label}</span>
                    <button
                      className={`hk-row__key ${capturing ? "hk-row__key--capturing" : ""} ${conflict ? "hk-row__key--conflict" : ""}`}
                      onClick={() => setCapturingAction(h.action)}
                    >
                      {capturing ? "按下任意键..." : (h.key ? fmtKey(h.key) : "未绑定")}
                    </button>
                    <button className="hk-row__default" onClick={() => handleReset(h.action)}>默认</button>
                    <span className={`hk-row__status ${conflict ? "hk-row__status--conflict" : "hk-row__status--ok"}`}>
                      {conflict ? "冲突" : "可用"}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
