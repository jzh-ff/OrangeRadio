import { useEffect, useState } from "react";
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

/** 主窗口推过来的播放状态 */
interface LyricState {
  track: Track | null;
  position: number;
  isPlaying: boolean;
  duration: number;
}

/** 拉***词，按 source_kind 分发网易云 / QQ；无匹配音源或失败 → 置空 */
async function fetchLyric(
  track: Track,
  setRaw: (s: string | null) => void,
  setTrans: (s: string | null) => void
): Promise<void> {
  const kind = (track as { source_kind?: string }).source_kind;
  const tid = track.source_track_id;
  try {
    let data: { raw_lrc: string | null; translated_lrc: string | null } | null = null;
    if (kind === "netease_cloud_music") {
      data = await invoke<{ raw_lrc: string; translated_lrc: string | null }>("netease_lyric", {
        songId: tid,
      });
    } else if (kind === "qq_music") {
      data = await invoke<{ raw_lrc: string; translated_lrc: string | null }>("qqmusic_lyric", {
        songId: tid,
      });
    } else if ((track.meta as { lyrics?: string | null } | undefined)?.lyrics) {
      // 本地内嵌歌词（扫描时 lofty 提取的 USLT/LRC）
      data = { raw_lrc: (track.meta as { lyrics?: string | null }).lyrics!, translated_lrc: null };
    }
    setRaw(data?.raw_lrc || null);
    setTrans(data?.translated_lrc || null);
  } catch {
    setRaw(null);
    setTrans(null);
  }
}

/**
 * 桌面歌词悬浮窗根组件（仅 label="lyric-overlay" 窗口渲染）。
 *
 * 数据流：listen("lyric:state") → 把 track/position/isPlaying/duration 写到本窗口的
 * playerStore → useLyrics 订阅 store.position 自动算 activeIndex → 双行渲染。
 * 本地 setInterval 每 250ms 推进 position，避免主窗口 emit 节流导致的卡顿。
 */
export function LyricOverlay() {
  const [rawLrc, setRawLrc] = useState<string | null>(null);
  const [translatedLrc, setTranslatedLrc] = useState<string | null>(null);
  const [locked, setLocked] = useState<boolean>(isLyricLocked());

  // useLyrics 订阅本窗口 playerStore.position；listen 写入 store 后自动重算
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { lines, activeIndex, activeProgress } = useLyrics(rawLrc, translatedLrc);

  useEffect(() => {
    let lastTrackId = "";
    let unlisten: (() => void) | null = null;

    (async () => {
      unlisten = await listen<LyricState>("lyric:state", (e) => {
        const { track, position, isPlaying: playing, duration } = e.payload;
        // 写到本窗口 store（useLyrics 据此算 activeIndex）
        usePlayerStore.setState({
          currentTrack: track ?? usePlayerStore.getState().currentTrack,
          isPlaying: playing,
          duration,
          position,
        });

        // 切歌时清空旧词并重新拉取
        const tid = track?.source_track_id ?? "";
        if (track && tid && tid !== lastTrackId) {
          lastTrackId = tid;
          setRawLrc(null);
          setTranslatedLrc(null);
          void fetchLyric(track, setRawLrc, setTranslatedLrc);
        }
      });
    })();

    // 本地推进 position（主窗口 emit 节流 200ms，这里 250ms 平滑）
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

  // 拖动结束记位置
  const onDragEnd = async () => {
    try {
      const pos = await getCurrentWebviewWindow().outerPosition();
      saveLyricPos(pos.x, pos.y);
    } catch {
      /* ignore */
    }
  };

  // 锁定：整窗鼠标穿透；通知主窗口按钮更新态。unlock 走主窗口按钮
  const toggleLock = async () => {
    const next = !locked;
    setLocked(next);
    persistLyricLock(next);
    await setLyricLock(next);
    void emit("lyric:lock-change", { locked: next });
  };

  const sendCmd = (cmd: "toggle" | "close") => {
    void emit("lyric:cmd", { cmd });
  };

  // 双行：当前行（高亮大字 + 卡拉 OK 渐变）+ 下一行（次亮小字）；翻译优先
  const cur = activeIndex >= 0 ? lines[activeIndex] : null;
  const nextLine =
    activeIndex >= 0 && activeIndex + 1 < lines.length ? lines[activeIndex + 1] : null;
  const empty = lines.length === 0;
  const curText = cur ? (cur.translation || cur.text) : (empty ? "暂无歌词" : "♪");
  // 卡拉 OK 渐变进度（0-100%）
  const progressPct = Math.round(activeProgress * 100);

  return (
    <div className={`lyric-overlay${locked ? " lyric-overlay--locked" : ""}`}>
      <div
        className="lyric-overlay__drag"
        data-tauri-drag-region
        onPointerUp={onDragEnd}
        style={{ "--lyric-progress": `${progressPct}%` } as React.CSSProperties}
      >
        <div className="lyric-overlay__lines">
          <div className={`lyric-line lyric-line--cur${empty ? " is-empty" : ""}`}>
            <span className="lyric-line__bg">{curText}</span>
            <span className="lyric-line__fill" style={{ width: `${progressPct}%` }}>{curText}</span>
          </div>
          <div className="lyric-line lyric-line--next">
            {nextLine ? nextLine.translation || nextLine.text : ""}
          </div>
        </div>
      </div>

      {/* 控件：锁定时不渲染（整窗穿透，解锁走主窗口） */}
      {!locked && (
        <div className="lyric-overlay__controls">
          <button
            className="lyric-btn"
            onClick={() => sendCmd("toggle")}
            title={isPlaying ? "暂停" : "播放"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <button className="lyric-btn" onClick={toggleLock} title="锁定（鼠标穿透）">
            🔒
          </button>
          <button className="lyric-btn" onClick={() => sendCmd("close")} title="关闭">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
