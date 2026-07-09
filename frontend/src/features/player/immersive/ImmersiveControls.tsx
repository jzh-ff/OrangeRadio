import { usePlayerStore } from "../../../stores/playerStore";
import { useWallpaperStore } from "../../../stores/wallpaperStore";

/** 沉浸模式悬浮控制面板（背景源 + 歌词样式） */
export function ImmersiveControls() {
  const vp = usePlayerStore((s) => s.visualParams);
  const setVisualParams = usePlayerStore((s) => s.setVisualParams);
  const wallpapers = useWallpaperStore((s) => s.list);
  const activeWallpaperId = useWallpaperStore((s) => s.activeId);
  const setWallpaper = useWallpaperStore((s) => s.setActive);

  const bgOptions: { id: typeof vp.immersiveBg; label: string; icon: string }[] = [
    { id: "cover-particles", label: "专辑粒子", icon: "✦" },
    { id: "cover", label: "专辑封面", icon: "◉" },
    { id: "wallpaper", label: "我的壁纸", icon: "▣" },
    { id: "particles", label: "动态粒子", icon: "✧" },
    { id: "solid", label: "纯色", icon: "■" },
  ];

  const sizeOptions: { id: typeof vp.immersiveLyricSize; label: string }[] = [
    { id: "sm", label: "小" },
    { id: "md", label: "中" },
    { id: "lg", label: "大" },
    { id: "xl", label: "超大" },
  ];

  return (
    <div className="immersive__controls">
      <div className="immersive__controls-section">
        <div className="immersive__controls-title">背景</div>
        <div className="immersive__bg-grid">
          {bgOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`immersive__bg-btn ${vp.immersiveBg === o.id ? "immersive__bg-btn--active" : ""}`}
              onClick={() => setVisualParams({ immersiveBg: o.id })}
              title={o.label}
            >
              <span className="immersive__bg-btn__icon">{o.icon}</span>
              <span className="immersive__bg-btn__label">{o.label}</span>
            </button>
          ))}
        </div>

        {vp.immersiveBg === "wallpaper" && (
          <div className="immersive__wallpaper-list">
            <button
              type="button"
              className={`immersive__wp-thumb ${!activeWallpaperId ? "immersive__wp-thumb--active" : ""}`}
              onClick={() => setWallpaper(null)}
              title="默认银河粒子"
            >
              <div className="immersive__wp-thumb__galaxy">银河</div>
            </button>
            {wallpapers.slice(0, 6).map((w) => (
              <button
                key={w.id}
                type="button"
                className={`immersive__wp-thumb ${activeWallpaperId === w.id ? "immersive__wp-thumb--active" : ""}`}
                onClick={() => setWallpaper(w.id)}
                title={w.name}
              >
                {w.thumbnail ? (
                  <img src={w.thumbnail} alt={w.name} />
                ) : w.type === "video" ? (
                  <div className="immersive__wp-thumb__video">▶</div>
                ) : (
                  <div className="immersive__wp-thumb__galaxy" />
                )}
              </button>
            ))}
          </div>
        )}

        {vp.immersiveBg === "solid" && (
          <div className="immersive__solid-row">
            <input
              type="color"
              value={vp.immersiveSolidColor}
              onChange={(e) => setVisualParams({ immersiveSolidColor: e.target.value })}
              className="immersive__color-input"
            />
            <span className="immersive__color-value">{vp.immersiveSolidColor}</span>
          </div>
        )}

        {vp.immersiveBg === "cover" && (
          <label className="immersive__toggle-row">
            <input
              type="checkbox"
              checked={vp.immersiveCoverBlur}
              onChange={(e) => setVisualParams({ immersiveCoverBlur: e.target.checked })}
            />
            <span>模糊封面</span>
          </label>
        )}
      </div>

      <div className="immersive__controls-section">
        <div className="immersive__controls-title">歌词</div>
        <div className="immersive__lyric-row">
          <span className="immersive__lyric-label">字号</span>
          <div className="immersive__size-btns">
            {sizeOptions.map((o) => (
              <button
                key={o.id}
                type="button"
                className={vp.immersiveLyricSize === o.id ? "active" : ""}
                onClick={() => setVisualParams({ immersiveLyricSize: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="immersive__lyric-row">
          <span className="immersive__lyric-label">对齐</span>
          <div className="immersive__align-btns">
            <button
              type="button"
              className={vp.immersiveLyricAlign === "center" ? "active" : ""}
              onClick={() => setVisualParams({ immersiveLyricAlign: "center" })}
            >
              居中
            </button>
            <button
              type="button"
              className={vp.immersiveLyricAlign === "left" ? "active" : ""}
              onClick={() => setVisualParams({ immersiveLyricAlign: "left" })}
            >
              左对齐
            </button>
          </div>
        </div>
        <label className="immersive__toggle-row">
          <input
            type="checkbox"
            checked={vp.immersiveShowTranslation}
            onChange={(e) => setVisualParams({ immersiveShowTranslation: e.target.checked })}
          />
          <span>显示翻译</span>
        </label>
      </div>
    </div>
  );
}
