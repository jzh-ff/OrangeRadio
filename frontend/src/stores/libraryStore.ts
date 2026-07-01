import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "./playerStore";

/** 曲目（与 Rust Track 对应的精简结构） */
export interface Track {
  id: string;
  source_track_id: string; // 本地文件路径
  meta: {
    title: string;
    artist: string;
    album?: string;
    duration_secs?: number;
  };
  format: string;
  quality: string;
  liked: boolean;
  play_count: number;
}

interface LibraryState {
  tracks: Track[];
  loading: boolean;
  searchKeyword: string;

  setLoading: (b: boolean) => void;
  setSearchKeyword: (k: string) => void;
  scanLocal: () => Promise<number>;
  loadTracks: () => Promise<void>;
  doSearch: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  loading: false,
  searchKeyword: "",

  setLoading: (loading) => set({ loading }),
  setSearchKeyword: (searchKeyword) => set({ searchKeyword }),

  scanLocal: async () => {
    set({ loading: true });
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: true });
      if (!selected) {
        set({ loading: false });
        return 0;
      }
      const dirs = Array.isArray(selected) ? selected : [selected];
      const report = await invoke<{ count: number }>("library_scan", {
        rootDirs: dirs,
      });
      await get().loadTracks();
      return report.count;
    } finally {
      set({ loading: false });
    }
  },

  loadTracks: async () => {
    const tracks = await invoke<Track[]>("library_tracks");
    set({ tracks });
    // 同步队列到播放器 store
    usePlayerStore.getState().setQueue(tracks);
  },

  doSearch: async () => {
    const kw = get().searchKeyword;
    const tracks = await invoke<Track[]>("search", { keyword: kw });
    set({ tracks });
    usePlayerStore.getState().setQueue(tracks);
  },
}));
