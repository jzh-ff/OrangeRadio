/**
 * 组合能力表：定义每个「排版×预设」组合实际渲染的视觉技术，
 * 以及视觉控制台在该组合下应暴露哪些粒子/动态控件。
 *
 * 设计要点：profile 由「实际渲染的组件」决定，而非 preset 编号。
 * 例如 rhythmic-album 布局硬编码渲染 CoverParticles（不读 preset），
 * 所以即使在律动专辑下把 preset 切到 3（黑胶），profile 仍是 cover。
 */
import type { FullLayout } from "../stores/playerStore";
import type { ParticleParams } from "../stores/playerStore";

/** 粒子/动态控件的能力档位 */
export type ParticleProfile = "full" | "cover" | "beat" | "minimal" | "none";

/**
 * 各 profile 允许显示的粒子参数键。
 * - full/cover：CoverParticles 着色器全功能（封面方阵）
 * - beat：BeatParticles 球面漂浮粒子（无 cover 专属扭曲/分辨率）
 * - minimal：StarRiver 星河（仅通用旋钮）
 * - none：VinylRecord 黑胶 / DOM 排版（无粒子控件）
 */
export const PROFILE_KEYS: Record<ParticleProfile, ReadonlyArray<keyof ParticleParams>> = {
  full: [
    "intensity", "depth", "coverResolution", "cinemaShake", "cinema",
    "bloom", "edge", "cameraShake", "particleCount", "pointSize",
    "speed", "twist", "colorTension", "scatter", "bloomStrength",
  ],
  cover: [
    "intensity", "depth", "coverResolution", "cinemaShake", "cinema",
    "bloom", "edge", "cameraShake", "particleCount", "pointSize",
    "speed", "twist", "colorTension", "scatter", "bloomStrength",
  ],
  beat: [
    "intensity", "depth", "cinemaShake", "cinema",
    "bloom", "edge", "cameraShake", "particleCount", "pointSize",
    "speed", "bloomStrength",
  ],
  minimal: ["intensity", "speed", "bloom", "bloomStrength", "depth"],
  none: [],
};

/**
 * 判定组合的能力档位。
 *
 * 渲染映射（见 FullPlayer.tsx / PresetStage.tsx）：
 *   rhythmic-album     → CoverParticles（硬编码，不读 preset）
 *   rhythmic-particles → PresetStage 按 preset 分发
 *     0: CoverParticles / 1: BeatParticles / 2: StarRiver / 3: VinylRecord
 *   immersive/lyric-stream/triple → DOM 排版（无粒子）
 */
export function comboProfile(layout: FullLayout, preset: number): ParticleProfile {
  switch (layout) {
    case "rhythmic-album":
      // 该布局硬编码 CoverParticles，preset 不生效 → 始终 cover
      return "cover";
    case "rhythmic-particles":
      switch (preset) {
        case 0: return "cover";
        case 1: return "beat";
        case 2: return "minimal";
        case 3: return "none";
        default: return "cover";
      }
    case "immersive":
    case "lyric-stream":
    case "triple":
    default:
      return "none";
  }
}

/** 当前组合是否显示粒子类控件（动态 + 高级 tab） */
export function hasParticleControls(layout: FullLayout, preset: number): boolean {
  return comboProfile(layout, preset) !== "none";
}

/** 指定键在当前 profile 下是否允许显示 */
export function isKeyVisible(
  layout: FullLayout,
  preset: number,
  key: keyof ParticleParams,
): boolean {
  return PROFILE_KEYS[comboProfile(layout, preset)].includes(key);
}
