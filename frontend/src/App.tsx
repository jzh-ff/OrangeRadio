import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WallpaperBackground } from "./visual/WallpaperBackground";
import { WallpaperLayer } from "./visual/WallpaperLayer";
import { TitleBar } from "./components/TitleBar";
import { HotkeysModal } from "./components/HotkeysModal";
import { PlaylistShelf } from "./visual/PlaylistShelf";
import { startHotkeyListener, registerGlobalHotkeys, unregisterAllGlobalHotkeys } from "./lib/hotkeys";
import { useWallpaperStore } from "./stores/wallpaperStore";
import { Sidebar } from "./components/Sidebar";
import { PlayerView } from "./features/player/PlayerView";
import { StudioView } from "./features/studio/StudioView";
import { PlayerBar } from "./features/player/PlayerBar";
import { FullPlayer } from "./features/player/FullPlayer";
import { QueuePanel } from "./features/player/QueuePanel";
import { ToastStack, useToasts } from "./components/Toast";
import { SettingsModal } from "./components/SettingsModal";
import { usePlayerStore, type BeatHit } from "./stores/playerStore";
import { useAudioEngine } from "./features/player/useAudioEngine";
import { useBeatDetector } from "./features/player/useBeatDetector";
import { useLyricBridge } from "./features/player/useLyricBridge";
import { recordPlayback } from "./lib/playback";
import { setSyncHandler, sendSync, isInRoom } from "./lib/listenTogether";
import "./styles/app.css";

// 后端 AuthEventSink 发到前端的 payload 类型（对应 orange-core::AuthExpiredPayload）
interface AuthExpiredPayload {
  source: string;        // "netease" | "qqmusic"
  source_name: string;   // "网易云音乐" | "QQ 音乐"
  reason?: string;
}

// 全局引擎句柄：让 store 的 action 能直接调用引擎方法
// （audioEngine 在组件内创建，但 store action 需要触发它）
export const engineRef: {
  playPath: (p: string) => void;
  toggle: () => void;
  seek: (s: number) => void;
  setVol: (v: number) => void;
  next: () => void;
  prev: () => void;
  /** 不记"跳过"反馈的选下一首（供 audio 自然播完时复用，避免与用户主动切歌的 skip 记录冲突） */
  advance: () => void;
  playTrack: (t: { source_track_id: string }, index: number) => void;
  /** 音源解析器：网易云/QQ需要先获取播放URL，设为null表示直接用source_track_id */
  resolver: ((trackId: string) => Promise<string>) | null;
} = {
  playPath: () => {},
  toggle: () => {},
  seek: () => {},
  setVol: () => {},
  next: () => {},
  prev: () => {},
  advance: () => {},
  playTrack: () => {},
  resolver: null,
};

// 全局播放请求序号：防止异步竞态（快速切歌时旧请求覆盖新请求）
let playRequestSeq = 0;
// 一起听：正在应用远端同步消息时为 true，避免本地 engineRef 再次广播（收发循环）
let applyingRemote = false;
// 防抖：同一首歌在 500ms 内不重复请求取流
let lastPlayTrackId = "";

export default function App() {
  const view = usePlayerStore((s) => s.view);
  const fullPlayerOpen = usePlayerStore((s) => s.fullPlayerOpen);
  const mainOpacity = usePlayerStore((s) => s.visualParams.mainOpacity);
  const engine = useAudioEngine(() => engineRef.advance());
  // 全局节拍检测（驱动粒子等视觉）
  useBeatDetector();
  // 桌面歌词桥：主窗口推播放状态给 lyric-overlay，接收悬浮窗控件命令
  useLyricBridge({
    onToggle: () => engineRef.toggle(),
    onPrev: () => engineRef.prev(),
    onNext: () => engineRef.next(),
  });
  // 壁纸激活态（响应式：切换壁纸时重渲染背景层）
  const wallpaperActive = useWallpaperStore((s) => !!s.activeId);
  // 3D 歌单架（右键唤起，对标 MineRadio 右键 shelf）
  const [shelfOpen, setShelfOpen] = useState(false);
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      // 右键唤起 3D 歌单架（排除输入框/歌词区等已处理右键的场景）
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      e.preventDefault();
      setShelfOpen(true);
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);
  // 局内热键监听 + 全局热键注册（应用启动时启动，卸载时清理）
  useEffect(() => {
    const unlistenLocal = startHotkeyListener();
    void registerGlobalHotkeys().then(({ conflicts }) => {
      if (conflicts.length) console.warn("[热键] 全局热键冲突:", conflicts);
    });
    return () => {
      unlistenLocal();
      void unregisterAllGlobalHotkeys();
    };
  }, []);

  // 全局 toast（登录过期事件 / 通用提示）
  const { toasts, pushToast, dismiss } = useToasts();
  // 用 ref 透传 pushToast 给 playTrack 闭包：避免把它加进 useEffect 依赖导致 playTrack 频繁重建
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;

  // 监听后端 emit 的 "auth-expired" 事件
  // 后端来源：orange-tauri::TauriAuthSink（在网易云/QQ 续期失败时触发）
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      unlisten = await listen<AuthExpiredPayload>("auth-expired", (event) => {
        const p = event.payload;
        const reason = p.reason ? `（${p.reason}）` : "";
        // toast 带"重新扫码"快捷按钮：点击 → 切到对应 view + 通知组件打开扫码 UI
        pushToast(
          `${p.source_name} 登录已失效${reason ? "，" + reason : ""}`,
          "warning",
          12000,
          {
            label: "重新扫码",
            onClick: () => {
              usePlayerStore.getState().setView("player");
              const sub = p.source === "qqmusic"
                ? "qqmusic"
                : p.source === "spotify"
                ? "spotify"
                : "netease";
              usePlayerStore.getState().setSubView(sub as any);
              // 通知目标 view 切到扫码 / 配置 UI
              if (p.source === "netease" || p.source === "qqmusic") {
                usePlayerStore.getState().requestRelogin(p.source);
              }
            },
          },
        );
        console.warn("[auth-expired]", p);
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [pushToast]);

  // 注入引擎方法到全局 ref
  useEffect(() => {
    engineRef.playPath = engine.playPath;
    engineRef.toggle = () => {
      // 恢复场景：currentTrack 被 persist 恢复显示在 UI，但 <audio> 元素 src 为空（重启后未加载）
      // 此时点击播放不能走 togglePlay（会被 !audio.src 挡掉静默失败），改走 playTrack 重新加载
      if (!engine.hasSrc() && usePlayerStore.getState().currentTrack) {
        const t = usePlayerStore.getState().currentTrack!;
        const idx = usePlayerStore.getState().currentIndex;
        void engineRef.playTrack(t, idx);
        return;
      }
      engine.togglePlay();
      if (!applyingRemote && isInRoom()) {
        sendSync({ action: usePlayerStore.getState().isPlaying ? "pause" : "play", ts: Date.now() });
      }
    };
    engineRef.seek = (s: number) => {
      engine.seek(s);
      if (!applyingRemote && isInRoom()) {
        sendSync({ action: "seek", position: s, ts: Date.now() });
      }
    };
    engineRef.setVol = engine.setVolume;
    // next/prev 传入 playTrack 作为播放回调（带 resolver 支持）
    engineRef.advance = () => engine.next(engineRef.playTrack);
    engineRef.next = () => {
      recordPlayback(false, true); // 用户主动切歌 = 跳过（负反馈）
      engine.next(engineRef.playTrack);
    };
    engineRef.prev = () => {
      recordPlayback(false, true);
      engine.prev(engineRef.playTrack);
    };
    engineRef.playTrack = async (t, index) => {
      const track = t as any;
      // 防抖：同一首歌 500ms 内不重复取流（防止 onClick+onDoubleClick 重复触发）
      const trackKey = track.source_track_id;
      const now = Date.now();
      if (trackKey === lastPlayTrackId && now - (window as any)._lastPlayTime < 500) {
        console.log("[播放] 防抖跳过:", trackKey);
        return;
      }
      lastPlayTrackId = trackKey;
      (window as any)._lastPlayTime = now;

      // 立即更新 UI（歌曲信息、高亮）
      usePlayerStore.getState().setCurrent(t as any, index);
      // 节拍图谱预计算（本地文件 → 电影运镜；云曲无图谱 → 退化实时检测）
      if ((track.source_kind || "local") === "local") {
        void invoke<{ hits: BeatHit[] | null }>("analyze_beatmap", {
          trackPath: track.source_track_id,
        })
          .then((bm) => usePlayerStore.getState().setBeatmap(bm?.hits ?? null))
          .catch(() => usePlayerStore.getState().setBeatmap(null));
      } else {
        usePlayerStore.getState().setBeatmap(null);
      }
      // 分配请求序号，防止快速切歌时旧的异步取流覆盖新的
      const mySeq = ++playRequestSeq;
      const kind = track.source_kind || "local";
      let playUrl: string | null = null;

      try {
        if (kind === "netease_cloud_music") {
          playUrl = await invoke<string>("netease_stream", { trackId: track.source_track_id });
        } else if (kind === "qq_music") {
          playUrl = await invoke<string>("qqmusic_stream", { trackId: track.source_track_id });
        } else if (kind === "gequbao") {
          playUrl = await invoke<string>("gequbao_stream", { songPath: track.source_track_id });
        } else if (kind === "kugou") {
          playUrl = await invoke<string>("kugou_stream", { trackId: track.source_track_id });
        } else if (kind === "kuwo") {
          playUrl = await invoke<string>("kuwo_stream", { rid: track.source_track_id });
        } else if (kind === "qishui") {
          playUrl = await invoke<string>("qishui_stream", { trackId: track.source_track_id });
        } else {
          playUrl = track.source_track_id;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[播放] 取流失败:", e);
        // 弹可见提示：QQ 取流常见 104003（版权/VIP），网易云可能 VIP 曲目或 cookie 失效
        pushToastRef.current(`取流失败：${msg}（可能需要 VIP 或登录已失效）`, "warning", 8000);
        return;
      }

      // 竞态检查：如果这期间用户又切了歌，放弃这次播放
      if (mySeq !== playRequestSeq) {
        console.log("[播放] 放弃过期请求 seq=", mySeq);
        return;
      }
      engine.playPath(playUrl!);
    };
  }, [engine]);

  // 一起听：接收远端同步消息 → 本地同步播放（applyingRemote 避免再次广播形成循环）
  useEffect(() => {
    setSyncHandler((m) => {
      applyingRemote = true;
      try {
        if (m.action === "pause" || m.action === "play") {
          engineRef.toggle();
        } else if (m.action === "seek" && m.position != null) {
          engineRef.seek(m.position);
        }
      } finally {
        window.setTimeout(() => {
          applyingRemote = false;
        }, 200);
      }
    });
    return () => setSyncHandler(null);
  }, []);

  useEffect(() => {
    invoke("app_info").catch(() => {});
  }, []);

  return (
    <div className="app">
      <TitleBar />
      {wallpaperActive ? <WallpaperLayer /> : <WallpaperBackground />}
      <div className="app__layout">
        <Sidebar />
        <main
          className="app__main"
          style={{ "--ui-opacity": mainOpacity } as React.CSSProperties}
        >
          {view === "player" ? <PlayerView /> : <StudioView pushToast={pushToast} />}
        </main>
      </div>
      <PlayerBar />
      {fullPlayerOpen && <FullPlayer pushToast={pushToast} />}
      <QueuePanel />
      {/* 设置弹窗（齿轮按钮触发） */}
      <SettingsModal />
      {/* 热键设置弹窗（VisualConsole 热键按钮触发） */}
      <HotkeysModal />
      {/* 3D 歌单架（右键唤起） */}
      {shelfOpen && <PlaylistShelf onClose={() => setShelfOpen(false)} />}
      {/* 全局 toast 栈（监听 auth-expired 等事件） */}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
