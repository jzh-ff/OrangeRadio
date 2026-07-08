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
  | "kugou"
  | "kuwo"
  | "qishui"
  | "gequbao"
  | "plugin"
  /** 内置 demo 曲（应用打包自带，首启自动播放用） */
  | "builtin";

/** 曲目（与 Rust Track 对应的精简结构） */
export interface Track {
  id: string;
  source_track_id: string; // 本地=文件路径；网易云/QQ=歌曲ID
  source_kind?: SourceKind; // 音源类型（默认 local）
  meta: {
    title: string;
    artist: string;
    album?: string;
    /** 发行年份（Rust 端 TrackMeta.year，本地标签/netease/qq 解析得来） */
    year?: number;
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
  /** 分页状态（本地库大列表懒加载） */
  page: number;
  hasMore: boolean;
  /** 当前是否在搜索（搜索时不分页，搜索结果一次性返回但虚拟化已覆盖渲染） */
  searching: boolean;

  setLoading: (b: boolean) => void;
  setSearchKeyword: (k: string) => void;
  scanLocal: () => Promise<number>;
  loadTracks: () => Promise<void>;
  /** 加载本地库下一页（追加，用于无限滚动） */
  loadMore: () => Promise<void>;
  doSearch: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  loading: false,
  searchKeyword: "",
  page: 1,
  hasMore: false,
  searching: false,

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
    // 首次加载第一页（200 条），标记 hasMore 供无限滚动
    const PAGE_SIZE = 200;
    const tracks = await invoke<Track[]>("library_tracks", { offset: 0, limit: PAGE_SIZE });
    set({ tracks, page: 1, hasMore: tracks.length === PAGE_SIZE, searching: false });
    usePlayerStore.getState().setQueue(tracks);
  },

  loadMore: async () => {
    const { loading, hasMore, searching, page, tracks } = get();
    if (loading || !hasMore || searching) return;
    const PAGE_SIZE = 200;
    const next = page + 1;
    const offset = page * PAGE_SIZE;
    set({ loading: true });
    try {
      const list = await invoke<Track[]>("library_tracks", { offset, limit: PAGE_SIZE });
      if (list.length === 0) {
        set({ hasMore: false });
      } else {
        set({ tracks: [...tracks, ...list], page: next, hasMore: list.length === PAGE_SIZE });
        usePlayerStore.getState().addManyToQueue(list);
      }
    } finally {
      set({ loading: false });
    }
  },

  doSearch: async () => {
    const kw = get().searchKeyword;
    if (!kw.trim()) {
      // 空搜索 → 回到全库（重新分页加载）
      await get().loadTracks();
      return;
    }
    set({ loading: true, searching: true });
    try {
      const tracks = await invoke<Track[]>("search", { keyword: kw, page: 1 });
      set({ tracks, hasMore: false });
      usePlayerStore.getState().setQueue(tracks);
    } finally {
      set({ loading: false });
    }
  },
}));
