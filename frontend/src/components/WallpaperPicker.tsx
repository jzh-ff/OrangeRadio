import { useWallpaperStore } from "../stores/wallpaperStore";
import { uploadWallpaperPersistent, removeWallpaperFile } from "../lib/wallpaperUpload";
import "../styles/wallpaper-picker.css";

/** 壁纸网格选择器（侧边栏壁纸页 + 全屏 VisualConsole 复用） */
export function WallpaperPicker({ compact = false }: { compact?: boolean }) {
  const wallpapers = useWallpaperStore((s) => s.list);
  const activeWallpaperId = useWallpaperStore((s) => s.activeId);
  const setWallpaper = useWallpaperStore((s) => s.setActive);
  const addWallpaper = useWallpaperStore((s) => s.addWallpaper);
  const removeWallpaper = useWallpaperStore((s) => s.removeWallpaper);

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
      </div>
    </div>
  );
}
