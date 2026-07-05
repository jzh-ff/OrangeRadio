import { usePlayerStore, type VisualParams, type FullLayout } from "../stores/playerStore";

/**
 * 视觉参数存档系统（对标 MineRadio userFxArchives，index.html 20123-20567）
 *
 * 存档 = 当前 visualParams + preset + fullLayout 的 snapshot。
 * 持久化到 localStorage `orangeradio-fx-archives-v1`。
 * 导入/导出用 Tauri dialog + fs（JSON 文件），不可用时降级浏览器下载。
 */

const STORAGE_KEY = "orangeradio-fx-archives-v1";

export interface FxArchive {
  id: string;
  name: string;
  createdAt: number;
  savedAt: number;
  snapshot: VisualParams & { preset: number; fullLayout: FullLayout };
}

/** 序列化当前视觉状态为 snapshot */
function captureSnapshot(): FxArchive["snapshot"] {
  const vp = usePlayerStore.getState().visualParams;
  return { ...vp, preset: vp.preset, fullLayout: usePlayerStore.getState().fullLayout };
}

/** 加载所有存档 */
export function loadArchives(): FxArchive[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FxArchive[];
  } catch {
    return [];
  }
}

/** 保存存档列表到 localStorage */
function persistArchives(list: FxArchive[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

/** 新建存档（捕获当前 snapshot） */
export function createArchive(name: string): FxArchive {
  const now = Date.now();
  const arc: FxArchive = {
    id: `arc-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: name || `存档 ${new Date().toLocaleString("zh-CN")}`,
    createdAt: now,
    savedAt: now,
    snapshot: captureSnapshot(),
  };
  persistArchives([...loadArchives(), arc]);
  return arc;
}

/** 保存（更新已有存档的 snapshot 为当前状态） */
export function saveArchive(id: string): void {
  persistArchives(
    loadArchives().map((a) =>
      a.id === id ? { ...a, savedAt: Date.now(), snapshot: captureSnapshot() } : a
    )
  );
}

/** 重命名 */
export function renameArchive(id: string, name: string): void {
  persistArchives(loadArchives().map((a) => (a.id === id ? { ...a, name } : a)));
}

/** 删除 */
export function removeArchive(id: string): void {
  persistArchives(loadArchives().filter((a) => a.id !== id));
}

/** 应用存档（写回 playerStore） */
export function applyArchive(arc: FxArchive): void {
  const { preset, fullLayout, ...vp } = arc.snapshot;
  usePlayerStore.getState().setVisualParams(vp);
  if (typeof preset === "number") usePlayerStore.getState().setVisualParams({ preset });
  if (fullLayout) usePlayerStore.getState().setFullLayout(fullLayout);
}

/** 导出存档为 JSON 文件（Blob 下载，纯浏览器方案，不依赖 Tauri fs 插件） */
export async function exportArchive(arc: FxArchive): Promise<void> {
  const payload = {
    type: "orangeradio-fx-archive",
    schema: 1,
    exportedAt: Date.now(),
    name: arc.name,
    savedAt: arc.savedAt,
    snapshot: arc.snapshot,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${arc.name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 从 JSON 文件导入存档（input file + FileReader，纯浏览器方案，不依赖 Tauri fs） */
export function importArchiveFromFile(file: File): Promise<FxArchive | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data.type !== "orangeradio-fx-archive" || !data.snapshot) {
          resolve(null);
          return;
        }
        const arc: FxArchive = {
          id: `arc-imported-${Date.now()}`,
          name: data.name || "导入的存档",
          createdAt: data.createdAt || Date.now(),
          savedAt: data.savedAt || Date.now(),
          snapshot: data.snapshot,
        };
        persistArchives([...loadArchives(), arc]);
        resolve(arc);
      } catch {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
