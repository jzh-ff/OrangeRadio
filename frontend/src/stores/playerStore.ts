import { create } from "zustand";
import type { Track } from "./libraryStore";

export type PlaybackMode =
  | "sequence"
  | "list_loop"
  | "single_loop"
  | "shuffle"
  | "understand_you";

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  mode: PlaybackMode;
  view: "player" | "studio";
  /** 播放器内子页面 */
  subView: "library" | "radio" | "netease" | "podcast" | "qqmusic" | "spotify";
  spectrum: number[];
  /** 当前播放队列 + 索引（用于上/下一首） */
  tracks: Track[];
  currentIndex: number;

  setView: (v: "player" | "studio") => void;
  setSubView: (v: "library" | "radio" | "netease" | "podcast" | "qqmusic" | "spotify") => void;
  setMode: (m: PlaybackMode) => void;
  setCurrent: (t: Track, index: number) => void;
  setQueue: (tracks: Track[]) => void;
  patch: (s: Partial<PlayerState>) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  currentTrack: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 0.7,
  mode: "sequence",
  view: "player",
  subView: "library",
  spectrum: new Array(64).fill(0),
  tracks: [],
  currentIndex: -1,

  setView: (view) => set({ view }),
  setSubView: (subView) => set({ view: "player", subView }),
  setMode: (mode) => set({ mode }),
  setCurrent: (currentTrack, currentIndex) => set({ currentTrack, currentIndex }),
  setQueue: (tracks) => set({ tracks }),
  patch: (s) => set(s),
}));
