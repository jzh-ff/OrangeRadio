import { useWallpaperStore } from "../../stores/wallpaperStore";
import { usePlayerStore } from "../../stores/playerStore";
import { WallpaperPicker } from "../../components/WallpaperPicker";
import "../../styles/wallpaper.css";

/** 侧边栏「壁纸」主内容页：选择/上传壁纸 + 显示参数调节 */
export function WallpaperView() {
  const activeId = useWallpaperStore((s) => s.activeId);
  const list = useWallpaperStore((s) => s.list);
  const visualParams = usePlayerStore((s) => s.visualParams);
  const setVisualParams = usePlayerStore((s) => s.setVisualParams);

  const active = activeId ? list.find((w) => w.id === activeId) : null;
  const activeLabel = active ? active.name : "银河粒子";

  return (
    <div className="wallpaper-view">
      <header className="wallpaper-view__hero glass-panel">
        <div className="wallpaper-view__copy">
          <span className="wallpaper-view__kicker">BACKGROUND</span>
          <h1 className="wallpaper-view__title">壁纸与背景</h1>
          <p className="wallpaper-view__desc">
            选择静态/动态壁纸作为应用全局背景，支持 Wallpaper Engine 导出的图片与视频。
            当前：<strong>{activeLabel}</strong>
          </p>
        </div>
        <div className="wallpaper-view__preview" aria-hidden="true">
          {active?.thumbnail ? (
            <img src={active.thumbnail} alt="" />
          ) : active?.type === "image" && active.src ? (
            <img src={active.src} alt="" />
          ) : (
            <div className="wallpaper-view__preview-fallback" />
          )}
        </div>
      </header>

      <section className="wallpaper-view__section glass-panel">
        <h2 className="wallpaper-view__section-title">我的壁纸库</h2>
        <p className="wallpaper-view__hint">点击切换背景；「+」上传本地图片或 MP4/WebM 视频</p>
        <WallpaperPicker />
      </section>

      {activeId && (
        <section className="wallpaper-view__section glass-panel">
          <h2 className="wallpaper-view__section-title">显示参数</h2>
          <div className="wallpaper-view__sliders">
            <SliderRow
              label="透明度"
              value={visualParams.wallpaperOpacity}
              min={0.1}
              max={1}
              step={0.05}
              onChange={(v) => setVisualParams({ wallpaperOpacity: v })}
            />
            <SliderRow
              label="模糊"
              value={visualParams.wallpaperBlur}
              min={0}
              max={24}
              step={1}
              fmt={(v) => `${v}px`}
              onChange={(v) => setVisualParams({ wallpaperBlur: v })}
            />
            <SliderRow
              label="缩放"
              value={visualParams.wallpaperScale}
              min={1}
              max={1.3}
              step={0.01}
              onChange={(v) => setVisualParams({ wallpaperScale: v })}
            />
            <SliderRow
              label="暗角"
              value={visualParams.wallpaperDim}
              min={0}
              max={0.8}
              step={0.05}
              onChange={(v) => setVisualParams({ wallpaperDim: v })}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <label className="wallpaper-slider">
      <span className="wallpaper-slider__label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="wallpaper-slider__input"
      />
      <span className="wallpaper-slider__value">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </label>
  );
}
