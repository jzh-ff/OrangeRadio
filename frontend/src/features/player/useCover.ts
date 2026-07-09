import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Track } from "../../stores/libraryStore";

/**
 * 默认专辑封面（黑胶唱片图）
 *
 * 当 track 无封面（artwork 缺失）时统一使用此图，
 * 替代早期的 "OR" 文字占位。来自 apps/desktop/src-tauri/icons/黑胶.png。
 */
export const DEFAULT_COVER = "/vinyl.png";

// 前端封面缓存：避免多组件同时请求同一 cover_proxy
const COVER_CACHE = new Map<string, string | null>();
const COVER_INFLIGHT = new Map<string, Promise<string | null>>();

function coverCacheKey(track: Track): string {
  const src = track.meta?.artwork?.source;
  if (!src) return `none:${track.id}`;
  if (src.kind === "url") return `url:${src.url || ""}`;
  if (src.kind === "local") return `local:${src.path || ""}`;
  return `other:${track.id}`;
}

/**
 * 封面 URL 解析工具（同步版）
 *
 * 根据 track.meta.artwork.source.kind 分支：
 *   - url      → 直接返回网络 URL（网易云/QQ 等在线音源）
 *   - local    → convertFileSrc(path)（本地音乐提取的封面文件）
 *   - embedded → null（暂不支持）
 *   - 无 artwork → null
 *
 * 注意：url 类型返回的是远端 URL，浏览器加载时可能受 CORS 限制。
 *   - <img> 标签：可以直接加载显示
 *   - canvas getImageData / WebGL texture：会因 CORS 失败
 *   - cinema 模式的 CoverParticles 平面网格需要走 `proxyCoverUrl` 拿本地路径
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
 * 封面代理（异步）：远端 URL → Rust cover_proxy 拉本地缓存 → convertFileSrc 返回
 *
 * 绕开浏览器 CORS，让 WebGL/canvas 能拿到封面像素（CoverParticles 平面网格依赖此）。
 * 命中本地缓存秒返。失败返回 null（CoverParticles 收到 hasCover=false 后用默认色）。
 * 对同一封面做前端级去重：多个组件同时调用只触发一次 cover_proxy。
 */
export async function proxyCoverUrl(
  track: Track | null | undefined
): Promise<string | null> {
  if (!track) return null;
  const key = coverCacheKey(track);
  const cached = COVER_CACHE.get(key);
  if (cached !== undefined) return cached;

  const inflight = COVER_INFLIGHT.get(key);
  if (inflight) return inflight;

  const promise = doProxyCoverUrl(track);
  COVER_INFLIGHT.set(key, promise);
  const result = await promise;
  COVER_INFLIGHT.delete(key);
  COVER_CACHE.set(key, result);
  return result;
}

async function doProxyCoverUrl(track: Track): Promise<string | null> {
  const src = track.meta?.artwork?.source;
  if (!src) return null;
  if (src.kind === "local" && src.path) return convertFileSrc(src.path);
  if (src.kind === "url" && src.url) {
    try {
      const localPath = await invoke<string>("cover_proxy", { url: src.url });
      return convertFileSrc(localPath);
    } catch (e) {
      console.warn("[cover_proxy] 封面代理失败:", e);
      return null;
    }
  }
  return null;
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
