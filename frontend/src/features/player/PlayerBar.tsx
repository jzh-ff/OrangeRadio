import { usePlayerStore, type PlaybackMode } from "../../stores/playerStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { engineRef } from "../../App";
import { getCoverUrl, DEFAULT_COVER } from "./useCover";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toggleLyricOverlay } from "../../lib/lyricWindow";
import { joinRoom, leaveRoom } from "../../lib/listenTogether";
import { ProgressParticles } from "./ProgressParticles";
import { AddToPlaylistDialog } from "./AddToPlaylistDialog";
import "../../styles/player-bar.css";

const MODE_LABELS: Record<PlaybackMode, string> = {
  sequence: "顺序播放",
  list_loop: "列表循环",
  single_loop: "单曲循环",
  shuffle: "随机播放",
  understand_you: "懂你模式",
};

const MODE_ORDER: PlaybackMode[] = [
  "sequence",
  "list_loop",
  "single_loop",
  "shuffle",
  "understand_you",
];

/**
 * 播放模式 SVG 图标（对标 MineRadio #play-mode-icon 的 5 状态切换）。
 * 统一 24×24 viewBox，stroke 1.6，圆角线帽，单色描边（currentColor）。
 */
const MODE_ICONS: Record<PlaybackMode, JSX.Element> = {
  // 顺序播放：实心三角 + 竖线
  sequence: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 17V7l11 5-11 5z" fill="currentColor" fillOpacity="0.2" strokeLinejoin="round" />
      <path d="M19 5v14" />
    </svg>
  ),
  // 列表循环：圆角矩形循环箭头包住列表
  list_loop: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  // 单曲循环：循环箭头 + 数字 1
  single_loop: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <text x="12" y="14.5" fontSize="8" fontWeight="900" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="var(--font-mono, monospace)">1</text>
    </svg>
  ),
  // 随机播放：双箭头交叉
  shuffle: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 3h5v5" />
      <path d="M4 20L21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l5 5" />
      <path d="M4 4l5 5" />
    </svg>
  ),
  // 懂你模式：心 + 星
  understand_you: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="currentColor" fillOpacity="0.2" />
      <path d="M17 3l1 2 2 .4-1.5 1.4.3 2.2L17 8l-1.8 1 .3-2.2L14 5.4l2-.4z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  ),
};

/**
 * 操作栏图标（对标 MineRadio 笔触：1.6 stroke，round caps + joins，单色描边）。
 * 所有图标 24×24 viewBox，与 MODE_ICONS 共用一套视觉语言。
 */
const ActionIcons = {
  /** 喜欢 / 收藏 —— Lucide heart 风格的双瓣曲线 */
  Heart: ({ filled = false }: { filled?: boolean }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
    </svg>
  ),
  /** 播放队列 —— Lucide list-music：三横线 + 右侧 8 分音符 + 时间轴竖线 */
  Queue: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15V6" />
      <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M12 12H3" />
      <path d="M16 6H3" />
      <path d="M12 18H3" />
    </svg>
  ),
  /** 桌面歌词 —— Lucide file-text：文档折角 + 三行文字，语义最贴"歌词本" */
  Lyrics: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
      <path d="M9 9h2" />
    </svg>
  ),
  /** 一起听 —— Lucide users：双人轮廓（前后景） */
  ListenTogether: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  /** 添加到歌单 —— Lucide list-plus：三行列表 + 右上角加号 */
  ListPlus: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 12H3" />
      <path d="M16 6H3" />
      <path d="M11 18H3" />
      <path d="M19 9v6" />
      <path d="M22 12h-6" />
    </svg>
  ),
};

export function PlayerBar() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const mode = usePlayerStore((s) => s.mode);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playerBarHidden = usePlayerStore((s) => s.playerBarHidden);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const playerBarOpacity = usePlayerStore((s) => s.visualParams.playerBarOpacity);

  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const volPct = Math.round(volume * 100);

  // 桌面歌词悬浮窗锁定态(来自 lyric-overlay 窗口的 lock-change 事件)——
  // 仅作为"主窗口词按钮是否变橙"的视觉指示,锁定/解锁入口已改为悬浮窗中键单击。
  const [lyricLocked, setLyricLocked] = useState(false);
  useEffect(() => {
    let un: UnlistenFn | null = null;
    (async () => {
      un = await listen<{ locked: boolean }>("lyric:lock-change", (e) =>
        setLyricLocked(e.payload.locked)
      );
    })();
    return () => {
      un?.();
    };
  }, []);

  // 同步底部播放栏隐藏态到 body，供主内容区 padding 调整
  useEffect(() => {
    if (playerBarHidden) document.body.setAttribute("data-playerbar-hidden", "true");
    else document.body.removeAttribute("data-playerbar-hidden");
    return () => { document.body.removeAttribute("data-playerbar-hidden"); };
  }, [playerBarHidden]);

  const onLyricBtn = async () => {
    // 主窗口"词"按钮只负责"打开/关闭悬浮窗",不再处理解锁(锁定态下悬浮窗中键单击可解锁)。
    await toggleLyricOverlay();
  };

  // 一起听（Listen Together）：加入/离开房间
  const [inRoom, setInRoom] = useState(false);

  // "添加到歌单" 弹窗（v0.4：分区版 支持本地/网易云/QQ）
  const [showAddDialog, setShowAddDialog] = useState(false);
  const handleJoinRoom = () => {
    if (inRoom) {
      leaveRoom();
      setInRoom(false);
    } else {
      const roomId = window.prompt("输入房间号（和朋友用同一个）", "default");
      if (roomId) {
        joinRoom(roomId);
        setInRoom(true);
      }
    }
  };

  const cycleMode = () => {
    const idx = MODE_ORDER.indexOf(mode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    usePlayerStore.getState().setMode(next);
    // 懂你模式是动作型模式，同步 smartAction 让 UI 状态一致
    usePlayerStore.getState().setSmartAction(next === "understand_you" ? "understand_you" : next === "sequence" && usePlayerStore.getState().smartAction === "recommend" ? "recommend" : null);
  };

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // 音量弹出层：单击钮切换 + 点击外部关闭
  const [volOpen, setVolOpen] = useState(false);
  const volWrapRef = useRef<HTMLDivElement>(null);
  // 音量弹层用 React Portal 挂到 body,绕开 .playerbar { overflow: hidden; border-radius: 50px }
  // 把弹层右上/右/下三边裁切的问题。位置基于 volWrapRef.getBoundingClientRect() 实时计算。
  const [volPopoverPos, setVolPopoverPos] = useState<{ right: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!volOpen) return;
    const recalc = () => {
      const r = volWrapRef.current?.getBoundingClientRect();
      if (!r) return;
      // right = 视口宽 - 锚点右 + 10 (offset 让 popover 右沿越过按钮 10px,贴近锚点)
      // bottom = 视口高 - 锚点顶 + 14 (锚点上方 14px,与原 absolute 偏移一致)
      setVolPopoverPos({
        right: Math.max(8, window.innerWidth - r.right + 10),
        bottom: Math.max(8, window.innerHeight - r.top + 14),
      });
    };
    recalc();
    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, true);
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [volOpen]);
  useEffect(() => {
    if (!volOpen) return;
    const onDown = (e: PointerEvent) => {
      if (volWrapRef.current && !volWrapRef.current.contains(e.target as Node)) {
        setVolOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVolOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [volOpen]);
  const volTrackRef = useRef<HTMLDivElement>(null);
  const updateVolFromY = (clientY: number) => {
    const track = volTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    engineRef.setVol(parseFloat(ratio.toFixed(3)));
  };
  const onVolPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateVolFromY(e.clientY);
    const onMove = (ev: PointerEvent) => updateVolFromY(ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 跳动的音符：每 1.2s 在进度条当前位置生成 ♪♫♬♩，1.5s 后自动消失
  // progress 通过 ref 兜底，避免 setInterval 闭包捕获过期值
  const notesRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(progress);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => {
    if (!isPlaying) return;
    const container = notesRef.current;
    if (!container) return;
    const NOTES = ["♪", "♫", "♬", "♩"];
    const COLORS = [
      "rgba(255, 107, 26, 0.95)",
      "rgba(255, 157, 69, 0.95)",
      "rgba(255, 196, 107, 0.95)",
      "rgba(244, 210, 138, 0.95)",
    ];
    const tick = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      const note = document.createElement("span");
      note.className = "pb-note";
      note.textContent = NOTES[Math.floor(Math.random() * NOTES.length)];
      note.style.left = `${(progressRef.current / 100) * rect.width}px`;
      note.style.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      container.appendChild(note);
      setTimeout(() => note.remove(), 1500);
    };
    const interval = setInterval(tick, 1200);
    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <div
      className={`playerbar ${currentTrack && !playerBarHidden ? "playerbar--visible" : ""}`}
      style={{ "--ui-opacity": playerBarOpacity } as React.CSSProperties}
    >
      {/* 左：曲目信息 */}
      <div className="pb-left">
        <div
          className={`pb-cover ${isPlaying ? "pb-cover--spin" : ""}`}
          onClick={() => usePlayerStore.getState().setFullPlayer(true)}
          title="点击进入全屏播放"
          style={{ cursor: "pointer" }}
        >
          {getCoverUrl(currentTrack) ? (
            <img className="pb-cover__img" src={getCoverUrl(currentTrack)!} alt={currentTrack?.meta.title} />
          ) : (
            <img className="pb-cover__disc" src={DEFAULT_COVER} alt="" />
          )}
        </div>
        <div className="pb-meta">
          <div className="pb-title">{currentTrack?.meta.title || "OrangeRadio"}</div>
          <div className="pb-artist">{currentTrack?.meta.artist || "选择一首歌开始"}</div>
          <div className="pb-state">
            <span className={isPlaying ? "is-live" : ""} />
            {isPlaying ? "LIVE SIGNAL" : "STANDBY"}
          </div>
        </div>
      </div>

      {/* 中：控制 + 进度 */}
      <div className="pb-center">
        <div className="pb-controls">
          <button className="pb-btn" onClick={() => engineRef.prev()} title="上一首">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
          </button>
          <button className="pb-btn pb-btn--play" onClick={() => engineRef.toggle()} title={isPlaying ? "暂停" : "播放"}>
            {isPlaying ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button className="pb-btn" onClick={() => engineRef.next()} title="下一首">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6v12z" /></svg>
          </button>
        </div>
        <div className="pb-progress">
          <span className="pb-time">{fmt(position)}</span>
          <div className="pb-slider">
            <div className="pb-slider__track">
              <div className="pb-slider__fill" style={{ width: `${progress}%` }} />
              <div className="pb-slider__thumb" style={{ left: `${progress}%` }} />
            </div>
            <ProgressParticles progress={progress} isPlaying={isPlaying} />
            <div className="pb-notes" ref={notesRef} aria-hidden />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={position}
              onChange={(e) => engineRef.seek(parseFloat(e.target.value))}
              className="pb-slider__input"
            />
          </div>
          <span className="pb-time">{fmt(duration)}</span>
        </div>
      </div>

      {/* 右：模式 + 音量 */}
      <div className="pb-right">
        {/* 爱心收藏（保留带音源分发的右侧实现） */}
        {currentTrack && (
          <button
            className={`pb-btn pb-like-btn ${currentTrack.liked ? "pb-like-btn--active" : ""}`}
            onClick={async () => {
              const track = currentTrack;
              // 防重复点击：如果正在处理中，忽略
              if ((window as unknown as Record<string, boolean>).__liking) return;
              (window as unknown as Record<string, boolean>).__liking = true;
              const next = !track.liked;
              // 乐观更新：立即更新 UI
              usePlayerStore.setState({ currentTrack: { ...track, liked: next } });
              try {
                if (next) {
                  await invoke("add_to_favorites", { track });
                } else {
                  await invoke("remove_from_favorites", { track });
                }
                // 不刷新整个列表（会导致屏幕闪烁），收藏不触发侧栏更新
              } catch (e) {
                // 失败：回滚
                usePlayerStore.setState({ currentTrack: { ...track, liked: !next } });
                console.error("[收藏] 失败:", e);
              } finally {
                (window as unknown as Record<string, boolean>).__liking = false;
              }
            }}
            title={currentTrack.liked ? "取消收藏" : "收藏"}
          >
            <ActionIcons.Heart filled={!!currentTrack.liked} />
          </button>
        )}
        {/* 添加到歌单 */}
        {currentTrack && (
          <button
            className="pb-btn pb-add-btn"
            onClick={() => setShowAddDialog(true)}
            title="添加到歌单"
            aria-label="添加到歌单"
          >
            <ActionIcons.ListPlus />
          </button>
        )}
        {/* 播放队列 */}
        <button
          className="pb-btn"
          onClick={() => usePlayerStore.setState({ queueOpen: !usePlayerStore.getState().queueOpen })}
          title="播放队列"
        >
          <ActionIcons.Queue />
        </button>
        {/* 桌面歌词悬浮窗 —— 用"词"字代替图标（更直观、和右侧按钮区分明确） */}
        <button
          className="pb-btn pb-btn--lyric"
          onClick={onLyricBtn}
          title={lyricLocked ? "桌面歌词已锁定·点此解锁" : "桌面歌词"}
          aria-label={lyricLocked ? "解锁桌面歌词" : "打开桌面歌词"}
          style={lyricLocked ? { color: "#ff9248" } : undefined}
        >
          <span className="pb-btn__char">词</span>
        </button>
        {/* 一起听 */}
        <button
          className="pb-btn"
          onClick={handleJoinRoom}
          title={inRoom ? "离开一起听" : "一起听"}
          style={inRoom ? { color: "#ff9248" } : undefined}
        >
          <ActionIcons.ListenTogether />
        </button>
        <button
          className="pb-btn pb-btn--mode"
          onClick={cycleMode}
          title={MODE_LABELS[mode]}
          aria-label={MODE_LABELS[mode]}
        >
          {MODE_ICONS[mode]}
        </button>
        {/* 沉浸模式：隐藏所有 chrome，只剩壁纸 + 歌词 */}
        <button
          type="button"
          className="pb-btn"
          onClick={() => usePlayerStore.getState().setImmersiveMode(true)}
          title="沉浸模式（Esc 退出）"
          aria-label="进入沉浸模式"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <path d="M9 10h6v4H9z" />
          </svg>
        </button>
        <div className="pb-vol-wrap" ref={volWrapRef}>
          <button
            type="button"
            className={`pb-btn pb-btn--vol ${volOpen ? "pb-btn--vol-active" : ""}`}
            onClick={() => setVolOpen((v) => !v)}
            title={`音量 ${volPct}`}
            aria-label={`音量 ${volPct}`}
            aria-expanded={volOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" />
              {volume > 0.3 && <path d="M15.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
              {volume > 0.6 && <path d="M18.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
              {volume === 0 && <path d="M22 9l-4 4m0-4l-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
            </svg>
          </button>
          {volOpen && volPopoverPos && createPortal(
            <div
              className="pb-vol-popover"
              role="dialog"
              aria-label="音量调节"
              style={{ right: volPopoverPos.right, bottom: volPopoverPos.bottom }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="pb-vol-popover__pct">{volPct}</div>
              <div
                className="pb-vol-vertical"
                ref={volTrackRef}
                onPointerDown={onVolPointerDown}
                role="slider"
                aria-label="音量"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={volPct}
                tabIndex={0}
              >
                <div className="pb-vol-vtrack">
                  <div className="pb-vol-vfill" style={{ height: `${volPct}%` }} />
                </div>
                <div className="pb-vol-vthumb" style={{ bottom: `calc(${volPct}% - 7px)` }} />
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* "添加到歌单" 弹窗（v0.4 分区版） */}
      {showAddDialog && currentTrack && (
        <AddToPlaylistDialog
          track={currentTrack}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
}
