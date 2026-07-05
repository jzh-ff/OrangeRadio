import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import "./splash.css";

interface SplashProps {
  /** 用户点击/Enter 进入主界面时触发 */
  onEnter: () => void;
  /** 主界面内容（splash 退出后渲染） */
  children?: React.ReactNode;
}

/**
 * 启动页 Splash（对标 MineRadio #splash）
 *
 * 动画编排（GSAP timeline）：
 *   0-1.4s  Orange 词 clip-path 揭示 + skewX 入场
 *   1.4-2.6s Radio 词从右侧滑入 + 冷色渐变填充
 *   2.6-3.2s i 点弹出 + 信号线扫光
 *   3.2s+   ready 状态，"点击进入"脉冲
 *
 * 二次启动：localStorage `orangeradio_splash_seen` 跳过动画，仅显示 0.5s 静态 splash。
 */
export function Splash({ onEnter, children }: SplashProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLSpanElement>(null);
  const radioRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const signalRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<HTMLDivElement>(null);
  const [exiting, setExiting] = useState(false);
  const [ready, setReady] = useState(false);
  const seen = (() => {
    try { return localStorage.getItem("orangeradio_splash_seen") === "1"; } catch { return false; }
  })();

  useEffect(() => {
    // 二次启动：压缩到 0.5s 静态展示后直接 ready
    const tl = gsap.timeline();
    if (seen) {
      tl.set(orangeRef.current, { opacity: 1, clipPath: "inset(0)" })
        .set(radioRef.current, { opacity: 1, clipPath: "inset(0)" })
        .set(dotRef.current, { opacity: 1, scale: 1 })
        .set(signalRef.current, { opacity: 0.3, scaleX: 0.64 })
        .set(subRef.current, { opacity: 0.42 })
        .to(enterRef.current, { opacity: 1, y: 0, duration: 0.3, delay: 0.2 })
        .add(() => setReady(true));
      return;
    }
    // 首启动：完整动画
    tl.fromTo(orangeRef.current,
        { opacity: 0, clipPath: "inset(48% 0 49% 0)" },
        { opacity: 1, clipPath: "inset(0% 0% 0% 0%)", duration: 1.0, ease: "power3.out" })
      .fromTo(radioRef.current,
        { opacity: 0, clipPath: "inset(52% 0 44% 0)", x: 30 },
        { opacity: 1, clipPath: "inset(0% 0% 0% 0%)", x: 0, duration: 1.0, ease: "power3.out" }, "-=0.6")
      .fromTo(dotRef.current,
        { opacity: 0, scale: 0.3, y: 8 },
        { opacity: 1, scale: 1.12, y: 0, duration: 0.3, ease: "back.out(2)" }, "-=0.3")
      .to(dotRef.current, { scale: 1, duration: 0.15 })
      .fromTo(signalRef.current,
        { opacity: 0, scaleX: 0.1 },
        { opacity: 1, scaleX: 1.14, duration: 0.5, ease: "power2.out" }, "-=0.2")
      .to(signalRef.current, { opacity: 0.3, scaleX: 0.64, duration: 0.6, ease: "power2.in" })
      .fromTo(subRef.current,
        { opacity: 0, y: 7 },
        { opacity: 0.42, y: 0, duration: 0.5, ease: "power2.out" }, "-=0.4")
      .fromTo(enterRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" })
      .add(() => setReady(true));
  }, [seen]);

  const handleEnter = () => {
    if (!ready || exiting) return;
    setExiting(true);
    try { localStorage.setItem("orangeradio_splash_seen", "1"); } catch { /* ignore */ }
    // 退出动画：整体淡出 + 轻微放大
    gsap.to(rootRef.current, {
      opacity: 0,
      scale: 1.018,
      duration: 1.0,
      ease: "power2.inOut",
      onComplete: onEnter,
    });
  };

  // Enter 键进入
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") handleEnter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, exiting]);

  return (
    <>
      <div
        ref={rootRef}
        className={`splash-overlay ${ready ? "splash-overlay--ready" : ""} ${exiting ? "splash-overlay--exiting" : ""}`}
        onClick={handleEnter}
      >
        <div className="splash-noise" />
        <div className="splash-content">
          <div className="splash-wordmark">
            <span ref={orangeRef} className="splash-word splash-word--orange">Orange</span>
            <span ref={dotRef} className="splash-word-i">i</span>
            <span ref={radioRef} className="splash-word splash-word--radio">Radio</span>
          </div>
          <div ref={signalRef} className="splash-signal-line">
            <span className="splash-signal-blip" />
          </div>
          <div ref={subRef} className="splash-sub">PRIVATE VISUAL RADIO</div>
          <div ref={enterRef} className="splash-enter">点击进入 · Press Enter</div>
        </div>
      </div>
      {/* 主界面在 splash 退出后由父组件控制挂载；此处不渲染 children，由 main.tsx 控制 */}
    </>
  );
}
