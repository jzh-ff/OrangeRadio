import { useState, useRef, useEffect } from "react";
import { usePlayerStore, type ColorTheme } from "../../stores/playerStore";
import {
  loadArchives, createArchive, saveArchive, renameArchive, removeArchive,
  applyArchive, exportArchive, importArchiveFromFile, type FxArchive,
} from "../../lib/fxArchive";
import { WallpaperPicker } from "../../components/WallpaperPicker";

/**
 * DIY 视觉控制台（对标 MineRadio #fx-panel，5 tab 垂直面板）
 *
 * Tab：预设 / 动态 / 外观 / 歌词 / 高级
 * 鼠标移开 3 秒自动隐藏。所有参数写入 playerStore.visualParams + localStorage。
 *
 * MVP 说明：存档系统（fxArchive.ts）+ 热键系统（hotkeys.ts）+ 颜色选择器弹层
 * 为 P11 子项，作为 v0.4+ 延后；当前先做 5 tab 框架 + fx 参数控件 + preset 选择器。
 */

type Tab = "presets" | "motion" | "appearance" | "lyrics" | "advanced";

const TABS: { id: Tab; name: string }[] = [
  { id: "presets", name: "预设" },
  { id: "motion", name: "动态" },
  { id: "appearance", name: "外观" },
  { id: "lyrics", name: "歌词" },
  { id: "advanced", name: "高级" },
];

const THEMES: { id: ColorTheme; name: string; colors: string[] }[] = [
  { id: "orange", name: "橙焰", colors: ["#ff3d00", "#ff6b1a", "#ffaa44"] },
  { id: "purple", name: "电紫", colors: ["#6a1b9a", "#ab47bc", "#e040fb"] },
  { id: "ocean", name: "深海", colors: ["#006064", "#00bcd4", "#4dd0e1"] },
  { id: "aurora", name: "极光", colors: ["#00c853", "#64dd17", "#b9f6ca"] },
  { id: "auto", name: "封面主色", colors: ["#ff6b1a", "#ff9d45", "#ffc685"] },
];

const PRESETS: { id: number; name: string; desc: string; icon: string }[] = [
  { id: 0, name: "默认封面", desc: "封面粒子 · 快速入场", icon: "◉" },
  { id: 1, name: "滚筒隧道", desc: "隧道 · 沉浸感", icon: "◎" },
  { id: 2, name: "星河", desc: "壁纸粒子 · 音乐律动", icon: "✦" },
  { id: 3, name: "唱片", desc: "唱片 · 圆形封面", icon: "◐" },
];

export function VisualConsole() {
  const visualParams = usePlayerStore((s) => s.visualParams);
  const setVisualParams = usePlayerStore((s) => s.setVisualParams);
  const setSubView = usePlayerStore((s) => s.setSubView);
  const setFullPlayer = usePlayerStore((s) => s.setFullPlayer);
  const [tab, setTab] = useState<Tab>("motion");
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<number>(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [archives, setArchives] = useState<FxArchive[]>(() => loadArchives());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const refreshArchives = () => setArchives(loadArchives());
  const handleCreate = () => {
    const name = window.prompt("存档名称", `存档 ${archives.length + 1}`);
    if (name === null) return;
    createArchive(name);
    refreshArchives();
  };
  const handleRename = (id: string) => {
    renameArchive(id, renameValue);
    setRenamingId(null);
    refreshArchives();
  };
  const handleImport = async () => {
    importInputRef.current?.click();
  };
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const arc = await importArchiveFromFile(file);
      if (arc) refreshArchives();
    }
    e.target.value = "";
  };

  // 上传壁纸见侧边栏「壁纸」页；此处保留快捷入口
  const openWallpaperPage = () => {
    setFullPlayer(false);
    setSubView("wallpaper");
  };

  const onActivity = () => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), 3000);
  };

  useEffect(() => {
    onActivity();
    return () => window.clearTimeout(hideTimer.current);
  }, []);

  const reset = () => {
    // 恢复默认（保留 colorTheme + cameraShake，重置 fx 参数）
    setVisualParams({
      intensity: 0.85, depth: 1.0, coverResolution: 1.0, cinemaShake: 0.5,
      pointSize: 1.0, speed: 1.0, twist: 0, colorTension: 1.1, scatter: 0, bgFade: 0.2,
    });
  };

  return (
    <div
      className={`vc-panel ${visible ? "vc-panel--visible" : ""}`}
      onMouseMove={onActivity}
      onMouseEnter={onActivity}
    >
      <div className="vc-panel__head">
        <span className="vc-panel__title">视觉控制台</span>
        <button
          className="vc-hotkey-btn"
          onClick={() => usePlayerStore.getState().setHotkeysModalOpen(true)}
          title="热键设置"
        >热键</button>
      </div>

      {/* Tab 条 */}
      <div className="vc-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`vc-tab ${tab === t.id ? "vc-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="vc-tab-content">
        {/* ===== 预设 tab ===== */}
        {tab === "presets" && (
          <div className="vc-section">
            <div className="vc-section__title">预设</div>
            <div className="vc-preset-grid">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`vc-preset-card ${visualParams.preset === p.id ? "vc-preset-card--active" : ""}`}
                  onClick={() => setVisualParams({ preset: p.id })}
                  title={p.desc}
                >
                  <span className="vc-preset-card__icon">{p.icon}</span>
                  <span className="vc-preset-card__name">{p.name}</span>
                </button>
              ))}
            </div>
            <div className="vc-section__title vc-section__title--sub">用户存档</div>
            <div className="vc-archive-actions">
              <button className="vc-archive-btn" onClick={handleCreate}>+ 新建</button>
              <button className="vc-archive-btn" onClick={handleImport}>导入</button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                style={{ display: "none" }}
              />
            </div>
            {archives.length === 0 ? (
              <div className="vc-archive-empty">暂无存档，点「新建」保存当前视觉参数</div>
            ) : (
              <div className="vc-archive-list">
                {archives.map((a) => (
                  <div key={a.id} className="vc-archive-item">
                    {renamingId === a.id ? (
                      <input
                        className="vc-archive-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRename(a.id)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleRename(a.id); }}
                        autoFocus
                      />
                    ) : (
                      <div className="vc-archive-item__name">{a.name}</div>
                    )}
                    <div className="vc-archive-item__time">
                      {new Date(a.savedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="vc-archive-item__actions">
                      <button className="vc-archive-mini" onClick={() => applyArchive(a)} title="应用">应用</button>
                      <button className="vc-archive-mini" onClick={() => { saveArchive(a.id); refreshArchives(); }} title="保存当前参数到该存档">保存</button>
                      <button className="vc-archive-mini" onClick={() => { setRenamingId(a.id); setRenameValue(a.name); }} title="重命名">命名</button>
                      <button className="vc-archive-mini" onClick={() => void exportArchive(a)} title="导出 JSON">导出</button>
                      <button className="vc-archive-mini vc-archive-mini--danger" onClick={() => { removeArchive(a.id); refreshArchives(); }} title="删除">删</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== 动态 tab ===== */}
        {tab === "motion" && (
          <div className="vc-section">
            <div className="vc-section__title">画面基础</div>
            <Slider label="律动强度" value={visualParams.intensity} min={0} max={1.5} step={0.05}
              onChange={(v) => setVisualParams({ intensity: v })} />
            <Slider label="画面景深" value={visualParams.depth} min={0} max={2} step={0.05}
              onChange={(v) => setVisualParams({ depth: v })} />
            <Slider label="封面清晰度" value={visualParams.coverResolution} min={0.5} max={2} step={0.05}
              onChange={(v) => setVisualParams({ coverResolution: v })} />
            <Slider label="电影镜头" value={visualParams.cinemaShake} min={0} max={1} step={0.05}
              onChange={(v) => setVisualParams({ cinemaShake: v })} />
            <div className="vc-section__title vc-section__title--sub">镜头与叠加</div>
            <div className="vc-toggle-grid">
              <Toggle label="电影镜头" on={visualParams.cinema} onClick={() => setVisualParams({ cinema: !visualParams.cinema })} />
              <Toggle label="粒子溢光" on={visualParams.bloom} onClick={() => setVisualParams({ bloom: !visualParams.bloom })} />
              <Toggle label="轮廓高亮" on={visualParams.edge} onClick={() => setVisualParams({ edge: !visualParams.edge })} />
              <Toggle label="镜头晃动" on={visualParams.cameraShake} onClick={() => setVisualParams({ cameraShake: !visualParams.cameraShake })} />
            </div>
          </div>
        )}

        {/* ===== 外观 tab ===== */}
        {tab === "appearance" && (
          <div className="vc-section">
            <div className="vc-section__title">颜色主题</div>
            <div className="vc-themes">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`vc-theme-btn ${visualParams.colorTheme === t.id ? "vc-theme-btn--active" : ""}`}
                  onClick={() => setVisualParams({ colorTheme: t.id })}
                  title={t.name}
                >
                  <span className="vc-theme-dots">
                    {t.colors.map((c) => <span key={c} className="vc-theme-dot" style={{ background: c }} />)}
                  </span>
                  <span className="vc-theme-name">{t.name}</span>
                </button>
              ))}
            </div>
            <div className="vc-section__title vc-section__title--sub">界面与背景</div>
            <Slider label="背景压暗" value={visualParams.bgFade} min={0} max={1} step={0.05}
              onChange={(v) => setVisualParams({ bgFade: v })} />
            <Slider label="节拍灵敏度" value={visualParams.sensitivity} min={0.5} max={3} step={0.1}
              onChange={(v) => setVisualParams({ sensitivity: v })} />
            <Slider label="辉光强度" value={visualParams.bloomStrength} min={0} max={3} step={0.1}
              onChange={(v) => setVisualParams({ bloomStrength: v })} />
            <div className="vc-section__title vc-section__title--sub">壁纸</div>
            <WallpaperPicker compact />
            <button type="button" className="vc-wallpaper-link" onClick={openWallpaperPage}>
              打开壁纸管理页 →
            </button>
          </div>
        )}

        {/* ===== 歌词 tab ===== */}
        {tab === "lyrics" && (
          <div className="vc-section">
            <div className="vc-section__title">歌词开关</div>
            <div className="vc-toggle-grid">
              <Toggle label="歌词溢光" on={visualParams.lyricGlow} onClick={() => setVisualParams({ lyricGlow: !visualParams.lyricGlow })} />
              <Toggle label="鼓点溢光" on={visualParams.lyricGlowBeat} onClick={() => setVisualParams({ lyricGlowBeat: !visualParams.lyricGlowBeat })} />
            </div>
            <div className="vc-section__title vc-section__title--sub">文字颜色</div>
            <div className="vc-archive-empty">颜色选择器 + AUTO 封面取色开发中（v0.4+）</div>
          </div>
        )}

        {/* ===== 高级 tab ===== */}
        {tab === "advanced" && (
          <div className="vc-section">
            <div className="vc-section__title">粒子高级参数</div>
            <Slider label="粒子数量" value={visualParams.particleCount} min={1000} max={15000} step={500}
              onChange={(v) => setVisualParams({ particleCount: v })} fmt={(v) => `${(v / 1000).toFixed(1)}k`} />
            <Slider label="粒子尺寸" value={visualParams.pointSize} min={0.3} max={3} step={0.1}
              onChange={(v) => setVisualParams({ pointSize: v })} />
            <Slider label="运动速度" value={visualParams.speed} min={0} max={3} step={0.1}
              onChange={(v) => setVisualParams({ speed: v })} />
            <Slider label="粒子扭曲" value={visualParams.twist} min={0} max={2} step={0.05}
              onChange={(v) => setVisualParams({ twist: v })} />
            <Slider label="色彩张力" value={visualParams.colorTension} min={0} max={2} step={0.05}
              onChange={(v) => setVisualParams({ colorTension: v })} />
            <Slider label="离散感" value={visualParams.scatter} min={0} max={2} step={0.05}
              onChange={(v) => setVisualParams({ scatter: v })} />
            <button className="vc-reset-btn" onClick={reset}>恢复默认</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 滑块行 */
function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  return (
    <div className="vc-row">
      <label className="vc-label">{label}</label>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="vc-slider"
      />
      <span className="vc-value">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </div>
  );
}

/** Toggle 按钮 */
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`vc-toggle-btn ${on ? "vc-toggle-btn--on" : ""}`} onClick={onClick}>
      <span className="vc-toggle-btn__dot" />
      <span className="vc-toggle-btn__label">{label}</span>
    </button>
  );
}
