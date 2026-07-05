/**
 * 桌面歌词悬浮窗的窗口管理工具。
 *
 * 悬浮窗 label = "lyric-overlay"，运行时用 WebviewWindow 创建（不写死在 tauri.conf.json，
 * 便于动态显隐与位置控制）。窗口位置记到 localStorage，下次开窗恢复。
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const LYRIC_LABEL = "lyric-overlay";
const POS_KEY = "orangeradio_lyric_window_pos";

interface SavedPos {
  x: number;
  y: number;
}

function loadPos(): SavedPos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw) as SavedPos;
  } catch {
    /* ignore */
  }
  return null;
}

/** 持久化窗口位置（拖动结束时调用） */
export function saveLyricPos(x: number, y: number): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
  } catch {
    /* ignore */
  }
}

/** 拿到已存在的悬浮窗实例（不存在返回 null） */
export async function getLyricOverlay(): Promise<WebviewWindow | null> {
  try {
    return (await WebviewWindow.getByLabel(LYRIC_LABEL)) ?? null;
  } catch {
    return null;
  }
}

/** 创建并显示悬浮窗；已存在则只 show + 聚焦。位置优先 localStorage 记忆。 */
export async function openLyricOverlay(): Promise<WebviewWindow | null> {
  const existing = await getLyricOverlay();
  if (existing) {
    await existing.show().catch(() => {});
    await existing.setFocus().catch(() => {});
    return existing;
  }

  const saved = loadPos();
  const opts: ConstructorParameters<typeof WebviewWindow>[1] = {
    title: "OrangeRadio 桌面歌词",
    width: 900,
    height: 140,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    center: saved === null, // 无记忆位置时系统居中
  };
  if (saved) {
    opts.x = saved.x;
    opts.y = saved.y;
  }

  const win = new WebviewWindow(LYRIC_LABEL, opts);
  win.once("tauri://error", (e) => console.error("[桌面歌词] 创建失败", e));
  return win;
}

/**
 * 切换悬浮窗显隐：不存在则创建并显示；已显示则隐藏；已隐藏则显示。
 * 返回操作后是否「可见」。
 */
export async function toggleLyricOverlay(): Promise<boolean> {
  const win = await getLyricOverlay();
  if (!win) {
    await openLyricOverlay();
    return true;
  }
  const visible = await win.isVisible().catch(() => true);
  if (visible) {
    await win.hide().catch(() => {});
    return false;
  }
  await win.show().catch(() => {});
  await win.setFocus().catch(() => {});
  return true;
}

/** 关闭悬浮窗（销毁） */
export async function closeLyricOverlay(): Promise<void> {
  const win = await getLyricOverlay();
  if (win) await win.close().catch(() => {});
}

/** 设置鼠标穿透：locked=true 整窗忽略鼠标事件（穿透到下层应用），false 恢复。 */
export async function setLyricLock(locked: boolean): Promise<void> {
  const win = await getLyricOverlay();
  if (win) await win.setIgnoreCursorEvents(locked).catch(() => {});
}

/** 当前是否锁定（穿透）——读 localStorage 记忆（与 setLyricLock 配合由调用方维护） */
export function isLyricLocked(): boolean {
  return localStorage.getItem("orangeradio_lyric_locked") === "1";
}

export function persistLyricLock(locked: boolean): void {
  try {
    localStorage.setItem("orangeradio_lyric_locked", locked ? "1" : "0");
  } catch {
    /* ignore */
  }
}
