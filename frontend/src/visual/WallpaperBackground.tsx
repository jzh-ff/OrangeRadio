import { useRef, useEffect } from "react";
import { usePlayerStore } from "../stores/playerStore";
import { getCoverUrl } from "../features/player/useCover";
import { useVisibleRaf } from "../hooks/useVisibleRaf";

/**
 * Wallpaper 银河主背景（对标 MineRadio public/wallpaper.html）
 *
 * 2D canvas 粒子银河：椭圆轨道 + sin^4 闪烁 + 封面模糊底图 + radial aura。
 * 颜色从 dominantColor 推导（无封面时用冷色默认 --mint/--champagne/--chill-cyan）。
 * 播放时粒子加速。prefers-reduced-motion 时降级为静态渐变。
 *
 * 性能：760 粒子 canvas 2D，比 Three.js BeatParticles 轻量，适合主壳常驻。
 * 本版本用 useVisibleRaf 接管 RAF，后台/被遮挡时自动暂停。
 */

interface Particle {
  seed: number;
  x: number;
  y: number;
  lane: number;
  z: number;
  size: number;
}

const STATE = {
  particles: [] as Particle[],
  coverImg: null as HTMLImageElement | null,
  coverSrc: "",
  W: 1,
  H: 1,
  dpr: 1,
};

function hexToRgb(hex: string, fallback = "#9cffdf") {
  let h = String(hex || fallback).trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (!/^#[0-9a-f]{6}$/i.test(h)) h = fallback;
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}
function rgba(hex: string, a: number) {
  const c = hexToRgb(hex);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}
function rgbToHex(r: number, g: number, b: number) {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return "#" + [clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
// 伪随机（确定性，对标 MineRadio rand）
function rand(seed: number) {
  return Math.abs(Math.sin(seed * 3187.917) * 43758.5453) % 1;
}

function ensureParticles() {
  const target = Math.min(760, Math.max(420, Math.round((innerWidth * innerHeight) / 4200)));
  while (STATE.particles.length < target) {
    const i = STATE.particles.length + 1;
    STATE.particles.push({
      seed: i * 11.37,
      x: rand(i), y: rand(i * 2.7), lane: rand(i * 5.9), z: rand(i * 8.1),
      size: 0.6 + rand(i * 4.2) * 2.4,
    });
  }
  if (STATE.particles.length > target + 80) STATE.particles.length = target;
}

function resize(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
  STATE.dpr = Math.min(1.35, Math.max(1, window.devicePixelRatio || 1));
  STATE.W = Math.max(1, Math.floor(innerWidth * STATE.dpr));
  STATE.H = Math.max(1, Math.floor(innerHeight * STATE.dpr));
  canvas.width = STATE.W; canvas.height = STATE.H;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.setTransform(STATE.dpr, 0, 0, STATE.dpr, 0, 0);
  ensureParticles();
}

function setCover(canvas: HTMLCanvasElement, src: string) {
  if (src === STATE.coverSrc) return;
  STATE.coverSrc = src;
  STATE.coverImg = null;
  if (!src) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => { if (STATE.coverSrc === src) STATE.coverImg = img; };
  img.onerror = () => { if (STATE.coverSrc === src) STATE.coverImg = null; };
  img.src = src;
}

function drawCover(ctx: CanvasRenderingContext2D, now: number) {
  if (!STATE.coverImg) return;
  const side = Math.min(innerWidth, innerHeight) * (0.42 + Math.sin(now * 0.21) * 0.012);
  const x = innerWidth * 0.5 - side * 0.5;
  const y = innerHeight * 0.5 - side * 0.5 + Math.sin(now * 0.37) * 8;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.filter = "blur(28px) saturate(1.25)";
  ctx.drawImage(STATE.coverImg, x - side * 0.12, y - side * 0.12, side * 1.24, side * 1.24);
  ctx.filter = "none";
  ctx.globalAlpha = 0.2;
  ctx.drawImage(STATE.coverImg, x, y, side, side);
  ctx.restore();
}

function drawFrame(canvas: HTMLCanvasElement, nowMs: number) {
  const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
  const now = nowMs * 0.001;
  ensureParticles();
  const playing = usePlayerStore.getState().isPlaying;
  const dc = usePlayerStore.getState().dominantColor;
  // 颜色：dominantColor 推导，无则冷色默认
  let primary: string, secondary: string, highlight: string, glow: string;
  if (dc) {
    primary = rgbToHex(dc[0], dc[1], dc[2]);
    secondary = "#9cffdf";
    highlight = "#f4d28a";
    glow = secondary;
  } else {
    primary = "#d6f8ff";
    secondary = "#9cffdf";
    highlight = "#fff0b8";
    glow = "#9cffdf";
  }
  const bg = ctx.createLinearGradient(0, 0, innerWidth, innerHeight);
  bg.addColorStop(0, "#050608");
  bg.addColorStop(0.52, rgba(primary, 0.12));
  bg.addColorStop(1, rgba(secondary, 0.1));
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  drawCover(ctx, now);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const cx = innerWidth * 0.5;
  const cy = innerHeight * 0.5 + Math.sin(now * 0.28) * innerHeight * 0.018;
  const rx = innerWidth * 0.4;
  const ry = innerHeight * 0.3;
  for (let i = 0; i < STATE.particles.length; i++) {
    const p = STATE.particles[i];
    const speed = 0.009 + rand(p.seed) * 0.021 + (playing ? 0.01 : 0);
    const a = (p.x * Math.PI * 2 + now * speed + Math.sin(now * 0.07 + p.seed) * 0.14) % (Math.PI * 2);
    const ring = 0.18 + p.z * 0.82;
    const wobble = Math.sin(now * (0.22 + rand(p.seed) * 0.18) + p.seed) * 12;
    const x = cx + Math.cos(a) * rx * ring + Math.sin(now * 0.11 + p.seed) * 24;
    const y = cy + Math.sin(a * (1 + rand(p.seed * 2) * 0.16)) * ry * ring + wobble;
    const tw = Math.pow(0.5 + 0.5 * Math.sin(now * (0.5 + rand(p.seed) * 0.42) + p.seed), 4);
    const r = Math.max(0.7, p.size * (0.8 + tw * 1.2));
    const col = tw > 0.74 ? highlight : (p.lane > 0.55 ? secondary : glow);
    ctx.globalAlpha = (0.045 + tw * 0.18 + (playing ? 0.035 : 0));
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(innerWidth, innerHeight) * 0.54);
  aura.addColorStop(0, rgba(highlight, 0.12));
  aura.addColorStop(0.34, rgba(secondary, 0.08));
  aura.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.restore();
}

export function WallpaperBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentTrack = usePlayerStore((s) => s.currentTrack) as any;
  const wallpaperOpacity = usePlayerStore((s) => s.visualParams.wallpaperOpacity ?? 1);

  // 读 prefers-reduced-motion
  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // 由 useVisibleRaf 接管 RAF：后台/失焦/reduceMotion/被图片层完全遮挡时暂停
  useVisibleRaf(
    (nowMs) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawFrame(canvas, nowMs);
    },
    {
      enabled: !reduceMotion && wallpaperOpacity < 1,
      pauseOnHidden: true,
      pauseOnBlur: false,
    }
  );

  // 初始化 canvas 尺寸、监听 resize、订阅切歌更新封面
  useEffect(() => {
    if (reduceMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    resize(canvas);
    const onResize = () => resize(canvas);
    window.addEventListener("resize", onResize);

    // 首次封面（切歌时 currentTrack 引用变化 → effect 重跑 → 重新 setCover，
    // 无需再 raw subscribe 整个 store，避免每帧 beatCam/position setState 都触发回调）
    setCover(canvas, getCoverUrl(currentTrack) || "");

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [reduceMotion, currentTrack]);

  if (reduceMotion) {
    // 静态渐变回退（对标 MineRadio wallpaper.html 不支持 canvas 时的降级）
    return <div className="wallpaper-static" />;
  }

  return (
    <div className="wallpaper-bg">
      <canvas ref={canvasRef} />
    </div>
  );
}
