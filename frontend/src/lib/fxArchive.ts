import {
  usePlayerStore, type VisualParams, type FullLayout,
  type AppearanceParams, type ParticleParams,
} from "../stores/playerStore";

/**
 * 视觉参数存档系统（对标 MineRadio userFxArchives，index.html 20123-20567）
 *
 * 存档 = 整套视觉方案 snapshot：外观参数（全局）+ 每个组合的粒子参数 + preset + fullLayout。
 * 持久化到 localStorage `orangeradio-fx-archives-v1`。
 * 导入/导出用 Tauri dialog + fs（JSON 文件），不可用时降级浏览器下载。
 *
 * 兼容：旧版 snapshot 是扁平 VisualParams & {preset, fullLayout}，
 * applyArchive 会自动降级处理（外观字段进全局，粒子字段注入当前组合）。
 */

const STORAGE_KEY = "orangeradio-fx-archives-v1";

/** v2 snapshot：整套视觉方案 */
export interface FxSnapshot {
  appearance: AppearanceParams;
  particlePresets: Record<string, ParticleParams>;
  preset: number;
  fullLayout: FullLayout;
}

export interface FxArchive {
  id: string;
  name: string;
  createdAt: number;
  savedAt: number;
  /** v2 结构；旧存档可能是扁平 VisualParams & {preset, fullLayout} */
  snapshot: FxSnapshot | (VisualParams & { preset: number; fullLayout: FullLayout });
}

/** 判断 snapshot 是否为 v2 结构 */
function isV2Snapshot(s: FxArchive["snapshot"]): s is FxSnapshot {
  return !!s && typeof s === "object" && "appearance" in s && "particlePresets" in s;
}

/** 序列化当前视觉状态为 v2 snapshot */
function captureSnapshot(): FxSnapshot {
  const s = usePlayerStore.getState();
  return {
    appearance: s.appearance,
    particlePresets: s.particlePresets,
    preset: s.visualParams.preset,
    fullLayout: s.fullLayout,
  };
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
  const store = usePlayerStore.getState();
  if (isV2Snapshot(arc.snapshot)) {
    // v2：整套视觉方案一次性恢复
    // 先切布局（会触发 resolveVisualParams），再写外观 + 所有组合粒子 + preset
    store.setFullLayout(arc.snapshot.fullLayout);
    // 用 patch 直接覆盖 appearance / particlePresets，再重新解析
    const next = {
      ...arc.snapshot.appearance,
      ...(arc.snapshot.particlePresets[
        `${arc.snapshot.fullLayout}:${arc.snapshot.preset}`
      ] ?? {}),
      preset: arc.snapshot.preset,
    } as VisualParams;
    usePlayerStore.setState({
      appearance: arc.snapshot.appearance,
      particlePresets: arc.snapshot.particlePresets,
      visualParams: next,
    });
    // 持久化
    try {
      localStorage.setItem(
        "orangeradio_visual_params",
        JSON.stringify({ v: 2, appearance: arc.snapshot.appearance, particlePresets: arc.snapshot.particlePresets, preset: arc.snapshot.preset }),
      );
    } catch { /* ignore */ }
  } else {
    // 旧版扁平 snapshot 降级：外观字段进全局，粒子字段注入当前组合，再切 preset/layout
    const { preset, fullLayout, ...vp } = arc.snapshot;
    store.setVisualParams(vp);
    if (typeof preset === "number") store.setVisualParams({ preset });
    if (fullLayout) store.setFullLayout(fullLayout);
  }
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
