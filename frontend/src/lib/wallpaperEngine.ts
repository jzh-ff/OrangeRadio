import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { extractVideoThumbnail } from "./wallpaperUpload";
import type { Wallpaper } from "../stores/wallpaperStore";

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

/** 把 WE 壁纸文件复制到本地 {data_dir}/wallpapers，返回可加入壁纸库的 Wallpaper（独立于 Steam）。
 *  收藏后 Steam 卸载/路径变化不影响（本地有副本）。视频自动提首帧作 thumbnail。 */
export async function importWeToLocal(entry: WallpaperEngineEntry): Promise<{ wallpaper: Wallpaper; destPath: string } | null> {
  const dir = entry.source_dir.replace(/[\\/]+$/, "");
  const file = entry.file.replace(/^[\\/]+/, "");
  const absPath = `${dir}/${file}`;
  const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(file);
  const destPath = await invoke<string>("wallpaper_save", {
    srcPath: absPath,
    name: `${entry.workshop_id}-${file}`,
  });
  const url = convertFileSrc(destPath);
  const thumb = isVideo ? await extractVideoThumbnail(url) : undefined;
  return {
    destPath,
    wallpaper: {
      id: `we-local-${entry.workshop_id}`,
      name: entry.title,
      type: isVideo ? "video" : "image",
      src: url,
      thumbnail: thumb || (isVideo ? undefined : url),
      builtin: false,
      addedAt: Date.now(),
      destPath,
    },
  };
}
