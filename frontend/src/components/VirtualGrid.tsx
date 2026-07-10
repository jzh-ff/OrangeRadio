import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";

interface GridRowData {
  /** 该行在 itemData 中的索引（即行号，0-based） */
  rowIndex: number;
  columns: number;
  items: unknown[];
  // 渲染单格的函数指针，由 VirtualGrid 在 useMemo 中通过 this 注入
  renderCell: (item: unknown, index: number) => ReactNode;
}

/** itemData 的类型：整个行数组（FixedSizeList 的 itemData 传入） */
type GridRows = GridRowData[];

interface VirtualGridProps<T> {
  items: T[];
  width?: number;
  columnWidth: number;
  rowHeight: number;
  maxColumns?: number;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * 磁带墙风格的二维虚拟网格（基于 react-window FixedSizeList）。
 *
 * 原理：把 items 按列数切分为二维数组 rows，react-window 只渲染视口内行 + overscan，
 * 避免大曲库 DOM 爆炸。renderItem 通过 closure 注入到每行数据，避免泛型推导问题。
 */
export function VirtualGrid<T>(props: VirtualGridProps<T>) {
  const {
    items,
    width,
    columnWidth,
    rowHeight,
    maxColumns = 8,
    renderItem,
    className,
    style,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(1);
  const [autoHeight, setAutoHeight] = useState(400);
  const [containerWidth, setContainerWidth] = useState(width ?? 0);

  useEffect(() => {
    if (!containerRef.current) return;
    let raf = 0;
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.clientWidth;
      if (w > 0) {
        const c = Math.max(1, Math.min(maxColumns, Math.floor(w / columnWidth)));
        setColumns(c);
        setContainerWidth(w);
      }
      const h = el.parentElement?.clientHeight ?? el.clientHeight;
      if (h > 0) {
        setAutoHeight(h);
      } else {
        // 首次渲染父容器可能尚未布局完成（高度为 0），下一帧重试一次
        raf = requestAnimationFrame(measure);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [columnWidth, maxColumns]);

  const renderCell = useMemo(
    () => (item: unknown, index: number) => renderItem(item as T, index),
    [renderItem]
  );

  const itemData = useMemo<GridRows>(() => {
    const out: GridRowData[] = [];
    let rowIndex = 0;
    for (let i = 0; i < items.length; i += columns) {
      out.push({
        rowIndex,
        columns,
        items: items.slice(i, i + columns),
        renderCell,
      });
      rowIndex += 1;
    }
    return out;
  }, [items, columns, renderCell]);

  return (
    <div ref={containerRef} className={className} style={style}>
      <FixedSizeList
        height={autoHeight}
        itemCount={itemData.length}
        itemSize={rowHeight}
        width={width ?? containerWidth}
        itemData={itemData}
        overscanCount={4}
      >
        {VirtualGridRow}
      </FixedSizeList>
    </div>
  );
}

const VirtualGridRow = memo(function VirtualGridRow(
  props: ListChildComponentProps<GridRows>
) {
  const { index, style, data } = props;
  const row = data[index];
  return (
    <div
      style={{
        ...style,
        display: "grid",
        gridTemplateColumns: `repeat(${row.columns}, 1fr)`,
        gap: 16,
        paddingInline: 16,
      }}
    >
      {row.items.map((item, col) => (
        <div key={col} style={{ minWidth: 0 }}>
          {row.renderCell(item, row.rowIndex * row.columns + col)}
        </div>
      ))}
    </div>
  );
});
