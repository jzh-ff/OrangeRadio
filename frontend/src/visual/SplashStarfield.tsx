import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * SplashStarfield —— 启动页背景星河
 *
 * 对比 StarRiver：去掉 usePlayerStore/beat 依赖（启动阶段无播放），
 * 新增 uAppear uniform（0→1）：粒子从中心向球面位置涌入 + 整体亮度从 0 上升，
 * 这就是「开机通电」的核心动效。冷色调（chill-cyan/blue/mint）。
 *
 * appear 由内部自管：mount 时记录 t0，useFrame 里按 mounted 时长推进 uAppear。
 * 退出时无需单独 fadeOut —— Canvas 随父级 opacity 淡出即可。
 */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uAppear;
  attribute float aSeed;
  attribute float aLane;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 pos = position;
    // 从中心涌入：appear 0→1 时整体半径 0.1→1.0
    pos *= mix(0.12, 1.0, uAppear);
    // lane 缓慢沿 y 流动
    float speed = 0.12 + aLane * 0.22;
    pos.y = mod(pos.y + uTime * speed + 10.0, 20.0) - 10.0;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.6 + aSeed * 2.2) * (200.0 / max(0.1, -mv.z));
    vColor = aColor;
    // 闪烁 + appear 渐入
    float tw = 0.5 + 0.5 * sin(uTime * (1.0 + aLane * 2.0) + aSeed * 6.28);
    vAlpha = (0.3 + tw * 0.55) * uAppear;
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

const COUNT = 320;
const APPEAR_DURATION = 1.4; // 秒，与 Splash B 阶段时长相呼应

// 冷色调色板（与 StarRiver 一致，呼应应用 --chill-* / --mint）
const PALETTE = [
  new THREE.Color("#8fe9ff"), // chill-cyan
  new THREE.Color("#73a7ff"), // chill-blue
  new THREE.Color("#9cffdf"), // chill-mint
  new THREE.Color("#00f5d4"), // mint
];

function StarField() {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const t0Ref = useRef<number>(-1);

  const { positions, seeds, lanes, colors } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    const lanes = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      // 球面分布（半径 8-16，铺满启动页视野）
      const r = 8 + Math.random() * 8;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi) - 4;
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
    () => ({ uTime: { value: 0 }, uAppear: { value: 0 } }),
    []
  );

  useFrame((state) => {
    if (t0Ref.current < 0) t0Ref.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - t0Ref.current;
    const appear = Math.min(1, elapsed / APPEAR_DURATION);
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      matRef.current.uniforms.uAppear.value = appear;
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

export function SplashStarfield() {
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
