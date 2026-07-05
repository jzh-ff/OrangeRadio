import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import type { Track } from "../stores/libraryStore";
import "../styles/library.css";

/**
 * 统一歌曲行（消除 9 处视图重复的 col-i 序号/eq-bars/play-hover 逻辑）。
 *
 * - col-i（序号/播放图标/eq-bars）由本组件统一渲染（受 active + isPlaying 驱动）
 * - 其余列（title/artist/album/dur + 封面/徽章/操作按钮）通过 children 传入，各视图自定义
 * - 行高固定 48px（library.css:141），匹配 react-window FixedSizeList
 *
 * 两种用法：
 *   1. 直接渲染单行（非虚拟化场景）：`<TrackRow track={t} index={i} active onPlay={fn}>{列内容}</TrackRow>`
 *   2. 虚拟化列表：用 <VirtualTrackList>（见下），内部用 FixedSizeList + 本组件
 */
interface TrackRowProps {
  track: Track;
  index: number;           // 原始列表索引（用于显示序号 + onPlay 回传）
  active: boolean;         // 是否当前播放
  isPlaying: boolean;      // 是否正在播放（驱动 eq-bars）
  onPlay: (track: Track, index: number) => void;
  children?: ReactNode;    // title/artist/album/dur 列内容（由调用方自定义）
  style?: CSSProperties;   // react-window 注入的绝对定位
  cols?: 4 | 5;            // 列数（5 默认含专辑列；4 无专辑列，用于歌曲宝/电台）
}

export function TrackRow({ track, index, active, isPlaying, onPlay, children, style, cols = 5 }: TrackRowProps) {
  return (
    <div
      style={style}
      className={`lib-row ${active ? "lib-row--active" : ""} ${cols === 4 ? "cols-4" : ""}`}
      onDoubleClick={() => onPlay(track, index)}
    >
      <span className="col-i">
        {active && isPlaying ? (
          <span className="eq-bars"><i></i><i></i><i></i></span>
        ) : (
          <>
            <span className="idx">{index + 1}</span>
            <svg className="play-hover" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </>
        )}
      </span>
      {children}
    </div>
  );
}

/**
 * 虚拟化歌曲列表（基于 react-window FixedSizeList）。
 *
 * - 自动测量父容器高度（ResizeObserver），无需调用方算 calc(100vh - X)
 * - 行高固定 48px（.lib-row）
 * - 每行通过 renderRow(track, index) 渲染列内容（不含 col-i，col-i 由 TrackRow 处理）
 *
 * 用法：
 *   <VirtualTrackList
 *     tracks={tracks}
 *     activeId={currentTrack?.id}
 *     isPlaying={isPlaying}
 *     onPlay={(t,i) => engineRef.playTrack(t, i)}
 *     renderRow={(t) => (<>
 *       <span className="col-title">...</span>
 *       <span className="col-artist">{t.meta.artist}</span>
 *       <span className="col-album">{t.meta.album}</span>
 *       <span className="col-dur">{fmt(t.meta.duration_secs)}</span>
 *     </>)}
 *   />
 */
interface VirtualTrackListProps {
  tracks: Track[];
  activeId?: string;
  isPlaying: boolean;
  onPlay: (track: Track, index: number) => void;
  /** 渲染 title/artist/album/dur 列（不含 col-i） */
  renderRow: (track: Track, index: number) => ReactNode;
  /** 列数：5（默认，含专辑列）| 4（无专辑列，歌曲宝/电台） */
  cols?: 4 | 5;
  /** 列表高度，不传则自动测量父容器（lib-rows 区域） */
  height?: number;
  /** className 附加到外层 */
  className?: string;
  /** react-window onItemsRendered（无限滚动用） */
  onItemsRendered?: (props: { visibleStartIndex: number; visibleStopIndex: number; overscanStartIndex: number; overscanStopIndex: number }) => void;
}

const ROW_HEIGHT = 48;

export function VirtualTrackList({
  tracks,
  activeId,
  isPlaying,
  onPlay,
  renderRow,
  cols = 5,
  height,
  className,
  onItemsRendered,
}: VirtualTrackListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoHeight, setAutoHeight] = useState(height ?? 400);

  useEffect(() => {
    if (height !== undefined) return; // 调用方显式指定则不测
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.parentElement?.clientHeight ?? el.clientHeight;
      if (h > 0) setAutoHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    else ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  const Row = ({ index, style }: ListChildComponentProps) => {
    const t = tracks[index];
    const active = !!activeId && activeId === t.id;
    return (
      <TrackRow track={t} index={index} active={active} isPlaying={isPlaying} onPlay={onPlay} style={style} cols={cols}>
        {renderRow(t, index)}
      </TrackRow>
    );
  };

  return (
    <div ref={containerRef} className={className} style={{ height: height ?? autoHeight }}>
      <List
        height={height ?? autoHeight}
        itemCount={tracks.length}
        itemSize={ROW_HEIGHT}
        width="100%"
        overscanCount={8}
        onItemsRendered={onItemsRendered}
      >
        {Row}
      </List>
    </div>
  );
}
