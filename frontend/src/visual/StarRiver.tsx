import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { readBeat } from "../stores/spectrumBus";

/**
 * StarRiver 歌词背景星河（对标 MineRadio stageLyrics.starRiver，index.html 7330-7411）
 *
 * Three.js Points 420 点 + lane 流动 shader，冷色调（chill-cyan/blue/mint）。
 * 用于 FullPlayer cinema 模式歌词背景层（在 CoverParticles/BeatParticles 之上叠一层星河）。
 * 节拍命中时星河整体亮度脉冲。
 */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBeat;
  attribute float aSeed;
  attribute float aLane;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 pos = position;
    // lane 流动：每粒子沿 y 方向缓慢流动，lane 决定速度
    float speed = 0.15 + aLane * 0.25;
    pos.y = mod(pos.y + uTime * speed + 10.0, 20.0) - 10.0;
    // 节拍时横向轻微扩散
    pos.x += sin(uTime * 0.8 + aSeed * 6.28) * uBeat * 0.3;
    pos.z += cos(uTime * 0.6 + aSeed * 6.28) * uBeat * 0.2;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.5 + aSeed * 2.0 + uBeat * 1.5) * (200.0 / max(0.1, -mv.z));
    vColor = aColor;
    // 闪烁：sin^2 + 节拍脉冲
    float tw = 0.5 + 0.5 * sin(uTime * (1.0 + aLane * 2.0) + aSeed * 6.28);
    vAlpha = (0.3 + tw * 0.5 + uBeat * 0.2);
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
    gl_FragColor = vec4(vColor * (1.0 + glow * 0.5), glow * vAlpha);
  }
`;

const COUNT = 420;
// 冷色调色板（对标 MineRadio wallpaper.html 冷色 + OrangeRadio --chill-*）
const PALETTE = [
  new THREE.Color("#8fe9ff"), // chill-cyan
  new THREE.Color("#73a7ff"), // chill-blue
  new THREE.Color("#9cffdf"), // chill-mint
  new THREE.Color("#00f5d4"), // mint
];

function StarField() {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, seeds, lanes, colors } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    const lanes = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      // 球面分布（半径 8-16，覆盖歌词背景空间）
      const r = 8 + Math.random() * 8;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi) - 4; // 整体后移，给歌词让位
      seeds[i] = Math.random();
      lanes[i] = Math.random();
      const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { positions, seeds, lanes, colors };
  }, []);

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uBeat: { value: 0 } }),
    []
  );

  useFrame((state) => {
    const beat = readBeat();
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      matRef.current.uniforms.uBeat.value = beat.intensity;
    }
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.02;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={COUNT} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aSeed" count={COUNT} array={seeds} itemSize={1} />
        <bufferAttribute attach="attributes-aLane" count={COUNT} array={lanes} itemSize={1} />
        <bufferAttribute attach="attributes-aColor" count={COUNT} array={colors} itemSize={3} />
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

export function StarRiver() {
  return (
    <Canvas
      camera={{ position: [0, 0, 14], fov: 60 }}
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 1.6]}
    >
      <StarField />
    </Canvas>
  );
}
