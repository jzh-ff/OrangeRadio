import { useRef, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePlayerStore, type ColorTheme } from "../stores/playerStore";
import { readBeat } from "../stores/spectrumBus";
import { BloomLayer } from "./BloomLayer";

/** DIY 运镜：用户拖拽/滚轮/双击控制（对标 MineRadio orbit + freeCamera）
 *  用模块级 ref 在 Canvas DOM 事件和 CinematicCamera 之间共享 user 偏移。 */
const orbit = {
  userTheta: 0,    // 用户拖拽方位角偏移
  userPhi: 0,      // 用户拖拽俯仰角偏移
  userRadius: 0,   // 用户滚轮缩放偏移
  dragging: false,
  lastX: 0,
  lastY: 0,
};

/**
 * Mineradio 风格的节奏粒子可视化
 *
 * 核心技术（对标 Mineradio public/index.html 的粒子系统）：
 *   - THREE.Points + BufferGeometry + 自定义 GLSL ShaderMaterial
 *   - EffectComposer + UnrealBloomPass（节拍 hit 时 strength 脉冲）
 *   - uniform uBass（低频）驱动粒子膨胀；uTreble（高频）驱动闪烁；uBeat（节拍）驱动爆发
 *   - 程序化电影镜头：缓慢轨道 + 节拍推拉 + 可选晃动
 *
 * 数据源：spectrumBus readBeat()（由 useBeatDetector / useAudioEngine 每帧更新）
 */

/** 颜色主题调色板：每个主题 3 档（暗→中→亮），用于按 mid 能量插值 */
const THEME_PALETTES: Record<ColorTheme, [number, number, number]> = {
  orange: [0xff3d00, 0xff6b1a, 0xffaa44], // 橙焰
  purple: [0x6a1b9a, 0xab47bc, 0xe040fb], // 电紫
  ocean: [0x006064, 0x00bcd4, 0x4dd0e1],  // 深海
  aurora: [0x00c853, 0x64dd17, 0xb9f6ca], // 极光
  auto: [0xff6b1a, 0xff9d45, 0xffc685],   // 封面主色（运行时由 dominantColor 推导覆盖）
};

function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

function lerpColor(a: number, b: number, t: number): [number, number, number] {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
}

// ===== auto 主题：从封面主色推导 3 档调色板 =====
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

function rgbToHexNum(r: number, g: number, b: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

/** 从封面主色 [r,g,b] 0~255 推导 3 档调色板（暗/中/亮），用于 auto 主题 */
function paletteFromDominant(color: [number, number, number]): [number, number, number] {
  const [r, g, b] = [color[0] / 255, color[1] / 255, color[2] / 255];
  const [h, s, l] = rgbToHsl(r, g, b);
  const dark = hslToRgb(h, Math.min(1, s * 1.2), Math.max(0.15, l * 0.4));
  const mid = hslToRgb(h, s, l);
  const bright = hslToRgb(h, s, Math.min(1, l * 1.3));
  return [rgbToHexNum(dark[0], dark[1], dark[2]), rgbToHexNum(mid[0], mid[1], mid[2]), rgbToHexNum(bright[0], bright[1], bright[2])];
}

// ===== GLSL 着色器 =====
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uBeat;
  uniform float uPointSize;
  uniform float uSpeed;
  attribute float aSize;
  attribute float aSeed;
  attribute vec3 aVelocity;
  varying float vAlpha;
  varying float vGlow;

  void main() {
    vec3 pos = position;
    float t = uTime * uSpeed;
    // 节拍爆发：粒子沿初始速度方向向外推
    float burst = uBeat * 4.0;
    pos += aVelocity * burst;
    // 时间漂浮扰动（每粒子不同相位）
    float n = sin(t * 0.6 + aSeed * 6.2831) * 0.4;
    float n2 = cos(t * 0.5 + aSeed * 6.2831) * 0.4;
    pos.x += n;
    pos.y += n2;
    pos.z += sin(t * 0.3 + aSeed * 3.14) * 0.3;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // 低频放大粒子 + 节拍脉冲 + 中频膨胀（对标 MineRadio uMid 驱动）+ uPointSize 倍率
    // 系数收敛，避免 additive 累积成白屏
    float sizeMul = (1.0 + uBass * 1.8 + uBeat * 1.4 + uMid * 1.0) * uPointSize;
    gl_PointSize = aSize * sizeMul * (320.0 / max(0.1, -mvPosition.z));
    // 高频驱动透明度闪烁
    vAlpha = clamp(0.35 + uTreble * 0.65 + uBeat * 0.3, 0.0, 1.0);
    vGlow = 0.45 + uBass * 0.3 + uBeat * 0.35;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vGlow;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    // 软边发光：中心亮、边缘平滑衰减
    float glow = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.18, 0.0, d);
    vec3 col = uColor * vGlow + vec3(core * 0.25);
    gl_FragColor = vec4(col, glow * vAlpha);
  }
`;

/** 粒子云主体（ShaderMaterial + AdditiveBlending） */
function ParticleCloud() {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const count = usePlayerStore((s) => s.visualParams.particleCount);

  // 粒子几何属性（球面分布 + 随机速度/大小/种子）
  const { positions, sizes, seeds, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // 球面分布（内层密、外层疏）
      const r = 5 + Math.pow(Math.random(), 0.5) * 14;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      // 速度方向 = 从球心向外（用于节拍爆发）
      velocities[i * 3] = positions[i * 3] / r;
      velocities[i * 3 + 1] = positions[i * 3 + 1] / r;
      velocities[i * 3 + 2] = positions[i * 3 + 2] / r;
      sizes[i] = 0.5 + Math.random() * 1.5;
      seeds[i] = Math.random();
    }
    return { positions, sizes, seeds, velocities };
  }, [count]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uBeat: { value: 0 },
    uPointSize: { value: 1 },
    uSpeed: { value: 1 },
    uColor: { value: new THREE.Color(0xff6b1a) },
  }), []);

  // 当前主题颜色缓存（避免每帧 new Color）
  const colorRef = useRef(new THREE.Color(0xff6b1a));

  useFrame((state) => {
    const beat = readBeat();
    const { colorTheme } = usePlayerStore.getState().visualParams;

    if (matRef.current) {
      const u = matRef.current.uniforms;
      u.uTime.value = state.clock.elapsedTime;
      u.uBass.value = beat.bass;
      u.uMid.value = beat.mid;
      u.uTreble.value = beat.treble;
      // P11 fx 参数注入（对标 MineRadio syncFxUniforms）
      u.uPointSize.value = usePlayerStore.getState().visualParams.pointSize;
      u.uSpeed.value = usePlayerStore.getState().visualParams.speed;
      u.uBeat.value = beat.intensity;
      // 颜色：按 mid 能量在主题 3 档间插值
      // auto 主题：从封面主色推导 3 档调色板；dominantColor 为 null 时退回橙色默认
      const st = usePlayerStore.getState();
      const palette = colorTheme === "auto"
        ? (st.dominantColor ? paletteFromDominant(st.dominantColor) : THEME_PALETTES.orange)
        : THEME_PALETTES[colorTheme];
      const t = beat.mid;
      const rgb = t < 0.5
        ? lerpColor(palette[0], palette[1], t * 2)
        : lerpColor(palette[1], palette[2], (t - 0.5) * 2);
      colorRef.current.setRGB(rgb[0], rgb[1], rgb[2]);
      u.uColor.value = colorRef.current;
    }

    // 粒子云整体缓慢旋转
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.04;
      pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.08) * 0.08;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aSize" count={count} array={sizes} itemSize={1} />
        <bufferAttribute attach="attributes-aSeed" count={count} array={seeds} itemSize={1} />
        <bufferAttribute attach="attributes-aVelocity" count={count} array={velocities} itemSize={3} />
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

/** 电影镜头：相机轨道 + 节拍推拉 + 可选晃动 + 用户 DIY 拖拽/滚轮（对标 MineRadio orbit + scheduleBeatCamera）
 *  v2: BeatCam 5 通道 + ADSR 包络 + FOV punch（对标 Mineradio applyFreeCameraToCamera + updateCamera 5080-5088）
 */
function CinematicCamera() {
  const { camera } = useThree();
  const baseZ = 18;
  const baseFOV = 60;
  const shakeOffset = useRef({ x: 0, y: 0 });

  useFrame((state) => {
    const bc = usePlayerStore.getState().beatCam;
    const beat = readBeat();
    const vp = usePlayerStore.getState().visualParams;
    const cameraShakeOn = vp.cameraShake;       // 旧布尔开关：是否随机晃动
    const cinemaShakeAmt = Math.max(0, Math.min(1, vp.cinemaShake)); // 0~1，电影镜头幅度
    const t = state.clock.elapsedTime;

    // ===== 1. 用户 DIY 轨道 + 缓速漂浮（保留旧行为） =====
    const orbitR = 5;
    const userTheta = orbit.userTheta;
    const userPhi = orbit.userPhi;
    const userRad = orbit.userRadius;
    let targetX = Math.sin(t * 0.1 + userTheta) * (orbitR + userPhi * 2);
    let targetY = Math.cos(t * 0.07 + userPhi) * orbitR * 0.5 + 2 + userPhi * 3;

    // ===== 2. ★ BeatCam 5 通道径向推近（对标 Mineradio radiusKick × cameraShake × 0.52） =====
    let targetZ = baseZ - bc.radiusKick * cinemaShakeAmt * 0.52 + userRad;

    // ===== 3. 兜底：cameraShake 开关打开时附加随机晃动（向后兼容老视觉） =====
    if (cameraShakeOn) {
      const shake = beat.intensity * 0.6;
      shakeOffset.current.x = Math.sin(t * 13.0) * shake;
      shakeOffset.current.y = Math.cos(t * 11.0) * shake;
    } else {
      shakeOffset.current.x *= 0.9;
      shakeOffset.current.y *= 0.9;
    }
    targetX += shakeOffset.current.x;
    targetY += shakeOffset.current.y;

    // 平滑插值
    camera.position.x += (targetX - camera.position.x) * 0.05;
    camera.position.y += (targetY - camera.position.y) * 0.05;
    camera.position.z += (targetZ - camera.position.z) * 0.10;
    camera.lookAt(0, 0, 0);

    // ===== 4. ★ 5 通道旋转 + FOV punch（对标 Mineradio 3925-3939） =====
    if (cinemaShakeAmt > 0) {
      camera.rotation.order = "YXZ";
      camera.rotation.x = bc.phiKick * cinemaShakeAmt * 0.45;
      camera.rotation.y = bc.thetaKick * cinemaShakeAmt * 0.45;
      camera.rotation.z = bc.rollKick * cinemaShakeAmt;
      // FOV punch（透视相机才有 fov 字段）
      const persp = camera as THREE.PerspectiveCamera;
      if (persp.isPerspectiveCamera) {
        const cameraPunch = (bc.punch * 0.54 + bc.radiusKick * 0.16) * cinemaShakeAmt;
        const targetFov = baseFOV - cameraPunch * 1.75;
        persp.fov = persp.fov + (targetFov - persp.fov) * (targetFov < persp.fov ? 0.24 : 0.12);
        persp.updateProjectionMatrix();
      }
    } else {
      // 关闭电影镜头：重置 rotation 和 FOV
      if (camera.rotation.x !== 0) camera.rotation.x = 0;
      if (camera.rotation.y !== 0) camera.rotation.y = 0;
      if (camera.rotation.z !== 0) camera.rotation.z = 0;
      const persp = camera as THREE.PerspectiveCamera;
      if (persp.isPerspectiveCamera && Math.abs(persp.fov - baseFOV) > 0.001) {
        persp.fov = baseFOV;
        persp.updateProjectionMatrix();
      }
    }
  });

  return null;
}

export function BeatParticles() {
  // DIY 运镜：拖拽改 theta/phi，滚轮改 radius，双击回正（对标 MineRadio orbit）
  const onPointerDown = (e: React.PointerEvent) => {
    orbit.dragging = true;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!orbit.dragging) return;
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    orbit.userTheta += dx * 0.005;
    orbit.userPhi = Math.max(-0.8, Math.min(0.8, orbit.userPhi + dy * 0.005));
  };
  const onPointerUp = () => { orbit.dragging = false; };
  const onWheel = (e: React.WheelEvent) => {
    orbit.userRadius = Math.max(-10, Math.min(10, orbit.userRadius + e.deltaY * 0.01));
  };
  const onDoubleClick = () => {
    // 双击回正（对标 MineRadio recenterCamera）
    orbit.userTheta = 0;
    orbit.userPhi = 0;
    orbit.userRadius = 0;
  };

  return (
    <Canvas
      camera={{ position: [0, 2, 18], fov: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      dpr={[1, 1.8]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
    >
      <ParticleCloud />
      <CinematicCamera />
      <BloomLayer />
    </Canvas>
  );
}
