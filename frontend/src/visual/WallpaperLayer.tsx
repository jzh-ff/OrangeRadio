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
  const vp = usePlayerStore((s) => s.visualParams);
  // wallpaper 参数（从 visualParams 读取，P12 扩展字段；若未定义用默认）
  const opacity = vp.wallpaperOpacity;
  const blur = vp.wallpaperBlur;
  const scale = vp.wallpaperScale;
  const dim = vp.wallpaperDim;

  if (!active) return null;

  const style: React.CSSProperties = {
    opacity,
    transform: `scale(${scale})`,
    filter: `blur(${blur}px)`,
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
      <div className="wallpaper-layer-dim" style={{ opacity: dim }} />
    </div>
  );
}
