import { useEffect, useRef } from "react";
import type { ListOnItemsRenderedProps } from "react-window";

/**
 * 滚动到底自动加载 hook（双模式）。
 *
 * 模式 A（普通滚动容器）：返回 sentinelRef，放在列表底部 div 上。
 *   const sentinelRef = useInfiniteScroll({ hasMore, loading, onLoadMore });
 *   <div ref={sentinelRef} />
 *
 * 模式 B（react-window 虚拟列表）：返回 onItemsRendered 回调，传给 <List>。
 *   const onItemsRendered = useVirtualInfiniteScroll({ hasMore, loading, onLoadMore });
 *   <List onItemsRendered={onItemsRendered} />
 *
 * 虚拟列表的 IntersectionObserver 哨兵方案不可靠（List 内部自管滚动），
 * 所以虚拟场景用 onItemsRendered 检测"可见项触及底部"。
 */
interface Options {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** 触发预加载的剩余项数（虚拟模式用），默认 8 */
  threshold?: number;
  /** 预加载距离（普通模式用），默认 200px */
  rootMargin?: string;
}

/** 普通滚动容器模式：返回哨兵 ref */
export function useInfiniteScroll({ hasMore, loading, onLoadMore, rootMargin = "200px" }: Options) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          cbRef.current();
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, rootMargin]);

  return sentinelRef;
}

/** react-window 虚拟列表模式：返回 onItemsRendered 回调 */
export function useVirtualInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
  threshold = 8,
}: Options) {
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;
  // 记录已知 itemCount（用 overscanStopIndex 近似，首次渲染后即有值）
  const countRef = useRef(0);

  const onItemsRendered = ({ visibleStopIndex, overscanStopIndex }: ListOnItemsRenderedProps) => {
    countRef.current = Math.max(countRef.current, overscanStopIndex + 1);
    // 可见项末尾接近列表末尾时触发（剩余 ≤ threshold）
    if (hasMore && !loading && countRef.current - visibleStopIndex <= threshold) {
      cbRef.current();
    }
  };

  return onItemsRendered;
}
