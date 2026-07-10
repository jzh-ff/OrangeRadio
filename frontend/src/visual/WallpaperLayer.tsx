import { useShallow } from "zustand/react/shallow";
import { useWallpaperStore } from "../stores/wallpaperStore";
import { usePlayerStore } from "../stores/playerStore";

/**
 * 壁纸渲染层（对标 MineRadio #custom-bg + #custom-bg-video）
 *
 * z-index 0，在 WallpaperBackground 银河（z-index 1）之下。
 * 图片用 <img>，视频用 <video loop muted autoplay>。
 * 无激活壁纸时返回 null，自动显示 WallpaperBackground 银河。
 * 参数（wallpaperOpacity/Blur/Scale/Dim）从 visualParams 读取。
 */
export function WallpaperLayer() {
  const active = useWallpaperStore((s) => s.list.find((w) => w.id === s.activeId) || null);
  // useShallow：对象 selector 每次返回新对象字面量，需浅比较避免 store 任意变化都重渲染
  const { wallpaperOpacity, wallpaperBlur, wallpaperScale, wallpaperDim } = usePlayerStore(
    useShallow((s) => ({
      wallpaperOpacity: s.visualParams.wallpaperOpacity,
      wallpaperBlur: s.visualParams.wallpaperBlur,
      wallpaperScale: s.visualParams.wallpaperScale,
      wallpaperDim: s.visualParams.wallpaperDim,
    }))
  );

  if (!active) return null;

  const style: React.CSSProperties = {
    opacity: wallpaperOpacity,
    transform: `scale(${wallpaperScale})`,
    filter: `blur(${wallpaperBlur}px)`,
  };

  return (
    <div className="wallpaper-layer-wrap">
      {active.type === "image" ? (
        <img className="wallpaper-layer-media" src={active.src} style={style} alt="" />
      ) : (
        <video
          className="wallpaper-layer-media"
          src={active.src}
          autoPlay
          loop
          muted
          playsInline
          style={style}
        />
      )}
      {/* 暗角遮罩（让前景内容可读） */}
      <div className="wallpaper-layer-dim" style={{ opacity: wallpaperDim }} />
    </div>
  );
}
