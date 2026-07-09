import { useEffect, useRef } from "react";
import { useVisibleRaf } from "../../hooks/useVisibleRaf";

/**
 * 主题进度条粒子动画（对标 Mineradio 进度条 spark 视觉）。
 *
 * 布局：
 *   - 在 .pb-slider 中铺一层绝对定位的 canvas（pointer-events:none），z-index 介于轨道与 thumb 之间。
 *   - canvas 尺寸通过 ResizeObserver 与父容器同步，devicePixelRatio 同步缩放避免糊。
 *
 * 视觉：
 *   - "已播放"区域（progress% 左侧）随机分布 14 个 spark 粒子，缓慢横向漂浮 + 轻微上下浮动。
 *   - 暂停时不更新位置（粒子静止，仍保持可见）。
 *   - 进度边界处一个"lead head"高亮光点（白→橙渐变 + 内外双层 glow）。
 *   - 色调跟随主题 CSS 变量（--orange-hot / --orange / --amber / --mint），全用 currentColor 派生。
 *
 * 性能与无障碍：
 *   - 单 RAF loop，约 14 粒子 + 1 个 lead head，DPR 缩放，零额外 DOM。
 *   - prefers-reduced-motion: reduce 时只画 lead head（不跑 RAF 漂移）。
 *   - 使用 useVisibleRaf：后台/不可见时暂停。
 */

interface Props {
  /** 进度百分比 0~100 */
  progress: number;
  /** 是否在播放（暂停时停止粒子飘动，但仍渲染） */
  isPlaying: boolean;
}

interface Spark {
  /** 在 canvas 坐标系下，x ∈ [0, leadHeadX]，y ∈ [0, H] */
  x: number;
  y: number;
  /** 基础半径（pixel） */
  r: number;
  /** 横向漂移速度 (px/s)，slow & drift */
  vx: number;
  /** 上下浮动振幅 (px) */
  amp: number;
  /** 上下浮动频率 (Hz) */
  freq: number;
  /** 0~1，用于计算 alpha 与色调 phase */
  phase: number;
  /** 当前上下浮动的初相位 (rad) */
  phi: number;
  /** "x/length" 比例（落在 [0,1]，决定颜色权重：偏左=橙，偏右=am/mint） */
  energy: number;
}

const SPARK_COUNT = 14;
/** Color stops used by sparks + lead head（统一用主题 CSS 变量解析） */
function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function ProgressParticles({ progress, isPlaying }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sparksRef = useRef<Spark[]>([]);
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 1, h: 22, dpr: 1 });
  const lastTsRef = useRef<number>(0);
  const progressRef = useRef<number>(progress);
  const playingRef = useRef<boolean>(isPlaying);
  const reducedMotionRef = useRef<boolean>(false);

  // 把 props 同步到 ref，避免重启 RAF
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }, []);

  const resize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    sizeRef.current = { w, h, dpr };
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const seedSparks = () => {
    const { w, h } = sizeRef.current;
    const sparks: Spark[] = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparks.push({
        x: Math.random() * w,
        y: h * (0.25 + Math.random() * 0.5), // 居中带一点抖动
        r: 0.6 + Math.random() * 1.6,
        vx: -(4 + Math.random() * 8), // px/s 向左轻微漂
        amp: 0.6 + Math.random() * 1.4,
        freq: 0.25 + Math.random() * 0.4,
        phase: Math.random(),
        phi: Math.random() * Math.PI * 2,
        energy: Math.random(),
      });
    }
    sparksRef.current = sparks;
  };

  // 初始化 canvas 尺寸 + ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver(() => {
      resize();
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    resize();
    seedSparks();

    return () => {
      ro.disconnect();
    };
  }, []);

  // 使用 useVisibleRaf 接管绘制：后台/不可见时暂停
  useVisibleRaf(
    () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const now = performance.now();
      const dt = lastTsRef.current === 0 ? 0 : Math.min(0.05, (now - lastTsRef.current) / 1000);
      lastTsRef.current = now;
      draw(ctx, dt);
    },
    { enabled: true, pauseOnHidden: true }
  );

  // draw —— 直接从 ref 取最新状态，避免闭包陷阱
  const draw = (ctx: CanvasRenderingContext2D, dt: number) => {
    const { w, h } = sizeRef.current;
    const c = readCssVar("--orange-hot", "#ff3d00");
    const mid = readCssVar("--orange", "#ff6b1a");
    const amber = readCssVar("--amber", "#ffc685");
    const mint = readCssVar("--mint", "#9cffdf");
    const progressPct = Math.max(0, Math.min(100, progressRef.current));
    const leadHeadX = (progressPct / 100) * w;
    const playing = playingRef.current && !reducedMotionRef.current;

    ctx.clearRect(0, 0, w, h);

    // 1) 已播放区域 spark 粒子（仅在 progressPct > 0 时画）
    if (progressPct > 0.5) {
      const sparks = sparksRef.current;
      const now = performance.now() / 1000;
      for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i];

        // 仅画在已播放区域 [0, leadHeadX]，越界就循环到 leadHeadX 附近
        if (s.x > leadHeadX) {
          // 重生到 leadHeadX 边界附近，随机纵向位置
          s.x = leadHeadX - Math.random() * 8;
          s.y = h * (0.25 + Math.random() * 0.5);
          s.energy = Math.random();
          s.phi = Math.random() * Math.PI * 2;
        }
        if (s.x < 0) s.x = 0;

        // 浮动（暂停时不更新 phi，dt=0 等价于静止）
        const wob = playing ? Math.sin(now * s.freq * Math.PI * 2 + s.phi) * s.amp : 0;
        const x = s.x;
        const y = h / 2 + wob;

        // 漂移（暂停时也停）
        if (playing) s.x += s.vx * dt;

        // 颜色权重：0=橙红主色，1=香槟琥珀
        const col = s.energy < 0.5 ? c : s.energy < 0.85 ? mid : amber;
        const baseAlpha = 0.45 + Math.sin(now * 1.3 + s.phi) * 0.25; // 0.2-0.7 呼吸
        // 越靠近 leadHeadX 越亮（已播放区域尾部强调）
        const distNorm = Math.max(0, Math.min(1, 1 - x / Math.max(1, leadHeadX)));
        const tailBoost = 0.4 + 0.6 * distNorm;
        const alpha = Math.max(0.15, baseAlpha * tailBoost);

        // glow halo
        const halo = ctx.createRadialGradient(x, y, 0, x, y, s.r * 4.5);
        halo.addColorStop(0, withAlpha(col, alpha * 0.9));
        halo.addColorStop(0.5, withAlpha(col, alpha * 0.35));
        halo.addColorStop(1, withAlpha(col, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, s.r * 4.5, 0, Math.PI * 2);
        ctx.fill();

        // 核
        ctx.fillStyle = withAlpha("#fff", Math.min(1, alpha * 1.4));
        ctx.beginPath();
        ctx.arc(x, y, s.r * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2) Lead head —— 进度边界处高亮光点（始终渲染，无论 isPlaying）
    if (progressPct > 0 && progressPct < 100) {
      const lx = leadHeadX;
      const ly = h / 2;
      const r = h * 0.36;
      const pulse = playing ? 0.85 + Math.sin(performance.now() / 280) * 0.15 : 1;

      // outer halo（am → mint 双色）
      const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 2.2);
      halo.addColorStop(0, withAlpha(amber, 0.95 * pulse));
      halo.addColorStop(0.4, withAlpha(mid, 0.55 * pulse));
      halo.addColorStop(1, withAlpha(c, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(lx, ly, r * 2.2, 0, Math.PI * 2);
      ctx.fill();

      // core dot
      const core = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(0.5, withAlpha(amber, 0.95));
      core.addColorStop(1, withAlpha(c, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  return <canvas ref={canvasRef} aria-hidden="true" />;
}

/** 在 rgba(...) / hex 上叠 alpha。简化：仅支持 hex (#rrggbb / #rgb)。 */
function withAlpha(c: string, a: number): string {
  const aa = Math.max(0, Math.min(1, a));
  if (c.startsWith("#")) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${aa})`;
  }
  if (c.startsWith("rgb(")) {
    return c.replace("rgb(", "rgba(").replace(")", `,${aa})`);
  }
  // 其他（理论不会到）：直接返回，加透明度会失效但不至于崩
  return c;
}
