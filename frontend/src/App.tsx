import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VisualBackground } from "./visual/VisualBackground";
import { Sidebar } from "./components/Sidebar";
import { PlayerView } from "./features/player/PlayerView";
import { StudioView } from "./features/studio/StudioView";
import { PlayerBar } from "./features/player/PlayerBar";
import { usePlayerStore } from "./stores/playerStore";
import { useAudioEngine } from "./features/player/useAudioEngine";
import "./styles/app.css";

// 全局引擎句柄：让 store 的 action 能直接调用引擎方法
// （audioEngine 在组件内创建，但 store action 需要触发它）
export const engineRef: {
  playPath: (p: string) => void;
  toggle: () => void;
  seek: (s: number) => void;
  setVol: (v: number) => void;
  next: () => void;
  prev: () => void;
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
  playTrack: () => {},
  resolver: null,
};

export default function App() {
  const view = usePlayerStore((s) => s.view);
  const engine = useAudioEngine(() => engineRef.next());

  // 注入引擎方法到全局 ref
  useEffect(() => {
    engineRef.playPath = engine.playPath;
    engineRef.toggle = engine.togglePlay;
    engineRef.seek = engine.seek;
    engineRef.setVol = engine.setVolume;
    // next/prev 传入 playTrack 作为播放回调（带 resolver 支持）
    engineRef.next = () => engine.next(engineRef.playTrack);
    engineRef.prev = () => engine.prev(engineRef.playTrack);
    engineRef.playTrack = async (t, index) => {
      usePlayerStore.getState().setCurrent(t as any, index);
      // 如果有解析器（网易云/QQ），先获取真实播放 URL
      if (engineRef.resolver) {
        try {
          const url = await engineRef.resolver(t.source_track_id);
          engine.playPath(url);
        } catch (e) {
          console.error("[播放] 解析地址失败:", e);
        }
      } else {
        engine.playPath(t.source_track_id);
      }
    };
  }, [engine]);

  useEffect(() => {
    invoke("app_info").catch(() => {});
  }, []);

  return (
    <div className="app">
      <VisualBackground />
      <div className="app__layout">
        <Sidebar />
        <main className="app__main">
          {view === "player" ? <PlayerView /> : <StudioView />}
        </main>
      </div>
      <PlayerBar />
    </div>
  );
}
