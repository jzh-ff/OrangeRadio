import { type ReactNode } from "react";

/**
 * ConsoleSearch · 深夜电台控制台搜索条
 *
 * 设计语言：
 * - 左侧微调旋钮（聚焦时旋转 45° 模拟调谐）
 * - 底部 hairline 输入框，无硬边框（区别于传统 input）
 * - 右侧两个按钮：「调谐」（搜索/确认）+ 「扫描」（加载/刷新）
 * - 按钮大写间距化（caption 字体 + 0.14em letter-spacing）传达「控制台」感
 *
 * 替换各 View 里的 .library__toolbar + .library__search + .btn-scan/.btn-tune
 */

interface ConsoleSearchProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onSecondary?: () => void;          // 「扫描」按钮：调热门/刷新/扫描本地等
  secondaryLabel?: string;            // 默认 "扫描"
  secondaryDisabled?: boolean;
  submitLabel?: string;               // 主按钮文案，默认 "调谐"（搜索类语义）
  placeholder?: string;
  /** 输入框右侧内嵌装饰（如快捷键提示/计数器） */
  adornment?: ReactNode;
  loading?: boolean;
}

export function ConsoleSearch({
  value,
  onChange,
  onSubmit,
  onSecondary,
  secondaryLabel = "扫描",
  secondaryDisabled = false,
  submitLabel = "调谐",
  placeholder = "搜索关键词、艺人、专辑…",
  adornment,
  loading = false,
}: ConsoleSearchProps) {
  return (
    <div className="console-search">
      {/* 左侧微调旋钮（取代传统放大镜） */}
      <button
        type="button"
        className="console-search__dial"
        aria-label="调谐"
        onClick={onSubmit}
        tabIndex={-1}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="3" x2="12" y2="7" strokeLinecap="round" strokeWidth="2" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" />
        </svg>
      </button>

      {/* 输入框：底部 hairline，无硬边框 */}
      <div className="console-search__field">
        <input
          type="text"
          className="console-search__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
        />
        {adornment && <span className="console-search__adornment">{adornment}</span>}
      </div>

      {/* 右侧控制台按钮组 */}
      <div className="console-search__actions">
        {onSecondary && (
          <button
            type="button"
            className="console-search__btn console-search__btn--ghost"
            onClick={onSecondary}
            disabled={secondaryDisabled || loading}
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          className="console-search__btn console-search__btn--primary"
          onClick={onSubmit}
          disabled={loading}
        >
          {loading ? "调谐中…" : submitLabel}
        </button>
      </div>
    </div>
  );
}