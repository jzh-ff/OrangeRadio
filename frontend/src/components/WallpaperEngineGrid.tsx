import { useEffect, useMemo, useRef, useState } from "react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { useWallpaperStore } from "../stores/wallpaperStore";
import {
  weFileUrl, weKindLabel, formatSize, type WeKind, type WallpaperEngineEntry,
} from "../lib/wallpaperEngine";
import { toWebviewUrl } from "../lib/webviewUrl";
import type { Wallpaper } from "../stores/wallpaperStore";
import "./wallpaper-engine.css";

const KIND_FILTERS: Array<"all" | WeKind> = ["all", "video", "picture", "scene", "web", "unknown"];

/** Wallpaper Engine 扫描结果网格:工具栏(过滤/搜索/添加目录)+ 卡片网格(懒加载预览) */
export function WallpaperEngineGrid() {
  const entries = useWallpaperStore((s) => s.engineEntries);
  const scanning = useWallpaperStore((s) => s.engineScanning);
  const engineDirs = useWallpaperStore((s) => s.engineDirs);
  const scan = useWallpaperStore((s) => s.scanWallpaperEngine);
  const addEngineDir = useWallpaperStore((s) => s.addEngineDir);
  const addWallpaper = useWallpaperStore((s) => s.addWallpaper);
  const setActive = useWallpaperStore((s) => s.setActive);

  const [filter, setFilter] = useState<"all" | WeKind>("all");
  const [query, setQuery] = useState("");

  useEffect(() => { void scan(); }, [scan]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) => (filter === "all" || e.kind === filter) && (q === "" || e.title.toLowerCase().includes(q)),
    );
  }, [entries, filter, query]);

  const onAddDir = async () => {
    const selected = await dialogOpen({ directory: true, multiple: false });
    if (typeof selected === "string") {
      addEngineDir(selected);
      void scan();
    }
  };

  const onApply = (e: WallpaperEngineEntry) => {
    if (!e.applicable) {
      window.alert(`「${weKindLabel(e.kind)}」类型需 Wallpaper Engine 本体渲染,暂仅浏览`);
      return;
    }
    const raw = weFileUrl(e.source_dir, e.file);
    const w: Wallpaper = {
      id: `we-${e.workshop_id}`,
      name: e.title,
      type: e.kind === "video" ? "video" : "image",
      src: toWebviewUrl(raw),
      builtin: false,
      addedAt: Date.now(),
    };
    addWallpaper(w);
    setActive(w.id);
  };

  return (
    <div className="we-grid">
      <div className="we-grid__bar">
        <select value={filter} onChange={(ev) => setFilter(ev.target.value as "all" | WeKind)}>
          {KIND_FILTERS.map((k) => (
            <option key={k} value={k}>{k === "all" ? "全部" : weKindLabel(k)}</option>
          ))}
        </select>
        <input
          className="we-grid__search"
          placeholder="搜索标题..."
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
        <button type="button" onClick={() => void scan()} disabled={scanning}>
          {scanning ? "扫描中..." : "重新检测"}
        </button>
        <button type="button" onClick={() => void onAddDir()}>添加目录</button>
      </div>
      <div className="we-grid__dirs">
        扫描目录:{engineDirs.length > 0 ? engineDirs.join(" | ") : "未配置(将自动发现)"}
      </div>
      {scanning && entries.length === 0 ? (
        <div className="we-grid__empty">扫描中...</div>
      ) : filtered.length === 0 ? (
        <div className="we-grid__empty">未找到 Wallpaper Engine 壁纸。点「添加目录」手动指定。</div>
      ) : (
        <div className="we-grid__list">
          {filtered.map((e) => (
            <WeCard key={e.workshop_id} entry={e} onApply={() => onApply(e)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单卡片:预览图懒加载 + 名字 + 格式色标 + 大小 */
function WeCard({ entry, onApply }: { entry: WallpaperEngineEntry; onApply: () => void }) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([it]) => { if (it.isIntersecting) { setVisible(true); io.disconnect(); } },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const previewRel = entry.preview ?? (entry.kind === "picture" ? entry.file : null);
  const imgSrc = previewRel ? toWebviewUrl(weFileUrl(entry.source_dir, previewRel)) : null;
  const kindCls = `we-card__kind we-card__kind--${entry.kind}`;

  return (
    <button type="button" className="we-card" onClick={onApply} title={entry.title}>
      <div className="we-card__cover" ref={ref as React.RefObject<HTMLDivElement>}>
        {visible && imgSrc ? (
          <img src={imgSrc} alt={entry.title} loading="lazy" />
        ) : (
          <div className="we-card__placeholder">{entry.applicable ? "" : "仅浏览"}</div>
        )}
      </div>
      <span className={kindCls}>{weKindLabel(entry.kind)}</span>
      <span className="we-card__name">{entry.title}</span>
      <span className="we-card__size">{formatSize(entry.size_bytes)}</span>
    </button>
  );
}
