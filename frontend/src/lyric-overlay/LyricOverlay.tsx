import { useEffect, useRef, useState } from "react";
import { useLyricMotion } from "../features/player/useLyricMotion";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useLyrics } from "../features/player/useLyrics";
import { usePlayerStore } from "../stores/playerStore";
import type { Track } from "../stores/libraryStore";
import {
  saveLyricPos,
  setLyricLock,
  isLyricLocked,
  persistLyricLock,
} from "../lib/lyricWindow";
import "./LyricOverlay.css";

/** 主窗口推过来的播放状态（含节拍强度，驱动悬浮窗呼吸/扫光） */
interface LyricState {
  track: Track | null;
  position: number;
  isPlaying: boolean;
  duration: number;
  beatIntensity?: number;
}

/** 拉歌词，按 source_kind 分发网易云 / QQ / 酷狗 / 酷我 / 歌曲宝 / Spotify跨源；无匹配音源或失败 → 置空 */
async function fetchLyric(
  track: Track,
  setRaw: (s: string | null) => void,
  setTrans: (s: string | null) => void
): Promise<void> {
  const kind = (track as { source_kind?: string }).source_kind;
  const tid = track.source_track_id;
  try {
    let data: { raw_lrc: string | null; translated_lrc: string | null } | null = null;
    // 按音源分发歌词命令，所有命令返回同构 shape { raw_lrc, translated_lrc }
    const cmd =
      kind === "netease_cloud_music" ? "netease_lyric"
      : kind === "qq_music" ? "qqmusic_lyric"
      : kind === "kugou" ? "kugou_lyric"
      : kind === "kuwo" ? "kuwo_lyric"
      : kind === "gequbao" ? "gequbao_lyric"
      : kind === "spotify" ? "spotify_lyric"
      : null;
    if (cmd) {
      // Spotify 走跨源匹配，需要 title + artist 而非 songId
      const params = kind === "spotify"
        ? { title: track.meta?.title || "", artist: track.meta?.artist || "" }
        : { songId: tid };
      data = await invoke<{ raw_lrc: string; translated_lrc: string | null }>(cmd, params);
    } else if ((track.meta as { lyrics?: string | null } | undefined)?.lyrics) {
      data = { raw_lrc: (track.meta as { lyrics?: string | null }).lyrics!, translated_lrc: null };
    }
    setRaw(data?.raw_lrc || null);
    setTrans(data?.translated_lrc || null);
  } catch {
    setRaw(null);
    setTrans(null);
  }
}

/* ------------------------------------------------------------------ *
 * 设置（localStorage 记忆，悬浮窗独立持久化）
 * ------------------------------------------------------------------ */
interface LyricSettings {
  /** 字号系数（0.7 ~ 1.5） */
  scale: number;
  /** 是否显示翻译（双语） */
  showTranslation: boolean;
  /** 主题预设：default / warm / cool / mono */
  theme: "default" | "warm" | "cool" | "mono";
}

const SETTINGS_KEY = "orangeradio_lyric_settings_v1";
const DEFAULT_SETTINGS: LyricSettings = {
  scale: 1,
  showTranslation: true,
  theme: "default",
};

function loadSettings(): LyricSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<LyricSettings>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(s: LyricSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * SVG 图标（零 emoji）
 * ------------------------------------------------------------------ */
const Icons = {
  Prev: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
    </svg>
  ),
  Next: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6v12z" />
    </svg>
  ),
  Play: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  Pause: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ),
  Settings: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Close: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  Drag: (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="3" r="1" />
      <circle cx="8" cy="3" r="1" />
      <circle cx="2" cy="7" r="1" />
      <circle cx="8" cy="7" r="1" />
      <circle cx="2" cy="11" r="1" />
      <circle cx="8" cy="11" r="1" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ *
 * 主题预设
 * ------------------------------------------------------------------ */
const THEMES: Record<LyricSettings["theme"], { primary: string; highlight: string; glow: string; secondary: string; label: string }> = {
  default: { primary: "#f6fdff", highlight: "#ffd9a8", glow: "#9cffdf", secondary: "rgba(246,253,255,0.42)", label: "默认" },
  warm:    { primary: "#fff5e6", highlight: "#ffae5e", glow: "#ffc97a", secondary: "rgba(255,245,230,0.45)", label: "暖橙" },
  cool:    { primary: "#e6f5ff", highlight: "#9ed3ff", glow: "#9cffd4", secondary: "rgba(230,245,255,0.45)", label: "冷蓝" },
  mono:    { primary: "#ffffff", highlight: "#ffffff", glow: "#ffffff", secondary: "rgba(255,255,255,0.4)", label: "纯白" },
};

/**
 * 桌面歌词悬浮窗根组件（仅 label="lyric-overlay" 窗口渲染）。
 *
 * 布局（对标 MineRadio desktop-lyrics.html 的"当前行 + 上下文"）：
 *   ┌─────────────────────────────────────────┐
 *   │                  ... 上 2 行（小）       │  ← 上下文淡灰
 *   │                  ... 上 1 行（小）       │
 *   │  ★ 当前行（大字 + 5 段 CSS 渐变扫光） ★  │
 *   │                  ... 下 1 行（小）       │
 *   │                  ... 下 2 行（小）       │
 *   └─────────────────────────────────────────┘
 *
 * 背景完全透明（透出桌面），控件按钮 hover 才浮现。
 * 设置面板：字号 / 不透明度 / 翻译开关 / 主题预设。
 *
 * 数据流：listen("lyric:state") → 本地 playerStore → useLyrics 算 activeIndex + progress。
 */
export function LyricOverlay() {
  const [rawLrc, setRawLrc] = useState<string | null>(null);
  const [translatedLrc, setTranslatedLrc] = useState<string | null>(null);
  const [locked, setLocked] = useState<boolean>(isLyricLocked());
  const [settings, setSettings] = useState<LyricSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const beatIntensity = usePlayerStore((s) => s.beat?.intensity ?? 0);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { lines, activeIndex, activeProgress } = useLyrics(rawLrc, translatedLrc);

  useEffect(() => {
    let lastTrackId = "";
    let unlisten: (() => void) | null = null;

    (async () => {
      unlisten = await listen<LyricState>("lyric:state", (e) => {
        const { track, position, isPlaying: playing, duration, beatIntensity: bi } = e.payload;
        usePlayerStore.setState({
          currentTrack: track ?? usePlayerStore.getState().currentTrack,
          isPlaying: playing,
          duration,
          position,
          beat: { ...usePlayerStore.getState().beat, intensity: bi ?? 0 },
        });

        const tid = track?.source_track_id ?? "";
        if (track && tid && tid !== lastTrackId) {
          lastTrackId = tid;
          setRawLrc(null);
          setTranslatedLrc(null);
          void fetchLyric(track, setRawLrc, setTranslatedLrc);
        }
      });
    })();

    const posTimer = window.setInterval(() => {
      const s = usePlayerStore.getState();
      if (s.isPlaying && s.duration > 0) {
        const next = Math.min(s.position + 0.25, s.duration);
        usePlayerStore.setState({ position: next });
      }
    }, 250);

    return () => {
      if (unlisten) unlisten();
      window.clearInterval(posTimer);
    };
  }, []);

  // 设置变更时持久化
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const onDragEnd = async () => {
    try {
      const pos = await getCurrentWebviewWindow().outerPosition();
      saveLyricPos(pos.x, pos.y);
    } catch {
      /* ignore */
    }
  };

  // 切换锁定/解锁(中键点击触发)。不再依赖鼠标穿透——歌词文字通过 CSS pointer-events:none
  // 透出到下层应用,中键始终能在 webview 内触发。
  const toggleLock = async () => {
    const next = !locked;
    setLocked(next);
    persistLyricLock(next);
    await setLyricLock(next); // no-op,仅更新视觉状态
    void emit("lyric:lock-change", { locked: next });
  };

  // 中键点击 → 切换锁定/解锁。e.button === 1 是中键
  const onAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      void toggleLock();
    }
  };

  const sendCmd = (cmd: "toggle" | "close" | "prev" | "next") => {
    void emit("lyric:cmd", { cmd });
  };

  // 监听来自主窗口的控件命令（不再处理 unlock；解锁入口改为悬浮窗中键单击）
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<{ cmd: string }>("lyric:cmd", (e) => {
        // 所有命令（toggle/close/prev/next）由主窗口侧 useLyricBridge 统一处理，
        // 悬浮窗不再重复监听，避免逻辑双跑
        void e;
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // 上下文：当前行 + 上下各 2 行（5 行总览）
  const CONTEXT_RANGE = 2;
  const empty = lines.length === 0;
  const visibleLines = empty
    ? []
    : lines
        .map((l, i) => ({ line: l, index: i }))
        .filter(({ index }) => index >= activeIndex - CONTEXT_RANGE && index <= activeIndex + CONTEXT_RANGE);

  const cur = activeIndex >= 0 ? lines[activeIndex] : null;
  const curText = cur ? (settings.showTranslation && cur.translation ? cur.text : cur.translation || cur.text) : (empty ? "暂无歌词" : "♪");
  const progressPct = (activeProgress * 100).toFixed(1);

  // beat 呼吸/抖动 —— 委托给 useLyricMotion（MineRadio 桌面歌词 desktop-lyrics.html:834-872 同款）
  // 桌面歌词的事件桥只能拿到 beatIntensity，用它当 sample；没有高质量 beamap 也能凭借本地的
  // sin^8 + floatY/floatX baseline 持续小幅漂浮。
  const currentLineRef = useRef<HTMLDivElement | null>(null);
  useLyricMotion(currentLineRef, {
    mode: "overlay",
    sample: { intensity: beatIntensity, bass: 0, highBloom: 0 },
  });

  const theme = THEMES[settings.theme];

  // 行切换 key（重播入场动画）
  const lineKey = `${activeIndex}-${curText}`;

  return (
    <div
      className={`lyric-overlay${locked ? " lyric-overlay--locked" : ""}${isPlaying ? "" : " lyric-overlay--paused"} lyric-overlay--theme-${settings.theme}`}
      style={{
        "--lyric-progress": `${progressPct}%`,
        "--lyric-scale": settings.scale,
        "--lyric-primary": theme.primary,
        "--lyric-secondary": theme.secondary,
        "--lyric-highlight": theme.highlight,
        "--lyric-glow": theme.glow,
      } as React.CSSProperties}
      onAuxClick={onAuxClick}
    >
      {/* 锁定/解锁入口改为悬浮窗中键单击,不再渲染解锁按钮 */}

      {/* 主体：5 行上下文（透明背景） */}
      <div
        className="lyric-overlay__stage"
        data-tauri-drag-region
        onPointerUp={onDragEnd}
      >
        {/* 顶部不再放 "LOCKED/UNLOCKED · 鼠标穿透" 玻璃卡片——
            锁定时鼠标穿透、卡片也点不到，纯装饰却占视觉中心。
            锁定态提示完全交给主窗口 PlayerBar 的"词"按钮（标题"桌面歌词已锁定·点此解锁"）。 */}

        {/* 歌词 5 行 */}
        <div className="lyric-overlay__lines" key={lineKey}>
          {empty ? (
            <div className="lyric-line lyric-line--empty">暂无歌词</div>
          ) : (
            visibleLines.map(({ line, index }) => {
              const isCur = index === activeIndex;
              const offset = index - activeIndex; // -2 ~ +2
              const showTrans = settings.showTranslation && line.translation;
              return (
                <div
                  key={index}
                  ref={isCur ? currentLineRef : undefined}
                  className={`lyric-line ${isCur ? "lyric-line--cur" : "lyric-line--ctx"} lyric-line--offset-${offset}${isCur ? " lyric-line--in" : ""}`}
                  data-offset={offset}
                >
                  <span className="lyric-line__bg" data-text={line.text}>
                    {line.text}
                  </span>
                  {isCur && (
                    <span
                      className="lyric-line__fill"
                      data-text={line.text}
                      style={{ "--p": `${progressPct}%` } as React.CSSProperties}
                    >
                      {line.text}
                    </span>
                  )}
                  {showTrans && (
                    <div
                      className={`lyric-line__trans ${isCur ? "lyric-line__trans--cur" : ""}`}
                      data-text={line.translation}
                    >
                      {line.translation}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 控件条（hover 才显，未锁定） */}
        {!locked && (
          <div className="lyric-overlay__controls">
            <button
              className="lyric-btn"
              onClick={() => sendCmd("prev")}
              title="上一首"
              aria-label="上一首"
            >
              {Icons.Prev}
            </button>
            <button
              className="lyric-btn lyric-btn--play"
              onClick={() => sendCmd("toggle")}
              title={isPlaying ? "暂停" : "播放"}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? Icons.Pause : Icons.Play}
            </button>
            <button
              className="lyric-btn"
              onClick={() => sendCmd("next")}
              title="下一首"
              aria-label="下一首"
            >
              {Icons.Next}
            </button>
            <div className="lyric-btn-divider" />
            <button
              className="lyric-btn"
              onClick={() => setSettingsOpen((v) => !v)}
              title="设置"
              aria-label="设置"
            >
              {Icons.Settings}
            </button>
            <button
              className="lyric-btn"
              onClick={() => sendCmd("close")}
              title="关闭桌面歌词"
              aria-label="关闭"
            >
              {Icons.Close}
            </button>
          </div>
        )}
      </div>

      {/* 设置面板（齿轮按钮触发） */}
      {settingsOpen && !locked && (
        <div className="lyric-overlay__settings" onClick={(e) => e.stopPropagation()}>
          <div className="lyric-setting">
            <label className="lyric-setting__label">字号</label>
            <input
              type="range"
              min="0.7"
              max="1.5"
              step="0.05"
              value={settings.scale}
              onChange={(e) => setSettings((s) => ({ ...s, scale: parseFloat(e.target.value) }))}
              className="lyric-setting__range"
            />
            <span className="lyric-setting__value">{settings.scale.toFixed(2)}×</span>
          </div>
          <div className="lyric-setting">
            <label className="lyric-setting__label">翻译</label>
            <button
              className={`lyric-setting__toggle ${settings.showTranslation ? "is-on" : ""}`}
              onClick={() => setSettings((s) => ({ ...s, showTranslation: !s.showTranslation }))}
              type="button"
            >
              {settings.showTranslation ? "显示" : "隐藏"}
            </button>
          </div>
          <div className="lyric-setting">
            <label className="lyric-setting__label">主题</label>
            <div className="lyric-setting__themes">
              {(Object.keys(THEMES) as Array<keyof typeof THEMES>).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`lyric-setting__theme ${settings.theme === k ? "is-active" : ""}`}
                  onClick={() => setSettings((s) => ({ ...s, theme: k }))}
                  data-theme={k}
                  title={THEMES[k].label}
                >
                  <span
                    className="lyric-setting__theme-dot"
                    style={{ background: `linear-gradient(135deg, ${THEMES[k].highlight}, ${THEMES[k].glow})` }}
                  />
                  {THEMES[k].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}