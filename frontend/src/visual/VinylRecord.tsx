/**
 * 黑胶唱片视觉（VisualConsole preset 3）
 *
 * 一张缓慢旋转的黑胶唱片，中心贴当前专辑封面。
 * 轻量、纯 CSS + img，不需要 Three.js。
 */
import { usePlayerStore } from "../stores/playerStore";
import { getCoverUrl } from "../features/player/useCover";

export function VinylRecord() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const cover = getCoverUrl(currentTrack);
  const title = (currentTrack as { meta?: { title?: string } })?.meta?.title || "OrangeRadio";

  return (
    <div className="vinyl-stage">
      <div className={`vinyl-disc ${isPlaying ? "vinyl-disc--spin" : ""}`}>
        <div className="vinyl-grooves">
          <div className="vinyl-groove"></div>
          <div className="vinyl-groove"></div>
          <div className="vinyl-groove"></div>
          <div className="vinyl-groove"></div>
        </div>
        <div className="vinyl-label">
          {cover ? (
            <img src={cover} alt={title} />
          ) : (
            <div className="vinyl-label__fallback">♪</div>
          )}
          <div className="vinyl-hole"></div>
        </div>
      </div>
      <div className="vinyl-arm">
        <div className="vinyl-arm__base"></div>
        <div className="vinyl-arm__stick"></div>
      </div>
    </div>
  );
}
