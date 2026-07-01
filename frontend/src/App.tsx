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
} = {
  playPath: () => {},
  toggle: () => {},
  seek: () => {},
  setVol: () => {},
  next: () => {},
  prev: () => {},
  playTrack: () => {},
};

export default function App() {
  const view = usePlayerStore((s) => s.view);
  const engine = useAudioEngine();

  // 注入引擎方法到全局 ref
  useEffect(() => {
    engineRef.playPath = engine.playPath;
    engineRef.toggle = engine.togglePlay;
    engineRef.seek = engine.seek;
    engineRef.setVol = engine.setVolume;
    engineRef.next = engine.next;
    engineRef.prev = engine.prev;
    engineRef.playTrack = (t, index) => {
      const store = usePlayerStore.getState();
      if (store.tracks.length === 0) {
        // 队列未就绪时直接播放当前曲目（队列会在 loadTracks 后补齐）
        usePlayerStore.getState().setCurrent(t as any, index);
        engine.playPath(t.source_track_id);
        return;
      }
      usePlayerStore.getState().setCurrent(t as any, index);
      engine.playPath(t.source_track_id);
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
