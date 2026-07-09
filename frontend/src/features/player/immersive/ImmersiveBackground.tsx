/**
 * 沉浸模式背景层
 *
 * 根据 visualParams.immersiveBg 渲染背景之一：
 * - cover-particles: 封面粒子（MineRadio emily 效果）
 * - cover: 当前曲目封面静态图
 * - wallpaper: 复用 wallpaperStore 的激活壁纸
 * - particles: BeatParticles 节奏粒子
 * - solid: 纯色背景
 */
import { useEffect, useState } from "react";
import { CoverParticles } from "../../../visual/CoverParticles";
import { BeatParticles } from "../../../visual/BeatParticles";
import { useWallpaperStore } from "../../../stores/wallpaperStore";
import { usePlayerStore } from "../../../stores/playerStore";
import { getCoverUrl, proxyCoverUrl } from "../useCover";

export function ImmersiveBackground() {
  const vp = usePlayerStore((s) => s.visualParams);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const activeWallpaper = useWallpaperStore((s) => s.list.find((w) => w.id === s.activeId) || null);

  // 网络封面走 Rust cover_proxy 拿本地 asset URL（避免 Tauri WebView 拦截远端域）
  const [coverSrc, setCoverSrc] = useState<string | null>(() => getCoverUrl(currentTrack));
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先用同步的直链（local 路径立即可用），同时异步升级为 proxy
      const direct = getCoverUrl(currentTrack);
      if (direct) {
        setCoverSrc(direct);
      }
      const proxied = await proxyCoverUrl(currentTrack);
      if (cancelled) return;
      setCoverSrc(proxied ?? direct ?? null);
    })();
    return () => { cancelled = true; };
  }, [currentTrack]);

  switch (vp.immersiveBg) {
    case "cover-particles":
      return (
        <div className="immersive__bg immersive__bg--cover-particles">
          <CoverParticles />
          <div className="immersive__bg-dim immersive__bg-dim--particles" />
        </div>
      );
    case "wallpaper": {
      if (!activeWallpaper) {
        return (
          <div className="immersive__bg immersive__bg--solid" style={{ background: "#050608" }}>
            <div className="immersive__bg-hint">未选择壁纸，请在「背景 → 我的壁纸」中选择</div>
          </div>
        );
      }
      return (
        <div className="immersive__bg immersive__bg--wallpaper">
          {activeWallpaper.type === "image" ? (
            <img src={activeWallpaper.src} alt="" className="immersive__bg-media" />
          ) : (
            <video src={activeWallpaper.src} autoPlay loop muted playsInline className="immersive__bg-media" />
          )}
          <div className="immersive__bg-dim" />
        </div>
      );
    }
    case "particles":
      return (
        <div className="immersive__bg immersive__bg--particles">
          <BeatParticles />
          <div className="immersive__bg-dim immersive__bg-dim--particles" />
        </div>
      );
    case "solid":
      return (
        <div
          className="immersive__bg immersive__bg--solid"
          style={{ background: vp.immersiveSolidColor }}
        />
      );
    case "cover":
    default:
      return (
        <div className="immersive__bg immersive__bg--cover">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt=""
              className={`immersive__bg-media ${vp.immersiveCoverBlur ? "immersive__bg-media--blur" : ""}`}
            />
          ) : (
            <div className="immersive__bg-fallback" />
          )}
          <div className="immersive__bg-dim" />
        </div>
      );
  }
}
