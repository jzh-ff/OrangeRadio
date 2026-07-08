import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./libraryStore";
import { usePlayerStore } from "./playerStore";

interface SearchState {
  keyword: string;
  results: Track[];
  loading: boolean;
  page: number;
  hasMore: boolean;
  setKeyword: (k: string) => void;
  doSearch: (kw?: string) => Promise<void>;
  /** 加载下一页聚合搜索结果（追加） */
  loadMore: () => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  keyword: "",
  results: [],
  loading: false,
  page: 1,
  hasMore: false,

  setKeyword: (keyword) => set({ keyword }),

  doSearch: async (kw?: string) => {
    const keyword = (kw ?? get().keyword).trim();
    if (!keyword) return;
    set({ keyword, loading: true, results: [], page: 1, hasMore: true });
    try {
      const list = await invoke<Track[]>("search_all", { keyword, page: 1 });
      // 聚合各源返回数量不固定：满 page_size 条认为可能还有更多（保守判断）
      set({ results: list, hasMore: list.length >= 50 });
      usePlayerStore.getState().setQueue(list);
    } catch {
      set({ results: [], hasMore: false });
    } finally {
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const { loading, hasMore, keyword, page, results } = get();
    if (loading || !hasMore || !keyword.trim()) return;
    const next = page + 1;
    set({ loading: true });
    try {
      const list = await invoke<Track[]>("search_all", { keyword, page: next });
      if (list.length === 0) {
        set({ hasMore: false });
      } else {
        set({ results: [...results, ...list], page: next, hasMore: list.length >= 50 });
        usePlayerStore.getState().addManyToQueue(list);
      }
    } catch {
      set({ hasMore: false });
    } finally {
      set({ loading: false });
    }
  },

  clear: () => set({ keyword: "", results: [], page: 1, hasMore: false }),
}));
