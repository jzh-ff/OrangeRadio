import { create } from "zustand";
import {
  scanWallpaperEngine,
  type WallpaperEngineEntry,
} from "../lib/wallpaperEngine";

/** 壁纸类型 */
export interface Wallpaper {
  id: string;
  name: string;
  type: "image" | "video";
  src: string;          // 内置：import.meta.env.BASE_URL + src；用户上传：convertFileSrc
  thumbnail?: string;
  builtin: boolean;
  addedAt: number;
  /** 持久化壁纸的本地文件绝对路径（用于删除；内置/临时预览无） */
  destPath?: string;
}

interface WallpaperState {
  list: Wallpaper[];
  activeId: string | null;     // null = 用 WallpaperBackground 银河
  setActive: (id: string | null) => void;
  addWallpaper: (w: Wallpaper) => void;
  removeWallpaper: (id: string) => void;
  reload: () => void;
  engineDirs: string[];
  engineEntries: WallpaperEngineEntry[];
  engineScanning: boolean;
  scanWallpaperEngine: () => Promise<void>;
  addEngineDir: (dir: string) => void;
}

const STORAGE_KEY = "orangeradio_wallpapers";
const ACTIVE_KEY = "orangeradio_active_wallpaper";
const ENGINE_DIRS_KEY = "orangeradio_wallpaper_engine_dirs";

/** 内置壁纸清单（从 frontend/public/wallpapers/manifest.json 加载） */
async function loadBuiltinWallpapers(): Promise<Wallpaper[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}wallpapers/manifest.json`);
    if (!res.ok) return [];
    const items = await res.json() as Omit<Wallpaper, "builtin">[];
    return items.map((w) => ({ ...w, builtin: true, src: `${import.meta.env.BASE_URL}wallpapers/${w.src}` }));
  } catch {
    return []; // manifest 不存在时返回空（用户上传仍可用）
  }
}

/** 用户上传壁纸索引（localStorage，src 存 convertFileSrc 后的 URL） */
function loadUserWallpapers(): Wallpaper[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Wallpaper[];
  } catch { return []; }
}

export const useWallpaperStore = create<WallpaperState>((set, get) => ({
  list: [],
  activeId: (() => { try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; } })(),
  setActive: (id) => {
    set({ activeId: id });
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch { /* ignore */ }
  },
  addWallpaper: (w) => {
    const next = [...get().list.filter((x) => x.id !== w.id), w];
    set({ list: next });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter((x) => !x.builtin)));
    } catch { /* ignore */ }
  },
  removeWallpaper: (id) => {
    const next = get().list.filter((x) => x.id !== id);
    set({ list: next });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter((x) => !x.builtin)));
    } catch { /* ignore */ }
    if (get().activeId === id) set({ activeId: null });
  },
  reload: () => {
    Promise.all([loadBuiltinWallpapers(), loadUserWallpapers()]).then(([builtin, user]) => {
      set({ list: [...builtin, ...user] });
    });
  },
  engineDirs: (() => {
    try {
      return JSON.parse(localStorage.getItem(ENGINE_DIRS_KEY) || "[]") as string[];
    } catch {
      return [] as string[];
    }
  })(),
  engineEntries: [],
  engineScanning: false,
  scanWallpaperEngine: async () => {
    if (get().engineScanning) return;
    set({ engineScanning: true });
    try {
      const { engineDirs } = get();
      const result = await scanWallpaperEngine(engineDirs.length > 0 ? engineDirs : null);
      // 首次自动发现:把 discovered_dirs 写回 engineDirs 持久化
      if (engineDirs.length === 0 && result.discovered_dirs.length > 0) {
        const next = result.discovered_dirs;
        localStorage.setItem(ENGINE_DIRS_KEY, JSON.stringify(next));
        set({ engineDirs: next });
      }
      set({ engineEntries: result.entries });
    } catch (e) {
      console.warn("[Wallpaper Engine] 扫描失败:", e);
      set({ engineEntries: [] });
    } finally {
      set({ engineScanning: false });
    }
  },
  addEngineDir: (dir) => {
    const next = Array.from(new Set([...get().engineDirs, dir]));
    localStorage.setItem(ENGINE_DIRS_KEY, JSON.stringify(next));
    set({ engineDirs: next });
  },
}));

// 初始化加载（模块导入时触发）
useWallpaperStore.getState().reload();
