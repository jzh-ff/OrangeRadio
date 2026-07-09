import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePlayerStore } from "../stores/playerStore";
import { proxyCoverUrl } from "../features/player/useCover";
import { readBeat } from "../stores/spectrumBus";

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

/** 对标 Mineradio RIPPLE_MAX：12 个并发涟漪（鼓点 1 次放 2~3 个） */
const RIPPLE_MAX = 12;

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
  uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uBurstAmt;
  uniform float uIntensity, uPointScale, uSpeed, uScatter, uColorBoost;
  uniform sampler2D uCoverTex;
  uniform sampler2D uPrevCoverTex;     // 切歌混色（旧封面）
  uniform float uColorMixT;            // 0=完全旧，1=完全新
  uniform float uHasCover;
  uniform vec3 uDefaultColA;
  uniform vec3 uDefaultColB;
  uniform vec3 uDefaultColC;
  uniform float uPixel;
  // 鼠标交互（屏幕 NDC：x/y ∈ [-1, 1]，strength 0~1 离场时淡出）
  uniform vec2 uMouse;
  uniform float uMouseStrength;
  uniform float uHalfPlane;
  // 12 涟漪：1×12 DataTexture，每行 = (x, y, age, str)
  uniform sampler2D uRippleTex;
  uniform int uRippleCount;
  // 6 鼠标水波：1×6 DataTexture，独立通道
  uniform sampler2D uMouseRippleTex;
  uniform int uMouseRippleCount;
  uniform float uK;                    // intensity × 1.6（对标 Mineradio K）

  attribute vec2 aUv;
  attribute float aSeed;

  varying vec3 vColor;
  varying float vSourceLum;
  varying float vBright;
  varying float vAlpha;
  varying float vRippleAmp;            // 给 fragment 用于动态亮度

  // 简化 simplex noise
  float snoise(vec3 p) {
    return sin(p.x * 1.3 + p.y * 2.1 + p.z * 1.7) * 0.5
         + sin(p.x * 2.7 - p.z * 1.9) * 0.3
         + sin(p.y * 3.1 + p.x * 0.8) * 0.2;
  }

  // ★ 对标 Mineradio rippleSumAt：12 涟漪叠加（bulge + ring）
  //   bulge 中心高斯凸起，宽度 0.55→1.35 随时间
  //   ring 圆环扩散，速度 2.10/秒，宽度 0.40→0.62 随时间
  float rippleSumAt(vec2 p, out float maxAmp) {
    float sum = 0.0; maxAmp = 0.0;
    for (int ri = 0; ri < 12; ri++) {
      if (ri >= uRippleCount) break;
      float vCoord = (float(ri) + 0.5) / 12.0;
      vec4 rd = texture2D(uRippleTex, vec2(0.5, vCoord));
      float age = rd.z; float str = rd.w;
      if (str < 0.005 || age < 0.0 || age > 2.0) continue;
      float dx = p.x - rd.x, dy = p.y - rd.y;
      float dist = sqrt(dx*dx + dy*dy);
      float lifeN = age / 2.0;
      float fadeIn  = smoothstep(0.0, 0.06, age);
      float fadeOut = 1.0 - smoothstep(0.7, 1.0, lifeN);
      float env = fadeIn * fadeOut;
      float bulgeW = 0.55 + age * 0.80;
      float bulge  = exp(-dist*dist / (2.0 * bulgeW * bulgeW)) * (1.0 - smoothstep(0.0, 0.55, lifeN));
      float waveR  = age * 2.10;
      float ringW  = 0.40 + age * 0.22;
      float ring   = exp(-pow((dist - waveR) / ringW, 2.0));
      // v7.1: bulge × 2.4 + ring × 1.30
      float local  = (bulge * 2.4 + ring * 1.30) * env * str;
      sum += local;
      maxAmp = max(maxAmp, abs(local));
    }
    return sum;
  }

  // ★ 鼠标水波涟漪（独立通道：用户主动控制；6 个并发；持续 1.2s）
  //   bulge 较宽（0.5），ring 扩散快（速度 3.2），整体放大 ×1.5
  float mouseRippleSumAt(vec2 p, out float maxAmp) {
    float sum = 0.0; maxAmp = 0.0;
    for (int ri = 0; ri < 6; ri++) {
      if (ri >= uMouseRippleCount) break;
      float vCoord = (float(ri) + 0.5) / 6.0;
      vec4 rd = texture2D(uMouseRippleTex, vec2(0.5, vCoord));
      float age = rd.z; float str = rd.w;
      if (str < 0.005 || age < 0.0 || age > 1.2) continue;
      float dx = p.x - rd.x, dy = p.y - rd.y;
      float dist = sqrt(dx*dx + dy*dy);
      float lifeN = age / 1.2;
      float env = (1.0 - smoothstep(0.5, 1.0, lifeN)) * smoothstep(0.0, 0.04, age);
      // 中心凸起（lifeN 0~1，宽度 0.5→0.05 收窄，模拟"水柱升起落下"）
      float bulgeW = 0.50 * (1.0 - lifeN * 0.6);
      float bulge  = exp(-dist*dist / (2.0 * bulgeW * bulgeW));
      // 外扩环（速度 3.2 单位/秒，宽度 0.45）
      float waveR  = age * 3.2;
      float ringW  = 0.45 + age * 0.20;
      float ring   = exp(-pow((dist - waveR) / ringW, 2.0));
      float local  = (bulge * 1.8 + ring * 1.2) * env * str;
      sum += local;
      maxAmp = max(maxAmp, abs(local));
    }
    return sum;
  }

  void main() {
    vec3 pos = position;
    float t = uTime * uSpeed;

    // ★ 切歌混色：新旧封面间平滑过渡
    vec3 newCol = texture2D(uCoverTex, aUv).rgb;
    vec3 prevCol = texture2D(uPrevCoverTex, aUv).rgb;
    vec3 coverColor = mix(prevCol, newCol, clamp(uColorMixT, 0.0, 1.0));

    // 颜色：UV 采封面纹理，无封面时用紫粉蓝渐变
    vec3 defaultCol = mix(
      uDefaultColA,
      mix(uDefaultColB, uDefaultColC, aUv.x),
      aUv.y
    );
    vColor = mix(defaultCol, coverColor, uHasCover) * uColorBoost;
    vSourceLum = dot(vColor, vec3(0.299, 0.587, 0.114));

    // ★ 频谱驱动 z 位移（对标 Mineradio 5995-6006 公式）
    float midN = snoise(vec3(pos.x*1.4, pos.y*1.4, t*0.55)) * 0.6
               + snoise(vec3(pos.x*2.8+5.0, pos.y*2.8-3.0, t*0.85)) * 0.4;
    float midMask = 0.55 + 0.45 * snoise(vec3(pos.x*0.4, pos.y*0.4, t*0.18));
    float midDisp = midN * uMid * 0.55 * midMask * uK;
    float trebleJ = snoise(vec3(pos.x*6.5, pos.y*6.5, t*3.5 + aSeed*4.0)) * uTreble * 0.18 * uK;
    float bassBreath = snoise(vec3(pos.x*0.35, pos.y*0.35, t*0.4)) * uBass * 0.42 * uK;

    // ★ 12 涟漪叠加 → 鼓点时 2~3 个区域同时"凸起+环扩"
    float maxRippleAmp = 0.0;
    float rippleZ = rippleSumAt(pos.xy, maxRippleAmp);
    vRippleAmp = maxRippleAmp;

    // 节拍径向凸起（鼓点整体从中心向外）
    float beatBurst = uBeat * uK * 0.45;
    float radial = length(pos.xy) * beatBurst * 0.18;

    // 鼠标水波交互：即时排斥（鼠标当前位置） + 历史涟漪叠加（向外扩散）
    vec2 mouseWorld = uMouse * uHalfPlane;
    vec2 fromMouse = pos.xy - mouseWorld;
    float mDist = length(fromMouse);

    // 即时排斥（鼠标软半径内粒子被推开，跟随鼠标）
    float repelR = uHalfPlane * 0.30;
    float repel = smoothstep(repelR, 0.0, mDist) * 1.0;
    float instantWave = repel * uMouseStrength;
    if (mDist > 0.001) {
      pos.xy += (fromMouse / mDist) * instantWave * 1.4;
      pos.z  += instantWave * 1.4;
    }

    // 历史涟漪（6 个并发，从鼠标点位置向外扩散 1.2s）
    float maxMouseRippleAmp = 0.0;
    float mouseRippleZ = mouseRippleSumAt(pos.xy, maxMouseRippleAmp);
    pos.z += mouseRippleZ * 1.6;

    // 离散感
    pos.xy += vec2(
      snoise(vec3(aSeed * 17.0, t, 0.0)),
      snoise(vec3(aSeed * 23.0, t, 1.0))
    ) * uScatter * 0.5;

    // 整合 z 位移：涟漪 × 1.3 + 中频 + 高频 + 低频呼吸 + 鼓点径向
    pos.z = rippleZ * 1.30 + midDisp + trebleJ + bassBreath + radial;

    // ★ 亮度/大小随涟漪 + 节拍变化（对标 Mineradio 6269/6315）
    vBright = 0.82 + maxRippleAmp * 0.55 + uBass * 0.10 + uBeat * 0.30 + uEnergy * 0.05 + uBurstAmt * 0.40;
    vAlpha = 0.85 + uBeat * 0.15;

    // 投影 + 点大小
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float depthSize = 300.0 / max(0.5, -mvPos.z);
    float audioBoost = 1.0 + maxRippleAmp * 0.7 + uBeat * 0.30 + uBurstAmt * 0.5;
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
  varying float vRippleAmp;

  void main(){
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float soft = 1.0 - smoothstep(0.35, 0.5, d);
    vec3 col = vColor * (vBright + vRippleAmp * 0.18);
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
  varying float vRippleAmp;

  void main(){
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float soft = (1.0 - smoothstep(0.0, 0.5, d));
    soft = soft * soft; // 二次衰减，更柔
    vec3 col = vColor * (0.55 + vBright * 0.62 + vRippleAmp * 0.45);
    // ★ bloomKeep：暗像素不发辉光（保留黑色背景）
    float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
    float bloomKeep = 1.0 - keepBlack * 0.92;
    float pulse = 1.0 + uBloomStrength * 0.45 + vRippleAmp * 0.6;
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

// ============================================================
// 12 涟漪数据纹理（对标 Mineradio 5774-5779）
//   1×12 FloatTexture，每像素 = (x, y, age, str)
//   JS 端用数组 + 写 0~12 槽位，shader 端按需读
// ============================================================
const rippleData = new Float32Array(RIPPLE_MAX * 4);

/** 鼠标水波涟漪：6 槽，独立通道（持续 1.2s） */
const MOUSE_RIPPLE_MAX = 6;
const mouseRippleData = new Float32Array(MOUSE_RIPPLE_MAX * 4);
const mouseRippleTex = new THREE.DataTexture(mouseRippleData, 1, MOUSE_RIPPLE_MAX, THREE.RGBAFormat, THREE.FloatType);
mouseRippleTex.magFilter = THREE.NearestFilter;
mouseRippleTex.minFilter = THREE.NearestFilter;
const rippleTex = new THREE.DataTexture(rippleData, 1, RIPPLE_MAX, THREE.RGBAFormat, THREE.FloatType);
rippleTex.magFilter = THREE.NearestFilter;
rippleTex.minFilter = THREE.NearestFilter;

// 9 个 region（对应 3×3 网格），涟漪中心从这些点附近随机挑（对标 Mineradio 9370-9375）
const rippleRegions: { x: number; y: number }[] = [];
for (let ry = 0; ry < 3; ry++) {
  for (let rx = 0; rx < 3; rx++) {
    rippleRegions.push({
      x: (rx / 2 - 0.5) * PLANE_SIZE * 0.72,
      y: (ry / 2 - 0.5) * PLANE_SIZE * 0.72,
    });
  }
}

// 空白 cover 纹理（prev cover 兜底，避免切歌瞬间 mix 出垃圾）
const blankCoverTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
blankCoverTex.needsUpdate = true;

// ============================================================
// 涟漪运行时（模块级闭包，对标 Mineradio 9377-9381）
//   ripples: 12 个槽 {x, y, age, str}
//   rippleRuntime: 全局共享节拍检测 + 上次触发时间
//   triggerRipple: 写一槽 age=0 str=strength
// ============================================================
const ripples: { x: number; y: number; age: number; str: number }[] = [];
for (let ri = 0; ri < RIPPLE_MAX; ri++) {
  ripples.push({ x: 0, y: 0, age: -10, str: 0 });
}
let rippleIdx = 0;
const rippleRuntime = { lastRippleAt: -10, lastBassRising: false };

function triggerRipple(x: number, y: number, strength: number): void {
  const r = ripples[rippleIdx];
  r.x = x; r.y = y; r.age = 0; r.str = strength;
  rippleIdx = (rippleIdx + 1) % RIPPLE_MAX;
}

// 鼠标水波涟漪运行时
const mouseRipples: { x: number; y: number; age: number; str: number }[] = [];
for (let i = 0; i < MOUSE_RIPPLE_MAX; i++) {
  mouseRipples.push({ x: 0, y: 0, age: -10, str: 0 });
}
let mouseRippleIdx = 0;

function triggerMouseRipple(x: number, y: number, strength: number): void {
  const r = mouseRipples[mouseRippleIdx];
  r.x = x; r.y = y; r.age = 0; r.str = strength;
  mouseRippleIdx = (mouseRippleIdx + 1) % MOUSE_RIPPLE_MAX;
}

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
  mouseRef: React.MutableRefObject<{ x: number; y: number; strength: number; lastMoveAt: number }>;
  /** 切歌混色相关（外部驱动 uPrevCoverTex + uColorMixT） */
  prevCoverTexRef: React.MutableRefObject<THREE.Texture | null>;
  colorMixTRef: React.MutableRefObject<number>;
}

function CoverCloud({ positions, uvs, seeds, coverTexture, hasCover, mouseRef, prevCoverTexRef, colorMixTRef }: CoverCloudProps) {
  // 共享 uniforms（主体 + 辉光都用同一份）
  const uniforms = useMemo(
    () => ({
      uTime:        { value: 0 },
      uBass:        { value: 0 },
      uMid:         { value: 0 },
      uTreble:      { value: 0 },
      uBeat:        { value: 0 },
      uEnergy:      { value: 0 },
      uBurstAmt:    { value: 0 },
      uIntensity:   { value: 0.85 },
      uPointScale:  { value: 1.0 },
      uSpeed:       { value: 1.0 },
      uScatter:     { value: 0 },
      uColorBoost:  { value: 1.1 },
      uCoverTex:    { value: coverTexture },
      uPrevCoverTex:{ value: blankCoverTex as unknown as THREE.Texture },
      uColorMixT:   { value: 1.0 },         // 默认 1（不切歌 = 完全新封面）
      uHasCover:    { value: hasCover ? 1 : 0 },
      uDefaultColA: { value: DEFAULT_COL_A },
      uDefaultColB: { value: DEFAULT_COL_B },
      uDefaultColC: { value: DEFAULT_COL_C },
      uBloomStrength: { value: 1.1 },
      uPixel:       { value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 1.8) : 1 },
      uMouse:        { value: new THREE.Vector2(0, 0) },
      uMouseStrength:{ value: 0 },
      uHalfPlane:    { value: PLANE_SIZE / 2 },
      uRippleTex:    { value: rippleTex },
      uRippleCount:  { value: 0 },
      uMouseRippleTex:    { value: mouseRippleTex },
      uMouseRippleCount:  { value: 0 },
      uK:            { value: 1.36 },
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

  // 每帧同步 beat + 视觉参数 + 鼠标水波（鼠标离场后 strength 平滑淡出）
  useFrame((state, delta) => {
    const beat = readBeat();
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
    // 封面粒子 bloom 比球面散点更保守，避免亮封面过曝成白屏
    uniforms.uBloomStrength.value = vp.bloomStrength * 0.65;

    // K = intensity × 1.6（对标 Mineradio 5985 公式）
    uniforms.uK.value = Math.max(0.3, vp.intensity * 1.6);

    // 切歌混色（对标 Mineradio uColorMixT）：0 = 完全旧封面，1 = 完全新封面
    // 切歌时外部把 colorMixTRef 重置为 0，我们用 lerp 推到 1
    colorMixTRef.current += (1 - colorMixTRef.current) * Math.min(1, delta * 1.6);
    uniforms.uColorMixT.value = colorMixTRef.current;
    uniforms.uPrevCoverTex.value = prevCoverTexRef.current ?? (blankCoverTex as unknown as THREE.Texture);

    // 鼠标交互
    const now = performance.now();
    const sinceMove = (now - mouseRef.current.lastMoveAt) / 1000;
    const target = sinceMove < 0.5 ? 1 : 0;
    mouseRef.current.strength += (target - mouseRef.current.strength) * Math.min(1, delta * 3);
    uniforms.uMouse.value.set(mouseRef.current.x, mouseRef.current.y);
    uniforms.uMouseStrength.value = mouseRef.current.strength;

    // ★★★ 12 涟漪系统（对标 Mineradio updateRipples 9383-9420） ★★★
    // 1) bass 越过阈值时 1 次放 2~3 个涟漪，从 9 个 region 随机挑
    const BASS_THRESHOLD = 0.55;
    const RIPPLE_COOLDOWN = 0.18;
    // lastRippleAt 通过模块级 ref 共享（这里用闭包 ref 避免 R3F 重建）
    const rstate = rippleRuntime;
    const rising = beat.bass > BASS_THRESHOLD * 0.75;
    const isBassHit = beat.bass > BASS_THRESHOLD && !rstate.lastBassRising;
    rstate.lastBassRising = rising;
    const tNow = state.clock.elapsedTime;
    if (isBassHit && tNow - rstate.lastRippleAt > RIPPLE_COOLDOWN) {
      rstate.lastRippleAt = tNow;
      const count = 2 + (Math.random() < 0.5 ? 0 : 1);
      const used: Record<number, boolean> = {};
      for (let k = 0; k < count; k++) {
        let idx = 0, tries = 0;
        do { idx = Math.floor(Math.random() * 9); tries++; } while (used[idx] && tries < 12);
        used[idx] = true;
        const reg = rippleRegions[idx];
        const jx = reg.x + (Math.random() - 0.5) * 0.7;
        const jy = reg.y + (Math.random() - 0.5) * 0.7;
        const str = 0.65 + beat.bass * 1.4 + Math.random() * 0.25;
        triggerRipple(jx, jy, str);
      }
    }
    // 2) 每帧把 12 槽 age += dt；age > 2 标记 str=0
    let active = 0;
    for (let i = 0; i < RIPPLE_MAX; i++) {
      const r = ripples[i];
      if (r.str > 0.005) {
        r.age += delta;
        if (r.age > 2.0) { r.str = 0; r.age = -10; }
      }
      const off = i * 4;
      rippleData[off]     = r.x;
      rippleData[off + 1] = r.y;
      rippleData[off + 2] = r.age;
      rippleData[off + 3] = r.str;
      if (r.str > 0.005) active++;
    }
    rippleTex.needsUpdate = true;
    uniforms.uRippleCount.value = active;

    // ★ 鼠标水波涟漪：6 槽 1.2s 衰减
    let mouseActive = 0;
    for (let i = 0; i < MOUSE_RIPPLE_MAX; i++) {
      const r = mouseRipples[i];
      if (r.str > 0.005) {
        r.age += delta;
        if (r.age > 1.2) { r.str = 0; r.age = -10; }
      }
      const off = i * 4;
      mouseRippleData[off]     = r.x;
      mouseRippleData[off + 1] = r.y;
      mouseRippleData[off + 2] = r.age;
      mouseRippleData[off + 3] = r.str;
      if (r.str > 0.005) mouseActive++;
    }
    mouseRippleTex.needsUpdate = true;
    uniforms.uMouseRippleCount.value = mouseActive;

    // 3) burst 缓动（每次切歌 / 强鼓点时抬高，0.9/帧衰减）
    uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value * 0.90, isBassHit ? 0.6 : 0.0);
    // 4) 总能量
    uniforms.uEnergy.value = (beat.bass + beat.mid + beat.treble) / 3;
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

  // 鼠标水波交互：屏幕坐标 → NDC（中心 0,0，右下 1,1，左上 -1,-1）
  // 涟漪触发：与上次位置距离 > 0.18 NDC 时触发新涟漪（自然节奏感，不刷屏）
  const mouseRef = useRef({
    x: 0, y: 0, strength: 0, lastMoveAt: 0,
    lastRippleX: 99, lastRippleY: 99, lastRippleAt: 0,
  });
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);  // y 翻转
    mouseRef.current.x = nx;
    mouseRef.current.y = ny;
    mouseRef.current.lastMoveAt = performance.now();

    // 触发涟漪：距上次触发位置 NDC 距离 > 0.18，且距上次触发 > 0.18s
    const dx = nx - mouseRef.current.lastRippleX;
    const dy = ny - mouseRef.current.lastRippleY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const now = performance.now();
    if (dist > 0.18 && now - mouseRef.current.lastRippleAt > 180) {
      // 把 NDC 映射到粒子平面坐标
      const wx = nx * (PLANE_SIZE / 2);
      const wy = ny * (PLANE_SIZE / 2);
      triggerMouseRipple(wx, wy, 1.4);
      mouseRef.current.lastRippleX = nx;
      mouseRef.current.lastRippleY = ny;
      mouseRef.current.lastRippleAt = now;
    }
  };
  const onPointerLeave = () => {
    // 标记离场：lastMoveAt 设为很久以前 → 每帧会平滑把 strength 淡到 0
    mouseRef.current.lastMoveAt = 0;
  };

  // 切歌混色：把"旧封面纹理"和"混色进度"通过 ref 共享给 CoverCloud
  // 每次 currentTrack.id 变化时，把当前 coverTexture 复制到 prev，重置 mixT=0
  const prevCoverTexRef = useRef<THREE.Texture | null>(null);
  const colorMixTRef = useRef<number>(1.0);
  const lastTrackIdRef = useRef<string | null>(null);
  useEffect(() => {
    const trackId = currentTrack?.id ?? null;
    if (trackId === lastTrackIdRef.current) return;
    if (lastTrackIdRef.current !== null && hasCover && coverTexture.image) {
      // 把旧 coverTexture 拷贝到独立 canvas → DataTexture
      try {
        const oldImg = coverTexture.image as HTMLImageElement;
        const c = document.createElement("canvas");
        c.width = oldImg.naturalWidth || 256;
        c.height = oldImg.naturalHeight || 256;
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.drawImage(oldImg, 0, 0, c.width, c.height);
          if (prevCoverTexRef.current) prevCoverTexRef.current.dispose();
          const tex = new THREE.CanvasTexture(c);
          tex.needsUpdate = true;
          prevCoverTexRef.current = tex;
        }
      } catch { /* 切歌首帧 cache 失败也无所谓 */ }
    }
    lastTrackIdRef.current = trackId;
    colorMixTRef.current = 0.0;
  }, [currentTrack?.id, hasCover, coverTexture]);

  return (
    <Canvas
      camera={{ position: [0, 0, 12], fov: 60 }}
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 1.8]}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <CinematicCamera baseZ={12} baseFOV={60} />
      <CoverCloud
        positions={geometry.positions}
        uvs={geometry.uvs}
        seeds={geometry.seeds}
        count={geometry.count}
        coverTexture={coverTexture}
        hasCover={hasCover}
        mouseRef={mouseRef}
        prevCoverTexRef={prevCoverTexRef}
        colorMixTRef={colorMixTRef}
      />
    </Canvas>
  );
}