import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { usePlayerStore } from "../stores/playerStore";

/**
 * 共享 Bloom 后期处理组件
 *
 * 接管 R3F 默认渲染，注入 EffectComposer + UnrealBloomPass。
 * 节拍 hit 时 bloom strength 脉冲增强（对标 Mineradio）。
 * 由 BeatParticles / CoverParticles 共用，保持视觉一致。
 */
export function BloomLayer() {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);

  useEffect(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      1.1, // strength（每帧动态调整）
      0.6, // radius
      0.1  // threshold
    );
    composer.addPass(bloom);
    composerRef.current = composer;
    bloomRef.current = bloom;
    return () => {
      composer.dispose();
      composerRef.current = null;
      bloomRef.current = null;
    };
  }, [gl, scene, camera]);

  useEffect(() => {
    if (composerRef.current) composerRef.current.setSize(size.width, size.height);
    if (bloomRef.current) bloomRef.current.resolution.set(size.width, size.height);
  }, [size]);

  useFrame(() => {
    const beat = usePlayerStore.getState().beat;
    const { bloomStrength } = usePlayerStore.getState().visualParams;
    if (bloomRef.current) {
      bloomRef.current.strength = bloomStrength + beat.intensity * 1.5;
    }
    composerRef.current?.render();
  }, 1); // priority=1 接管渲染

  return null;
}
