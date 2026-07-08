/**
 * 视觉控制台预设舞台
 *
 * 将 VisualConsole 的 preset 索引映射到真实视觉组件：
 *   0: CoverParticles（默认封面粒子方阵）
 *   1: BeatParticles（球面漂浮粒子 + BeatCam）
 *   2: StarRiver（冷色星河）
 *   3: VinylRecord（黑胶唱片 + 封面）
 */
import { CoverParticles } from "./CoverParticles";
import { BeatParticles } from "./BeatParticles";
import { StarRiver } from "./StarRiver";
import { VinylRecord } from "./VinylRecord";
import { usePlayerStore } from "../stores/playerStore";

export function PresetStage() {
  const preset = usePlayerStore((s) => s.visualParams.preset);

  switch (preset) {
    case 1:
      return <BeatParticles />;
    case 2:
      return <StarRiver />;
    case 3:
      return <VinylRecord />;
    case 0:
    default:
      return <CoverParticles />;
  }
}
