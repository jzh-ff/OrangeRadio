import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePlayerStore } from "../stores/playerStore";
import { proxyCoverUrl } from "../features/player/useCover";

/**
 * 平面网格封面粒子（对标 Mineradio buildCoverParticleGeometry + 双层粒子）
 *
 * 关键差异（vs 旧 CoverParticles）：
 *   - 粒子是平面网格（z=0），不是球面/像素化采样
 *   - 几何只生成一次（UV + 位置），颜色在 shader 里实时采封面纹理
 *   - 双层 Points：NormalBlending 主体层 + AdditiveBlending 辉光层
 *   - bloomKeep：暗像素不发辉光 → 暗区保留黑色，亮区才有光晕
 *   - 失败 fallback：仍然用平面网格 + 默认色（紫粉蓝渐变），不再回退 BeatParticles
 *
 * 几何分辨率由 visualParams.coverResolution 驱动（0.75~1.55，对应 grid 88~183）。
 */

const PLANE_SIZE = 16;
const GRID_MIN = 88;
const GRID_MAX = 183;
const GRID_BASE = 118;

/** 网格密度（对标 Mineradio coverParticleGridForResolution） */
function gridForResolution(coverage: number): number {
  const v = Math.max(0.75, Math.min(1.55, coverage));
  const g = Math.round(GRID_BASE * v);
  const clamped = Math.max(GRID_MIN, Math.min(GRID_MAX, g));
  return clamped | 1; // 强制奇数（让中心点刚好在 (0,0)）
}

/** 平面网格几何（对标 Mineradio buildCoverParticleGeometry 5711-5739 行） */
function buildGridGeometry(grid: number) {
  const count = grid * grid;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const seeds = new Float32Array(count);
  const texelStep = 1 / grid;
  for (let i = 0; i < count; i++) {
    const gx = i % grid, gy = Math.floor(i / grid);
    positions[i * 3]     = (gx / (grid - 1) - 0.5) * PLANE_SIZE;
    positions[i * 3 + 1] = (gy / (grid - 1) - 0.5) * PLANE_SIZE;
    positions[i * 3 + 2] = 0;
    uvs[i * 2]     = (gx + 0.5) * texelStep;
    uvs[i * 2 + 1] = (gy + 0.5) * texelStep;
    seeds[i] = Math.random();
  }
  return { positions, uvs, seeds, count };
}

// 顶点 shader（对标 Mineradio 5960-6326）
const vertexShader = /* glsl */ `
  uniform float uTime, uBass, uMid, uTreble, uBeat;
  uniform float uIntensity, uPointScale, uSpeed, uScatter, uColorBoost;
  uniform sampler2D uCoverTex;
  uniform float uHasCover;
  uniform vec3 uDefaultColA;
  uniform vec3 uDefaultColB;
  uniform vec3 uDefaultColC;
  uniform float uPixel;

  attribute vec2 aUv;
  attribute float aSeed;

  varying vec3 vColor;
  varying float vSourceLum;
  varying float vBright;
  varying float vAlpha;

  // 简化 simplex noise（沿用旧版风格，避免引入 npm 包）
  float snoise(vec3 p) {
    return sin(p.x * 1.3 + p.y * 2.1 + p.z * 1.7) * 0.5
         + sin(p.x * 2.7 - p.z * 1.9) * 0.3
         + sin(p.y * 3.1 + p.x * 0.8) * 0.2;
  }

  void main() {
    vec3 pos = position;
    float t = uTime * uSpeed;

    // 频谱驱动 z 位移（对标 Mineradio bassBreath + midDisp + trebleJ）
    float bassBreath = snoise(vec3(pos.x * 0.5, pos.y * 0.5, t * 0.4)) * uBass * 0.45 * uIntensity;
    float midDisp    = snoise(vec3(pos.x * 1.4, pos.y * 1.4, t * 0.55)) * uMid * 0.65 * uIntensity;
    float trebleJ    = snoise(vec3(pos.x * 6.5, pos.y * 6.5, t * 3.5 + aSeed * 4.0)) * uTreble * 0.20 * uIntensity;
    float beatBurst  = uBeat * 0.55 * uIntensity;

    // 节拍径向凸起（粒子远离平面）
    float radial = length(pos.xy) * beatBurst * 0.10;
    pos.z += radial + bassBreath + midDisp + trebleJ;

    // 离散感
    pos.xy += vec2(
      snoise(vec3(aSeed * 17.0, t, 0.0)),
      snoise(vec3(aSeed * 23.0, t, 1.0))
    ) * uScatter * 0.5;

    // 颜色：UV 采封面纹理，无封面时用紫粉蓝渐变（对标 Mineradio defaultColor）
    vec3 coverCol = texture2D(uCoverTex, aUv).rgb;
    vec3 defaultCol = mix(
      uDefaultColA,
      mix(uDefaultColB, uDefaultColC, aUv.x),
      aUv.y
    );
    vColor = mix(defaultCol, coverCol, uHasCover) * uColorBoost;
    vSourceLum = dot(vColor, vec3(0.299, 0.587, 0.114));
    vBright = 0.7 + uBeat * 0.5 + uBass * 0.4 + uMid * 0.2;
    vAlpha = 0.85 + uBeat * 0.15;

    // 投影 + 点大小
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float depthSize = 300.0 / max(0.5, -mvPos.z);
    float audioBoost = 1.0 + uBeat * 0.5 + uBass * 0.4;
    float sz = clamp(depthSize * audioBoost * 0.018, 1.5, 5.0);
    gl_PointSize = sz * uPixel * uPointScale;
  }
`;

// 主体层 fragment（NormalBlending，看得清粒子结构）
const fsMain = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vBright;
  varying float vSourceLum;
  varying float vAlpha;

  void main(){
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float soft = 1.0 - smoothstep(0.35, 0.5, d);
    vec3 col = vColor * vBright;
    // 边缘锐化（亮处黑边，暗处白边 —— 对标 Mineradio readableRim）
    float dotDist = d * 2.0;
    float rim = smoothstep(0.85, 1.0, dotDist) * (1.0 - smoothstep(1.0, 1.1, dotDist));
    float outLum = dot(col, vec3(0.299, 0.587, 0.114));
    float darkPart = 1.0 - smoothstep(0.20, 0.50, outLum);
    col = mix(col, vec3(1.0), rim * darkPart * 0.30);
    gl_FragColor = vec4(col, soft * vAlpha);
  }
`;

// 辉光层 fragment（AdditiveBlending + bloomKeep 暗区保护 —— 对标 Mineradio 6374-6385）
const fsBloom = /* glsl */ `
  precision highp float;
  uniform float uBloomStrength;
  varying vec3 vColor;
  varying float vBright;
  varying float vSourceLum;
  varying float vAlpha;

  void main(){
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float soft = (1.0 - smoothstep(0.0, 0.5, d));
    soft = soft * soft; // 二次衰减，更柔
    vec3 col = vColor * (0.55 + vBright * 0.62);
    // ★ bloomKeep：暗像素不发辉光（保留黑色背景）
    float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
    float bloomKeep = 1.0 - keepBlack * 0.92;
    float pulse = 1.0 + uBloomStrength * 0.45;
    gl_FragColor = vec4(col,
      soft * uBloomStrength * pulse * 0.55 * vAlpha * bloomKeep);
  }
`;

// 辉光顶点：把 gl_PointSize 放大 2.65 倍（对标 Mineradio uBloomSize）
const bloomVertexShader = vertexShader.replace(
  "gl_PointSize = sz * uPixel * uPointScale;",
  "gl_PointSize = sz * uPixel * uPointScale * 2.65;"
);

// 主题色（无封面 fallback 时用 —— 紫粉蓝渐变，对标 Mineradio defaultColor）
const DEFAULT_COL_A = new THREE.Color(0.36, 0.28, 0.72);
const DEFAULT_COL_B = new THREE.Color(0.85, 0.55, 0.95);
const DEFAULT_COL_C = new THREE.Color(0.45, 0.78, 0.95);

/** BeatCam 5 通道驱动 Canvas 相机（对标 Mineradio applyFreeCameraToCamera + updateCamera 5080-5088）
 *
 *  - rotation.x/y = phi/theta kick × cinemaShake（YXZ 旋转顺序）
 *  - rotation.z = roll kick × cinemaShake
 *  - position.z = baseZ - radiusKick × cinemaShake × 0.52（径向推近）
 *  - fov = baseFOV - cameraPunch × 1.75（FOV punch，downbeat 时"扎一下"）
 */
function CinematicCamera({ baseZ = 12, baseFOV = 60 }: { baseZ?: number; baseFOV?: number }) {
  const { camera } = useThree();
  useFrame(() => {
    const bc = usePlayerStore.getState().beatCam;
    const vp = usePlayerStore.getState().visualParams;
    const shake = Math.max(0, Math.min(1, vp.cinemaShake)); // 0~1
    if (shake <= 0) {
      // 关掉电影镜头时回归默认姿态
      if (camera.rotation.x !== 0) camera.rotation.x = 0;
      if (camera.rotation.y !== 0) camera.rotation.y = 0;
      if (camera.rotation.z !== 0) camera.rotation.z = 0;
      if (Math.abs(camera.position.z - baseZ) > 0.001) camera.position.z = baseZ;
      const persp = camera as THREE.PerspectiveCamera;
      if (persp.isPerspectiveCamera && Math.abs(persp.fov - baseFOV) > 0.001) {
        persp.fov = baseFOV;
        persp.updateProjectionMatrix();
      }
      return;
    }
    // ★ 5 通道应用
    camera.rotation.order = "YXZ";
    camera.rotation.x = bc.phiKick * shake * 0.45;
    camera.rotation.y = bc.thetaKick * shake * 0.45;
    camera.rotation.z = bc.rollKick * shake;
    const targetZ = baseZ - bc.radiusKick * shake * 0.52;
    camera.position.z = camera.position.z + (targetZ - camera.position.z) * 0.18;
    // FOV punch（仅 PerspectiveCamera）
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      const cameraPunch = (bc.punch * 0.54 + bc.radiusKick * 0.16) * shake;
      const targetFov = baseFOV - cameraPunch * 1.75;
      persp.fov = persp.fov + (targetFov - persp.fov) * (targetFov < persp.fov ? 0.24 : 0.12);
      persp.updateProjectionMatrix();
    }
  });
  return null;
}

interface CoverCloudProps {
  positions: Float32Array;
  uvs: Float32Array;
  seeds: Float32Array;
  count: number;
  coverTexture: THREE.Texture;
  hasCover: boolean;
}

function CoverCloud({ positions, uvs, seeds, coverTexture, hasCover }: CoverCloudProps) {
  // 共享 uniforms（主体 + 辉光都用同一份）
  const uniforms = useMemo(
    () => ({
      uTime:        { value: 0 },
      uBass:        { value: 0 },
      uMid:         { value: 0 },
      uTreble:      { value: 0 },
      uBeat:        { value: 0 },
      uIntensity:   { value: 0.85 },
      uPointScale:  { value: 1.0 },
      uSpeed:       { value: 1.0 },
      uScatter:     { value: 0 },
      uColorBoost:  { value: 1.1 },
      uCoverTex:    { value: coverTexture },
      uHasCover:    { value: hasCover ? 1 : 0 },
      uDefaultColA: { value: DEFAULT_COL_A },
      uDefaultColB: { value: DEFAULT_COL_B },
      uDefaultColC: { value: DEFAULT_COL_C },
      uBloomStrength: { value: 1.1 },
      uPixel:       { value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 1.8) : 1 },
    }),
    [] // uniforms 引用稳定
  );

  // hasCover / coverTexture 变化时同步
  useEffect(() => {
    uniforms.uHasCover.value = hasCover ? 1 : 0;
  }, [hasCover, uniforms]);
  useEffect(() => {
    uniforms.uCoverTex.value = coverTexture;
  }, [coverTexture, uniforms]);

  // 每帧同步 beat + 视觉参数
  useFrame((state) => {
    const beat = usePlayerStore.getState().beat;
    const vp = usePlayerStore.getState().visualParams;
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uBass.value = beat.bass;
    uniforms.uMid.value = beat.mid;
    uniforms.uTreble.value = beat.treble;
    uniforms.uBeat.value = beat.intensity;
    uniforms.uIntensity.value = vp.intensity;
    uniforms.uPointScale.value = vp.pointSize;
    uniforms.uSpeed.value = vp.speed;
    uniforms.uScatter.value = vp.scatter;
    uniforms.uColorBoost.value = vp.colorTension;
    uniforms.uBloomStrength.value = vp.bloomStrength;
  });

  return (
    <group>
      {/* 主体层：NormalBlending */}
      <points frustumCulled={false} renderOrder={1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aUv" args={[uvs, 2]} />
          <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        </bufferGeometry>
        <shaderMaterial
          attach="material"
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fsMain}
          transparent
          depthWrite={false}
          blending={THREE.NormalBlending}
        />
      </points>
      {/* 辉光层：AdditiveBlending + 大点 + bloomKeep 暗区保护 */}
      <points frustumCulled={false} renderOrder={0}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aUv" args={[uvs, 2]} />
          <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        </bufferGeometry>
        <shaderMaterial
          attach="material"
          uniforms={uniforms}
          vertexShader={bloomVertexShader}
          fragmentShader={fsBloom}
          transparent
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export function CoverParticles() {
  const currentTrack = usePlayerStore((s) => s.currentTrack) as any;
  const coverResolution = usePlayerStore((s) => s.visualParams.coverResolution);
  const grid = gridForResolution(coverResolution);

  // 走 Rust cover_proxy 拉本地缓存（绕开浏览器 CORS）
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void proxyCoverUrl(currentTrack).then((url) => {
      if (cancelled) return;
      setCoverUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [currentTrack]);

  // 几何（grid 变化时重建）
  const geometry = useMemo(() => buildGridGeometry(grid), [grid]);

  // 封面纹理（整个组件生命周期复用）
  const [coverTexture] = useState(() => {
    const tex = new THREE.Texture();
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
  const [hasCover, setHasCover] = useState(false);

  // 加载封面：跨域失败时 hasCover=false，shader 用紫粉蓝渐变（不再回退 BeatParticles）
  useEffect(() => {
    if (!coverUrl) {
      setHasCover(false);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      coverTexture.image = img;
      coverTexture.needsUpdate = true;
      setHasCover(true);
    };
    img.onerror = () => {
      if (cancelled) return;
      setHasCover(false);
    };
    img.src = coverUrl;
    return () => {
      cancelled = true;
    };
  }, [coverUrl, coverTexture]);

  // 卸载时清理纹理
  useEffect(() => {
    return () => {
      coverTexture.dispose();
    };
  }, [coverTexture]);

  return (
    <Canvas
      camera={{ position: [0, 0, 12], fov: 60 }}
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 1.8]}
    >
      <CinematicCamera baseZ={12} baseFOV={60} />
      <CoverCloud
        positions={geometry.positions}
        uvs={geometry.uvs}
        seeds={geometry.seeds}
        count={geometry.count}
        coverTexture={coverTexture}
        hasCover={hasCover}
      />
    </Canvas>
  );
}