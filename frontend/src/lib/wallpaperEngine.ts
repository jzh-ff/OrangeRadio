import { invoke } from "@tauri-apps/api/core";

/** 与 Rust WallpaperEngineKind(serde snake_case)对齐 */
export type WeKind =
  | "video" | "picture" | "scene" | "web" | "application" | "unknown";

export interface WallpaperEngineEntry {
  workshop_id: string;
  title: string;
  kind: WeKind;
  file: string;
  preview: string | null;
  size_bytes: number;
  tags: string[];
  applicable: boolean;
  source_dir: string;
}

export interface WallpaperEngineScanResult {
  entries: WallpaperEngineEntry[];
  discovered_dirs: string[];
}

/** 拼原始 orangeradio://localhost/wefile?path=<abs> URL(再由 toWebviewUrl 平台适配) */
export function weFileUrl(sourceDir: string, rel: string): string {
  const dir = sourceDir.replace(/[\\/]+$/, "");
  const name = rel.replace(/^[\\/]+/, "");
  return `orangeradio://localhost/wefile?path=${encodeURIComponent(`${dir}/${name}`)}`;
}

export function weKindLabel(k: WeKind): string {
  const m: Record<WeKind, string> = {
    video: "视频", picture: "图片", scene: "场景", web: "网页", application: "应用", unknown: "未知",
  };
  return m[k];
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** 调 Rust 扫描命令。dirs 传 null 走自动发现。 */
export async function scanWallpaperEngine(
  dirs: string[] | null,
): Promise<WallpaperEngineScanResult> {
  return invoke<WallpaperEngineScanResult>("wallpaper_engine_scan", { dirs });
}
