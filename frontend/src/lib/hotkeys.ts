import { usePlayerStore } from "../stores/playerStore";
import { engineRef } from "../App";
import { toggleLyricOverlay } from "./lyricWindow";

/**
 * 局内热键系统（对标 MineRadio HOTKEY_ACTIONS + handleConfiguredLocalHotkey）
 *
 * 纯前端 keydown 监听，不依赖 Tauri global_shortcut 插件。
 * 全局热键（系统级）作为 v0.4+ 延后，需 Tauri 插件。
 *
 * 7 个动作：播放/上一首/下一首/音量+/-/全屏/桌面歌词
 * 持久化到 localStorage `orangeradio-hotkey-settings-v1`。
 */

export interface HotkeyBinding {
  /** 动作 id */
  action: string;
  /** 显示名 */
  label: string;
  /** 分类 */
  category: "playback" | "volume" | "window" | "lyrics";
  /** 按键组合，如 "Space" / "ArrowLeft" / "Alt+KeyL" */
  key: string;
}

const STORAGE_KEY = "orangeradio-hotkey-settings-v1";

/** 默认局内热键绑定（对标 MineRadio getHotkeyDefaults） */
export const DEFAULT_HOTKEYS: HotkeyBinding[] = [
  { action: "play-pause", label: "播放 / 暂停", category: "playback", key: "Space" },
  { action: "prev", label: "上一首", category: "playback", key: "ArrowLeft" },
  { action: "next", label: "下一首", category: "playback", key: "ArrowRight" },
  { action: "volume-up", label: "音量增加", category: "volume", key: "ArrowUp" },
  { action: "volume-down", label: "音量降低", category: "volume", key: "ArrowDown" },
  { action: "fullscreen", label: "全屏播放", category: "window", key: "KeyF" },
  { action: "desktop-lyrics", label: "桌面歌词", category: "lyrics", key: "Alt+KeyL" },
];

/** 加载热键绑定（合并默认值） */
export function loadHotkeys(): HotkeyBinding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HOTKEYS;
    const saved = JSON.parse(raw) as Partial<HotkeyBinding>[];
    // 用 saved 覆盖默认值的 key（保持 action/label/category 不变）
    return DEFAULT_HOTKEYS.map((d) => {
      const s = saved.find((x) => x.action === d.action);
      return s && s.key ? { ...d, key: s.key } : d;
    });
  } catch {
    return DEFAULT_HOTKEYS;
  }
}

/** 保存热键绑定 */
export function saveHotkeys(list: HotkeyBinding[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

/** 重置某个动作为默认 */
export function resetHotkey(action: string): HotkeyBinding[] {
  const list = loadHotkeys().map((h) =>
    h.action === action ? { ...h, key: DEFAULT_HOTKEYS.find((d) => d.action === action)!.key } : h
  );
  saveHotkeys(list);
  return list;
}

/** 规范化键盘事件为热键字符串（对标 MineRadio normalizeHotkeyEvent）
 *  用 e.code + 修饰键，如 "Alt+KeyL" / "Space" / "ArrowLeft" */
export function normalizeHotkeyEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  const code = e.code;
  return mods.length > 0 ? `${mods.join("+")}+${code}` : code;
}

/** 检测热键冲突（同 scope 内是否有其他动作用了相同 key） */
export function detectConflict(list: HotkeyBinding[], action: string, key: string): boolean {
  return list.some((h) => h.action !== action && h.key === key);
}

/** 判断事件目标是否在输入框内（输入框内不触发热键） */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
}

/** 执行热键动作 */
function executeAction(action: string): void {
  const store = usePlayerStore.getState();
  switch (action) {
    case "play-pause":
      engineRef.toggle();
      break;
    case "prev":
      engineRef.prev();
      break;
    case "next":
      engineRef.next();
      break;
    case "volume-up":
      engineRef.setVol(Math.min(1, store.volume + 0.1));
      break;
    case "volume-down":
      engineRef.setVol(Math.max(0, store.volume - 0.1));
      break;
    case "fullscreen":
      store.setFullPlayer(!store.fullPlayerOpen);
      break;
    case "desktop-lyrics":
      void toggleLyricOverlay();
      break;
  }
}

/** 热键监听器卸载函数 */
let unlistenFn: (() => void) | null = null;

/** 启动局内热键监听（应用启动时调用一次） */
export function startHotkeyListener(): () => void {
  if (unlistenFn) return unlistenFn;
  const handler = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const key = normalizeHotkeyEvent(e);
    const list = loadHotkeys();
    const hit = list.find((h) => h.key === key);
    if (hit) {
      e.preventDefault();
      executeAction(hit.action);
    }
  };
  window.addEventListener("keydown", handler);
  unlistenFn = () => {
    window.removeEventListener("keydown", handler);
    unlistenFn = null;
  };
  return unlistenFn;
}

// ===== 全局热键（v0.4 P11.3，Tauri global_shortcut 插件，系统级） =====

/** 默认全局热键绑定（Tauri 格式：修饰键 Control/Alt/Shift/Meta + 键名） */
export const DEFAULT_GLOBAL_HOTKEYS: HotkeyBinding[] = [
  { action: "play-pause", label: "播放 / 暂停", category: "playback", key: "Control+Alt+Space" },
  { action: "prev", label: "上一首", category: "playback", key: "Control+Alt+ArrowLeft" },
  { action: "next", label: "下一首", category: "playback", key: "Control+Alt+ArrowRight" },
  { action: "volume-up", label: "音量增加", category: "volume", key: "Control+Alt+ArrowUp" },
  { action: "volume-down", label: "音量降低", category: "volume", key: "Control+Alt+ArrowDown" },
  { action: "fullscreen", label: "全屏播放", category: "window", key: "Control+Alt+KeyF" },
  { action: "desktop-lyrics", label: "桌面歌词", category: "lyrics", key: "Control+Alt+KeyL" },
];

const GLOBAL_STORAGE_KEY = "orangeradio-global-hotkeys-v1";

/** 加载全局热键绑定 */
export function loadGlobalHotkeys(): HotkeyBinding[] {
  try {
    const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
    if (!raw) return DEFAULT_GLOBAL_HOTKEYS;
    const saved = JSON.parse(raw) as Partial<HotkeyBinding>[];
    return DEFAULT_GLOBAL_HOTKEYS.map((d) => {
      const s = saved.find((x) => x.action === d.action);
      return s && s.key ? { ...d, key: s.key } : d;
    });
  } catch {
    return DEFAULT_GLOBAL_HOTKEYS;
  }
}

/** 保存全局热键绑定 */
export function saveGlobalHotkeys(list: HotkeyBinding[]): void {
  try {
    localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

/** 注册所有全局热键（应用启动时调用，需 Tauri global_shortcut 插件） */
export async function registerGlobalHotkeys(): Promise<{ ok: boolean; conflicts: string[] }> {
  const conflicts: string[] = [];
  try {
    const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
    // 先清空旧绑定
    const old = loadGlobalHotkeys();
    for (const h of old) {
      if (h.key) {
        try { await unregister(h.key); } catch { /* 未注册过，忽略 */ }
      }
    }
    // 注册新绑定
    const list = loadGlobalHotkeys();
    for (const h of list) {
      if (!h.key) continue;
      try {
        await register(h.key, () => executeAction(h.action));
      } catch {
        conflicts.push(h.key);
      }
    }
    return { ok: conflicts.length === 0, conflicts };
  } catch {
    // 插件不可用（非 Tauri 环境或插件未注册）
    return { ok: false, conflicts: [] };
  }
}

/** 注销所有全局热键（应用退出时调用） */
export async function unregisterAllGlobalHotkeys(): Promise<void> {
  try {
    const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
    const list = loadGlobalHotkeys();
    for (const h of list) {
      if (h.key) {
        try { await unregister(h.key); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

/** 重置某个全局动作为默认 */
export function resetGlobalHotkey(action: string): HotkeyBinding[] {
  const list = loadGlobalHotkeys().map((h) =>
    h.action === action ? { ...h, key: DEFAULT_GLOBAL_HOTKEYS.find((d) => d.action === action)!.key } : h
  );
  saveGlobalHotkeys(list);
  return list;
}
