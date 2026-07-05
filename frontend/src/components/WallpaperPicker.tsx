import { useState } from "react";
import { useWallpaperStore } from "../stores/wallpaperStore";
import { uploadWallpaperPersistent, removeWallpaperFile } from "../lib/wallpaperUpload";
import { WallpaperEngineGrid } from "./WallpaperEngineGrid";
import { weFileUrl, weKindLabel, type WallpaperEngineEntry } from "../lib/wallpaperEngine";
import { toWebviewUrl } from "../lib/webviewUrl";
import "../styles/wallpaper-picker.css";

/** 壁纸网格选择器（侧边栏壁纸页 + 全屏 VisualConsole 复用） */
export function WallpaperPicker({ compact = false }: { compact?: boolean }) {
  const wallpapers = useWallpaperStore((s) => s.list);
  const activeWallpaperId = useWallpaperStore((s) => s.activeId);
  const setWallpaper = useWallpaperStore((s) => s.setActive);
  const addWallpaper = useWallpaperStore((s) => s.addWallpaper);
  const removeWallpaper = useWallpaperStore((s) => s.removeWallpaper);
  const [showEngine, setShowEngine] = useState(false);
  const engineEntries = useWallpaperStore((s) => s.engineEntries);
  // 精选推荐：前 4 个可应用的 WE 壁纸，点击即生成 wallpaper 写入壁纸库并设为背景
  const featured = engineEntries.filter((e) => e.applicable).slice(0, 4);
  const applyWe = (e: WallpaperEngineEntry) => {
    const raw = weFileUrl(e.source_dir, e.file);
    const previewRel = e.preview ?? (e.kind === "picture" ? e.file : null);
    const id = `we-${e.workshop_id}`;
    addWallpaper({
      id,
      name: e.title,
      type: e.kind === "video" ? "video" : "image",
      src: toWebviewUrl(raw),
      thumbnail: previewRel ? toWebviewUrl(weFileUrl(e.source_dir, previewRel)) : undefined,
      builtin: false,
      addedAt: Date.now(),
    });
    setWallpaper(id);
  };

  const onUploadClick = async () => {
    try {
      const result = await uploadWallpaperPersistent();
      if (result) {
        addWallpaper(result.wallpaper);
        setWallpaper(result.wallpaper.id);
      }
    } catch (e) {
      console.warn("[壁纸] 上传失败:", e);
    }
  };

  const onRemove = async (id: string, destPath?: string) => {
    if (!window.confirm("确定移除这张壁纸？")) return;
    if (destPath) {
      try {
        await removeWallpaperFile(destPath);
      } catch (e) {
        console.warn("[壁纸] 删除文件失败:", e);
      }
    }
    removeWallpaper(id);
  };

  return (
    <div className={`wp-picker ${compact ? "wp-picker--compact" : ""}`}>
      <div className="wp-picker__grid">
        <button
          type="button"
          className={`wp-card ${!activeWallpaperId ? "wp-card--active" : ""}`}
          onClick={() => setWallpaper(null)}
          title="默认银河粒子背景"
        >
          <div className="wp-card__cover wp-card__cover--galaxy" />
          <span className="wp-card__name">银河</span>
        </button>
        {wallpapers.map((w) => (
          <div key={w.id} className="wp-card-wrap">
            <button
              type="button"
              className={`wp-card ${activeWallpaperId === w.id ? "wp-card--active" : ""}`}
              onClick={() => setWallpaper(w.id)}
              title={w.name}
            >
              <div className="wp-card__cover">
                {w.thumbnail ? (
                  <img src={w.thumbnail} alt={w.name} />
                ) : w.type === "video" ? (
                  <div className="wp-card__video">▶</div>
                ) : (
                  <div className="wp-card__cover--galaxy" />
                )}
              </div>
              <span className="wp-card__name">{w.name}</span>
            </button>
            {!w.builtin && (
              <button
                type="button"
                className="wp-card__remove"
                title="移除壁纸"
                onClick={() => void onRemove(w.id, w.destPath)}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="wp-card wp-card--upload"
          onClick={() => void onUploadClick()}
          title="上传壁纸（图片/视频，持久化到本地）"
        >
          <div className="wp-card__cover wp-card__upload">+</div>
          <span className="wp-card__name">上传</span>
        </button>
        <button
          type="button"
          className="wp-card wp-card--upload"
          onClick={() => setShowEngine((v) => !v)}
          title="扫描本地 Wallpaper Engine 壁纸"
        >
          <div className="wp-card__cover wp-card__upload">WE</div>
          <span className="wp-card__name">Wallpaper Engine</span>
        </button>
      </div>
      {featured.length > 0 && (
        <div className="wp-featured">
          <div className="wp-featured__title">精选推荐 · Wallpaper Engine</div>
          <div className="wp-featured__grid">
            {featured.map((e) => {
              const previewRel = e.preview ?? (e.kind === "picture" ? e.file : null);
              const imgSrc = previewRel ? toWebviewUrl(weFileUrl(e.source_dir, previewRel)) : null;
              return (
                <button
                  key={e.workshop_id}
                  type="button"
                  className="wp-card"
                  onClick={() => applyWe(e)}
                  title={`${e.title} (${weKindLabel(e.kind)})`}
                >
                  <div className="wp-card__cover">
                    {imgSrc ? <img src={imgSrc} alt={e.title} /> : <div className="wp-card__cover--galaxy" />}
                  </div>
                  <span className="wp-card__name">{e.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {showEngine && <WallpaperEngineGrid />}
    </div>
  );
}
