import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "./playerStore";

/** 封面图来源 */
export interface Artwork {
  source: {
    kind: "url" | "local" | "embedded";
    url?: string;
    path?: string;
    track_id?: string;
  };
}

/** 音源类型（跨源收藏的关键：决定播放时去哪取流） */
export type SourceKind =
  | "local"
  | "netease_cloud_music"
  | "qq_music"
  | "spotify"
  | "apple_music"
  | "web_radio"
  | "podcast"
  | "plugin";

/** 曲目（与 Rust Track 对应的精简结构） */
export interface Track {
  id: string;
  source_track_id: string; // 本地=文件路径；网易云/QQ=歌曲ID
  source_kind?: SourceKind; // 音源类型（默认 local）
  meta: {
    title: string;
    artist: string;
    album?: string;
    duration_secs?: number;
    artwork?: Artwork | null;
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
