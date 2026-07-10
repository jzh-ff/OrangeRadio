/**
 * FullPlayer 右侧工具抽屉
 *
 * 交互模型（点击钉住为主，hover 预览为辅）：
 * - 屏幕最右侧垂直居中的胶囊悬浮按钮，点击切换 开/关（钉住态）。
 * - 钉住打开后，鼠标离开不会自动收回 —— 调参时不会误关。
 * - 未钉住时，鼠标 hover 按钮区可预览展开（移出 250ms 收回），
 *   一旦点过按钮进入 pinned 态，hover 不再影响开合。
 *
 * 收纳四件套：播放布局 / 播放模式 / AI 译注 / 视觉控制台。
 */
import { useEffect, useRef, useState } from "react";
import { usePlayerStore, type PlaybackMode, type FullLayout } from "../../stores/playerStore";
import { VisualConsole } from "./VisualConsole";
import { MODE_LABELS, MODE_SVG, MODE_ORDER } from "./playbackModes";
import { LAYOUT_OPTIONS } from "./layoutOptions";
import "../../styles/right-drawer.css";

interface Props {
  /** 译注 handler（FullPlayer 内部状态） */
  onAnnotate: () => void;
  /** 译注 loading 态 */
  annotateLoading: boolean;
  /** 当前播放布局（FullPlayer 头部展示用，drawer 内渲染切换面板） */
  fullLayout: FullLayout;
  /** 切换布局 setter */
  setFullLayout: (l: FullLayout) => void;
}

export function FullPlayerRightDrawer({ onAnnotate, annotateLoading, fullLayout, setFullLayout }: Props) {
  const [open, setOpen] = useState(false);
  /** pinned：是否被点击钉住。pinned 态下 hover 不再自动收回 */
  const [pinned, setPinned] = useState(false);
  const hoverTimer = useRef(0);
  const mode = usePlayerStore((s) => s.mode);
  const setMode = usePlayerStore((s) => s.setMode);

  /** 悬浮按钮点击：切换钉住态 */
  const togglePinned = () => {
    // 清掉残留的 hover 定时器，避免刚钉住就被 pending 的收回定时器关闭
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = 0;
    }
    const nextPinned = !pinned;
    setPinned(nextPinned);
    setOpen(nextPinned);
  };

  /** hover 预览：仅未钉住时生效 */
  const onHoverEnter = () => {
    if (pinned) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    setOpen(true);
  };
  const onHoverLeave = () => {
    if (pinned) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpen(false), 250);
  };

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  }, []);

  const cycleMode = () => {
    const idx = MODE_ORDER.indexOf(mode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    setMode(next);
  };

  return (
    <div
      className={`fp-rd ${open ? "fp-rd--open" : ""}`}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      {/* 悬浮按钮：屏幕最右侧垂直居中，点击切换钉住，箭头随开合翻转 */}
      <button
        type="button"
        className={`fp-rd__fab ${open ? "fp-rd__fab--open" : ""}`}
        onClick={togglePinned}
        aria-label={open ? "收起工具抽屉" : "展开工具抽屉"}
        aria-expanded={open}
        title={open ? "收起工具抽屉" : "展开工具抽屉"}
      >
        <span className="fp-rd__fab-arrow" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </span>
        <span className="fp-rd__fab-label" aria-hidden>{"工具"}</span>
      </button>

      {/* 抽屉本体：360px 宽，玻璃深色面板 */}
      <aside className="fp-rd__panel" role="complementary" aria-label="工具抽屉">
        <div className="fp-rd__head">
          <span className="fp-rd__eyebrow">TOOLBOX</span>
          <span className="fp-rd__title">工具抽屉</span>
        </div>

        {/* ===== Section 1 · 播放布局（4 选 1，原 header 的 ▦ 电影 ▾ 下拉） ===== */}
        <section className="fp-rd__section">
          <div className="fp-rd__sec-head">
            <span className="fp-rd__sec-title">播放布局</span>
            <span className="fp-rd__sec-hint">
              当前 {LAYOUT_OPTIONS.find((o) => o.id === fullLayout)?.short}
            </span>
          </div>
          <div className="fp-rd__layout-grid" role="radiogroup" aria-label="播放布局">
            {LAYOUT_OPTIONS.map((o) => {
              const active = fullLayout === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`fp-rd__layout-item ${active ? "is-active" : ""}`}
                  onClick={() => setFullLayout(o.id)}
                  title={o.hint}
                >
                  <span className="fp-rd__layout-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d={o.icon} />
                    </svg>
                  </span>
                  <span className="fp-rd__layout-name">{o.short}</span>
                  <span className="fp-rd__layout-hint">{o.hint}</span>
                  {active && (
                    <span className="fp-rd__layout-check" aria-hidden>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* ===== Section 2 · 播放模式 ===== */}
        <section className="fp-rd__section">
          <div className="fp-rd__sec-head">
            <span className="fp-rd__sec-title">播放模式</span>
            <span className="fp-rd__sec-hint">点击切换 · 当前 {MODE_LABELS[mode]}</span>
          </div>
          <button
            type="button"
            className="fp-rd__mode-btn"
            onClick={cycleMode}
            title={`当前：${MODE_LABELS[mode]}（点击切换）`}
            aria-label={`播放模式：${MODE_LABELS[mode]}`}
          >
            <span className={`fp-rd__mode-icon ${mode === "understand_you" ? "is-active" : ""}`}>
              {MODE_SVG[mode]}
            </span>
            <span className="fp-rd__mode-text">
              <span className="fp-rd__mode-name">{MODE_LABELS[mode]}</span>
              <span className="fp-rd__mode-sub">{MODE_HINT[mode]}</span>
            </span>
            <span className="fp-rd__mode-cycle" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M3 21v-5h5" />
              </svg>
            </span>
          </button>
        </section>

        {/* ===== Section 3 · AI 译注 ===== */}
        <section className="fp-rd__section">
          <div className="fp-rd__sec-head">
            <span className="fp-rd__sec-title">AI 译注</span>
            <span className="fp-rd__sec-hint">点击对当前歌词做 AI 注解</span>
          </div>
          <button
            type="button"
            className="fp-rd__annotate-btn"
            onClick={onAnnotate}
            disabled={annotateLoading}
            title="AI 歌词译注"
          >
            <span className="fp-rd__annotate-icon" aria-hidden>
              {annotateLoading ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="fp-rd__spin">
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5h7" />
                  <path d="M9 3v2c0 4.42-3.13 8-7 8" />
                  <path d="M5 9c0 6 4 9 9 10" />
                  <path d="M14 4h7" />
                  <path d="M17 4l3 8h-6z" transform="translate(-1 0)" />
                </svg>
              )}
            </span>
            <span className="fp-rd__annotate-text">
              <span className="fp-rd__annotate-name">{annotateLoading ? "正在生成译注…" : "AI 歌词译注"}</span>
              <span className="fp-rd__annotate-sub">需要先在设置里配 MiniMax API Key</span>
            </span>
          </button>
        </section>

        {/* ===== Section 4 · 视觉控制台 ===== */}
        <section className="fp-rd__section fp-rd__section--vc">
          <div className="fp-rd__sec-head">
            <span className="fp-rd__sec-title">视觉控制台</span>
            <span className="fp-rd__sec-hint">预设 · 动态 · 外观 · 歌词 · 高级</span>
          </div>
          <div className="fp-rd__vc-host">
            <VisualConsole />
          </div>
        </section>
      </aside>
    </div>
  );
}

/** 模式副标题（hover drawer 里给每个模式加一句释义） */
const MODE_HINT: Record<PlaybackMode, string> = {
  sequence: "播完一首后自动停",
  list_loop: "整张列表循环",
  single_loop: "单曲无限循环",
  shuffle: "随机打乱顺序",
  understand_you: "AI 懂你 · 自动选下一首",
};
