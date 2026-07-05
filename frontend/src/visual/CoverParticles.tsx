import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { usePlayerStore } from "../stores/playerStore";
import { getCoverUrl } from "../features/player/useCover";
import { BeatParticles } from "./BeatParticles";
import { BloomLayer } from "./BloomLayer";

/**
 * 封面像素化粒子背景（对标 Mineradio 的 buildCoverParticleGeometry）
 *
 * 把当前播放的专辑封面像素化成粒子（每个像素 = 一个粒子，颜色取自像素），
 * 节拍命中时粒子向外浮动爆发。切歌时重新采样。
 *
 * 加固点：
 *   - 网络封面 CORS 污染 / 无封面 / 采样失败 → 回退 BeatParticles，避免背景空白
 *   - Bloom 后期（与 BeatParticles 视觉一致）
 *   - 采样分辨率跟随 visualParams.particleCount（粒子密度可调）
 */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBeat;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  attribute vec3 aColor;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;

  // 简化 simplex noise（sin hash，避免引入 glsl-noise 包）
  float snoise(vec3 p) {
    return sin(p.x * 1.3 + p.y * 2.1 + p.z * 1.7) * 0.5
         + sin(p.x * 2.7 - p.z * 1.9) * 0.3
         + sin(p.y * 3.1 + p.x * 0.8) * 0.2;
  }

  void main() {
    vec3 pos = position;
    // 节拍爆发：每粒子向随机方向浮动
    float burst = uBeat * 0.9;
    pos.x += sin(uTime * 1.2 + aSeed * 6.2831) * burst * 0.4;
    pos.y += cos(uTime * 1.0 + aSeed * 6.2831) * burst * 0.4;
    // 频谱驱动 z 位移（对标 MineRadio buildCoverParticleGeometry：bassBreath + midDisp + trebleJ）
    float bassBreath = snoise(vec3(aSeed * 3.0, uTime * 0.7, 0.0)) * uBass * 0.42;
    float midDisp = snoise(vec3(aSeed * 5.0, uTime * 1.3, 1.0)) * uMid * 0.55;
    float trebleJ = snoise(vec3(aSeed * 7.0, uTime * 3.0, 2.0)) * uTreble * 0.18;
    pos.z += bassBreath + midDisp + trebleJ + sin(uTime * 0.8 + aSeed * 3.14) * burst * 0.5;
    // 慢速漂浮
    pos.x += sin(uTime * 0.5 + aSeed * 6.2831) * 0.12;
    pos.y += cos(uTime * 0.4 + aSeed * 6.2831) * 0.12;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (2.2 + uBeat * 3.5) * (300.0 / max(0.1, -mv.z));
    vColor = aColor;
    vAlpha = 0.65 + uBeat * 0.35;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * (1.0 + glow * 0.4), glow * vAlpha);
  }
`;

interface CloudProps {
  positions: Float32Array;
  colors: Float32Array;
}

function CoverCloud({ positions, colors }: CloudProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const count = positions.length / 3;

  const seeds = useMemo(() => {
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) s[i] = Math.random();
    return s;
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
    }),
    []
  );

  useFrame((state) => {
    const beat = usePlayerStore.getState().beat;
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      matRef.current.uniforms.uBeat.value = beat.intensity;
      // 频谱驱动 z 位移（对标 MineRadio syncFxUniforms：uBass/uMid/uTreble）
      matRef.current.uniforms.uBass.value = beat.bass;
      matRef.current.uniforms.uMid.value = beat.mid;
      matRef.current.uniforms.uTreble.value = beat.treble;
    }
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.05;
      pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.08) * 0.06;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aColor" count={count} array={colors} itemSize={3} />
        <bufferAttribute attach="attributes-aSeed" count={count} array={seeds} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** 把封面图片像素化采样为粒子坐标 + 颜色 */
async function sampleCover(
  url: string,
  resolution = 80
): Promise<CloudProps | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = resolution;
        canvas.height = resolution;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, resolution, resolution);
        const data = ctx.getImageData(0, 0, resolution, resolution).data;
        const n = resolution * resolution;
        const positions = new Float32Array(n * 3);
        const colors = new Float32Array(n * 3);
        const spread = 8;
        for (let y = 0; y < resolution; y++) {
          for (let x = 0; x < resolution; x++) {
            const i = y * resolution + x;
            positions[i * 3] = (x / resolution - 0.5) * spread;
            positions[i * 3 + 1] = -(y / resolution - 0.5) * spread; // y 翻转保持正向
            positions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
            colors[i * 3] = data[i * 4] / 255;
            colors[i * 3 + 1] = data[i * 4 + 1] / 255;
            colors[i * 3 + 2] = data[i * 4 + 2] / 255;
          }
        }
        resolve({ positions, colors });
      } catch {
        resolve(null); // CORS 污染等
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 读取封面 URL（复用 useCover，支持 url + local） */

export function CoverParticles() {
  const currentTrack = usePlayerStore((s) => s.currentTrack) as any;
  const particleCount = usePlayerStore((s) => s.visualParams.particleCount);
  const [cloud, setCloud] = useState<CloudProps | null>(null);
  const [failed, setFailed] = useState(false);
  const cover = getCoverUrl(currentTrack);
  // 采样分辨率跟随粒子数：sqrt 取整，clamp 40~120（4k~14k 粒子覆盖常用区间）
  const resolution = Math.max(40, Math.min(120, Math.round(Math.sqrt(particleCount))));

  useEffect(() => {
    setFailed(false);
    if (!cover) {
      setCloud(null);
      setFailed(true);
      return;
    }
    let cancelled = false;
    void sampleCover(cover, resolution).then((c) => {
      if (cancelled) return;
      if (c) {
        setCloud(c);
        setFailed(false);
      } else {
        // CORS 污染 / 解码失败 → 标记失败，外层回退 BeatParticles
        setCloud(null);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cover, resolution]);

  // 无封面或采样失败 → 回退节拍粒子，避免 cinema 模式背景空白
  if (failed || !cloud) {
    return <BeatParticles />;
  }

  return (
    <Canvas camera={{ position: [0, 0, 12], fov: 60 }} gl={{ alpha: true, antialias: true }}>
      <CoverCloud positions={cloud.positions} colors={cloud.colors} />
      <BloomLayer />
    </Canvas>
  );
}
