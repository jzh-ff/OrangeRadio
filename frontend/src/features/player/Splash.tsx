import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { OrangeRadioLogo } from "../../components/OrangeRadioLogo";
import { SplashStarfield } from "../../visual/SplashStarfield";
import "./splash.css";

interface SplashProps {
  /** 用户进入主界面（点击/Enter/Space 或自动）时触发 */
  onEnter: () => void;
}

/**
 * 启动页 Splash ——「电台唤醒」叙事
 *
 * A 雪花开机   0  → 0.4s   全屏 fractalNoise 噪点；Three.js 星河挂载，粒子隐于黑
 * B 信号搜寻   0.4 → 1.8s  噪点退去露出星河；Logo 聚焦浮现；频段指针扫频；第 1 圈电波弧扩散
 * C 信号锁定   1.8 → 2.6s  指针扫到 108MHz 停顿；第 2、3 圈电波弧；wordmark 浮现；SIGNAL LOCKED
 * D 就绪       2.6 → 2.8s  「正在进入」提示脉冲；ready=true
 * E 自动进入   2.8s        用户未交互则自动退出
 *
 * 二次启动（localStorage orangeradio_splash_seen）：压缩到 ~1.0s，无扫频无电波，0.8s 后自动进入。
 * 跳过：动画任意阶段点击/Enter/Space 立即进入（仅用 exiting 防重入）。
 * prefers-reduced-motion：无 Three.js、无扫频、静态终态。
 */
export function Splash({ onEnter }: SplashProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const noiseRef = useRef<HTMLDivElement>(null);
  const starfieldRef = useRef<HTMLDivElement>(null);
  const logoWrapRef = useRef<HTMLDivElement>(null);
  const ring1Ref = useRef<HTMLSpanElement>(null);
  const ring2Ref = useRef<HTMLSpanElement>(null);
  const ring3Ref = useRef<HTMLSpanElement>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const signalRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<HTMLDivElement>(null);

  const [exiting, setExiting] = useState(false);
  const [ready, setReady] = useState(false);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const exitingRef = useRef(false);

  const seen = (() => {
    try { return localStorage.getItem("orangeradio_splash_seen") === "1"; } catch { return false; }
  })();

  // prefers-reduced-motion：降级为静态终态（无 Three.js / 无扫频 / 无电波）
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const tl = gsap.timeline();
    tlRef.current = tl;

    const enter = () => {
      if (exitingRef.current) return;
      handleEnter();
    };

    if (reducedMotion || seen) {
      // 二次启动 / 降级：静态终态 + 短暂展示后自动进入
      tl.set(noiseRef.current, { opacity: seen ? 0.3 : 0.15 })
        .set(logoWrapRef.current, { opacity: 1, scale: 1, filter: "blur(0px)" })
        .set([ring1Ref.current, ring2Ref.current, ring3Ref.current], { opacity: 0 })
        .set(wordmarkRef.current, { opacity: 1, y: 0 })
        .set(signalRef.current, { opacity: 1, scaleX: 1 })
        .set(dialRef.current, { opacity: 0.6 })
        .set(pointerRef.current, { opacity: 0 })
        .set(subRef.current, { opacity: 0.7 })
        .to(enterRef.current, { opacity: 1, y: 0, duration: 0.3, delay: 0.2 })
        .add(() => setReady(true), "+=0.1")
        .add(enter, "+=0.5"); // 约 1.0s 后自动进入
      return;
    }

    // ===== 首启动：完整电台唤醒 =====
    tl.to(noiseRef.current,
        { opacity: 0.15, duration: 1.4, ease: "power2.out" }, 0.4)            // B 噪点退去
      .to(starfieldRef.current,
        { opacity: 1, duration: 1.2, ease: "power2.out" }, 0.3)               // B 星河显形
      .to(dialRef.current,
        { opacity: 0.7, duration: 0.6, ease: "power2.out" }, 0.5)             // B 刻度尺淡入
      .fromTo(pointerRef.current,
        { opacity: 0, left: "0%" },
        { opacity: 1, left: "100%", duration: 1.4, ease: "power1.inOut" }, 0.5) // B→C 扫频 88→108
      .fromTo(logoWrapRef.current,
        { opacity: 0, scale: 0.6, filter: "blur(12px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.0, ease: "power3.out" }, 0.6) // B Logo 聚焦
      .fromTo(ring1Ref.current,
        { scale: 0.3, opacity: 0 },
        { scale: 1.4, opacity: 0, duration: 1.2, ease: "power2.out" }, 1.0)   // B 第 1 圈电波
      .fromTo(ring2Ref.current,
        { scale: 0.3, opacity: 0 },
        { scale: 1.4, opacity: 0, duration: 1.2, ease: "power2.out" }, 1.4)   // C 第 2 圈电波
      .fromTo(ring3Ref.current,
        { scale: 0.3, opacity: 0 },
        { scale: 1.4, opacity: 0, duration: 1.2, ease: "power2.out" }, 1.7)   // C 第 3 圈电波
      .fromTo(wordmarkRef.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 1.9)          // C wordmark
      .to(signalRef.current,
        { opacity: 1, scaleX: 1, duration: 0.4, ease: "power2.out" }, 2.0)     // C 信号线点亮
      .fromTo(subRef.current,
        { opacity: 0, y: 6 },
        { opacity: 0.7, y: 0, duration: 0.4, ease: "power2.out" }, 2.1)        // C SIGNAL LOCKED
      .fromTo(enterRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 2.4)          // D 进入提示
      .add(() => setReady(true), 2.6)
      .add(enter, 2.8);                                                          // E 自动进入
  }, [seen, reducedMotion]);

  const handleEnter = () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    tlRef.current?.kill();
    try { localStorage.setItem("orangeradio_splash_seen", "1"); } catch { /* ignore */ }
    // 退出动画：整体淡出 + 轻微放大；自动进入走 1.0s，跳过走 0.6s
    const dur = ready ? 1.0 : 0.6;
    gsap.to(rootRef.current, {
      opacity: 0,
      scale: 1.018,
      duration: dur,
      ease: "power2.inOut",
      onComplete: onEnter,
    });
  };

  // Enter / Space 跳过
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleEnter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      className={`splash-overlay ${ready ? "splash-overlay--ready" : ""} ${exiting ? "splash-overlay--exiting" : ""}`}
      onClick={handleEnter}
    >
      {/* Three.js 冷色星河背景（reduced-motion 时不渲染） */}
      {!reducedMotion && (
        <div ref={starfieldRef} className="splash-starfield">
          <SplashStarfield />
        </div>
      )}
      {/* 开机雪花噪点 */}
      <div ref={noiseRef} className="splash-noise" />
      {/* 中央内容 */}
      <div className="splash-content">
        <div className="splash-logo-stage">
          <span ref={ring1Ref} className="splash-wave-ring splash-wave-ring--1" />
          <span ref={ring2Ref} className="splash-wave-ring splash-wave-ring--2" />
          <span ref={ring3Ref} className="splash-wave-ring splash-wave-ring--3" />
          <div ref={logoWrapRef} className="splash-logo">
            <OrangeRadioLogo size={128} animated />
          </div>
        </div>
        <div ref={wordmarkRef} className="splash-wordmark">OrangeRadio</div>
        <div ref={signalRef} className="splash-signal-line">
          <span className="splash-signal-blip" />
        </div>
        <div ref={subRef} className="splash-sub">SIGNAL LOCKED · 信号已锁定</div>
      </div>
      {/* 底部频段刻度尺 */}
      <div ref={dialRef} className="splash-dial">
        <div className="splash-dial-scale">
          <span className="splash-dial-tick">88</span>
          <span className="splash-dial-tick">92</span>
          <span className="splash-dial-tick">96</span>
          <span className="splash-dial-tick">100</span>
          <span className="splash-dial-tick">104</span>
          <span className="splash-dial-tick splash-dial-tick--active">108</span>
          <span className="splash-dial-unit">MHz</span>
        </div>
        <div ref={pointerRef} className="splash-dial-pointer" />
      </div>
      {/* 进入提示 */}
      <div ref={enterRef} className="splash-enter">正在进入 · Press Enter 跳过</div>
    </div>
  );
}
