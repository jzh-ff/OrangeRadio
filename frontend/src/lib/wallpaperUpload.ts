import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import type { Wallpaper } from "../stores/wallpaperStore";

/**
 * 壁纸持久化上传（v0.4 P12.2）
 *
 * 流程：dialog.open 选文件 → invoke("wallpaper_save") 复制到 {data_dir}/wallpapers
 *      → convertFileSrc 转可访问 URL → 写入 wallpaperStore（持久化 localStorage）
 *
 * 视频首帧截图作 thumbnail：用 <video> seek 到 0.1s → canvas toDataURL。
 * 复制成功后返回 Wallpaper 元数据（含 destPath 用于后续删除）。
 */

/** 从视频 URL 提取首帧作 thumbnail（data URL） */
export function extractVideoThumbnail(videoUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";
    video.src = videoUrl;
    video.onloadeddata = () => {
      try { video.currentTime = 0.1; } catch { resolve(undefined); return; }
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160; canvas.height = 90;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(undefined); return; }
        ctx.drawImage(video, 0, 0, 160, 90);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      } catch { resolve(undefined); }
    };
    video.onerror = () => resolve(undefined);
    setTimeout(() => resolve(undefined), 3000); // 3s 超时
  });
}

/** 打开文件选择 + 持久化到 data_dir/wallpapers，返回 Wallpaper 元数据 + destPath */
export async function uploadWallpaperPersistent(): Promise<{ wallpaper: Wallpaper; destPath: string } | null> {
  const selected = await dialogOpen({
    filters: [{ name: "图片/视频", extensions: ["jpg", "jpeg", "png", "webp", "mp4", "webm", "mov"] }],
    multiple: false,
  });
  if (!selected || Array.isArray(selected)) return null;
  const srcPath = selected as string;
  const isVideo = /\.(mp4|webm|mov)$/i.test(srcPath);
  const fileName = srcPath.split(/[\\/]/).pop() || "wallpaper";

  // 调 Rust 命令复制到 data_dir/wallpapers
  const destPath = await invoke<string>("wallpaper_save", { srcPath, name: fileName });
  const url = convertFileSrc(destPath);
  const videoThumb = isVideo ? await extractVideoThumbnail(url) : undefined;

  return {
    destPath,
    wallpaper: {
      id: `user-${Date.now()}`,
      name: fileName.replace(/\.[^.]+$/, ""),
      type: isVideo ? "video" : "image",
      src: url,
      thumbnail: videoThumb || (isVideo ? undefined : url),
      builtin: false,
      addedAt: Date.now(),
    },
  };
}

/** 删除壁纸文件（用户从壁纸库移除持久化壁纸时调用） */
export async function removeWallpaperFile(destPath: string): Promise<void> {
  await invoke("wallpaper_remove", { path: destPath });
}
