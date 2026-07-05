/**
 * OrangeRadio 应用 logo
 *
 * 设计意图：
 * - 中心是一颗带高光的橙子（呼应 brand "Orange"）
 * - 周围三圈半透明的橙→琥珀渐变弧，象征无线电波（呼应 "Radio"）
 * - 单文件 SVG，无外部依赖，可作为封面 fallback / 应用图标 / sidebar 用
 *
 * 用法：
 *   <OrangeRadioLogo size={48} />         // 默认封面 fallback
 *   <OrangeRadioLogo size={24} flat />    // 紧凑（侧栏 / 按钮内）
 *   <OrangeRadioLogo size={64} animated /> // 大尺寸 + 缓慢旋转波纹
 */
export interface OrangeRadioLogoProps {
  /** 渲染尺寸（px），默认 48 */
  size?: number;
  /** 紧凑模式（去掉外圈装饰），默认 false */
  flat?: boolean;
  /** 缓慢旋转（仅外圈波纹），默认 false */
  animated?: boolean;
  /** 自定义 className */
  className?: string;
}

export function OrangeRadioLogo({
  size = 48,
  flat = false,
  animated = false,
  className,
}: OrangeRadioLogoProps) {
  const id = `or-logo-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="OrangeRadio"
    >
      <defs>
        <radialGradient id={`${id}-orange`} cx="38%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fff1bf" />
          <stop offset="35%" stopColor="#ffc685" />
          <stop offset="70%" stopColor="#ff7a1a" />
          <stop offset="100%" stopColor="#c43d00" />
        </radialGradient>
        <linearGradient id={`${id}-wave`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff3d00" />
          <stop offset="100%" stopColor="#ffc685" />
        </linearGradient>
      </defs>
      {/* 外圈波纹（仅非 flat 模式） */}
      {!flat && (
        <g
          style={
            animated
              ? { transformOrigin: "50% 50%", animation: "or-logo-spin 12s linear infinite" }
              : undefined
          }
        >
          <circle cx="50" cy="50" r="46" fill="none" stroke={`url(#${id}-wave)`} strokeWidth="1.5" strokeOpacity="0.22" />
          <circle cx="50" cy="50" r="39" fill="none" stroke={`url(#${id}-wave)`} strokeWidth="1.5" strokeOpacity="0.4" />
          <circle cx="50" cy="50" r="32" fill="none" stroke={`url(#${id}-wave)`} strokeWidth="2" strokeOpacity="0.7" />
        </g>
      )}
      {/* 橙子主体 */}
      <circle cx="50" cy="50" r="24" fill={`url(#${id}-orange)`} />
      {/* 高光 */}
      <ellipse cx="42" cy="42" rx="7" ry="5" fill="#fff" opacity="0.45" transform="rotate(-25 42 42)" />
      {/* 叶柄 + 叶子 */}
      <path d="M50 27 Q53 22 60 22 Q60 28 53 30 Z" fill="#5dbb63" />
      <path d="M50 28 L50 25" stroke="#3d8a45" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}