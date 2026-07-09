import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { usePlayerStore } from "../stores/playerStore";
import { readBeat } from "../stores/spectrumBus";

/**
 * 共享 Bloom 后期处理组件（仅 BeatParticles preset 用）
 *
 * cinema 模式的 CoverParticles 已经自带"双层粒子 + bloomKeep"局部辉光，不再需要全屏 bloom。
 * 本组件现在只为 BeatParticles（球面散点预设）提供全屏 bloom 兜底。
 *
 * bloomScale prop：粒子层 bloom 强度系数（默认 0.5，对比之前的 1.1 拉低一半），
 *   配合 store.visualParams.bloomStrength 由用户调。BeatParticles 场景下不再"糊一切"。
 */
export function BloomLayer({ bloomScale = 0.35 }: { bloomScale?: number }) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);

  useEffect(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      1.1 * bloomScale, // strength 基线（每帧动态调整）
      0.5,              // radius（0.6 → 0.5，更收敛）
      0.18              // threshold（0.1 → 0.18，只让真正高亮的像素 bloom）
    );
    composer.addPass(bloom);
    composerRef.current = composer;
    bloomRef.current = bloom;
    return () => {
      composer.dispose();
      composerRef.current = null;
      bloomRef.current = null;
    };
  }, [gl, scene, camera, bloomScale]);

  useEffect(() => {
    if (composerRef.current) composerRef.current.setSize(size.width, size.height);
    if (bloomRef.current) bloomRef.current.resolution.set(size.width, size.height);
  }, [size]);

  useFrame(() => {
    const beat = readBeat();
    const { bloomStrength } = usePlayerStore.getState().visualParams;
    if (bloomRef.current) {
      // 节拍 hit 时 bloom 脉冲（强度按 bloomScale 收敛）
      bloomRef.current.strength =
        bloomStrength * bloomScale + beat.intensity * 0.35 * bloomScale;
    }
    composerRef.current?.render();
  }, 1); // priority=1 接管渲染

  return null;
}
