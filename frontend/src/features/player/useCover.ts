import { convertFileSrc } from "@tauri-apps/api/core";
import type { Track } from "../../stores/libraryStore";

/**
 * 默认专辑封面（黑胶唱片图）
 *
 * 当 track 无封面（artwork 缺失）时统一使用此图，
 * 替代早期的 "OR" 文字占位。来自 apps/desktop/src-tauri/icons/黑胶.png。
 */
export const DEFAULT_COVER = "/vinyl.png";

/**
 * 封面 URL 解析工具
 *
 * 根据 track.meta.artwork.source.kind 分支：
 *   - url      → 直接返回网络 URL（网易云等在线音源）
 *   - local    → convertFileSrc(path)（本地音乐提取的封面文件）
 *   - embedded → null（暂不支持，需要专门 IPC）
 *   - 无 artwork → null
 */
export function getCoverUrl(track: Track | null | undefined): string | null {
  if (!track?.meta?.artwork?.source) return null;
  const src = track.meta.artwork.source;
  switch (src.kind) {
    case "url":
      return src.url || null;
    case "local":
      return src.path ? convertFileSrc(src.path) : null;
    default:
      return null;
  }
}

/**
 * 从封面图片提取主色调（用于动态配色）
 *
 * 用 canvas 采样图片中心区域，取平均色。
 * 返回 [r, g, b]（0~255），失败返回 null。
 */
export function extractDominantColor(imgUrl: string): Promise<[number, number, number] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 16; // 缩小到 16x16 采样
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          // 跳过过暗/过亮的像素（避免黑/白主导）
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (lum < 20 || lum > 235) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (count === 0) return resolve(null);
        resolve([Math.round(r / count), Math.round(g / count), Math.round(b / count)]);
      } catch {
        resolve(null); // CORS 污染等
      }
    };
    img.onerror = () => resolve(null);
    img.src = imgUrl;
  });
}
