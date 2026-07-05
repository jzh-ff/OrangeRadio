import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./libraryStore";
import { usePlayerStore } from "./playerStore";

interface SearchState {
  keyword: string;
  results: Track[];
  loading: boolean;
  setKeyword: (k: string) => void;
  doSearch: (kw?: string) => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  keyword: "",
  results: [],
  loading: false,

  setKeyword: (keyword) => set({ keyword }),

  doSearch: async (kw?: string) => {
    const keyword = (kw ?? get().keyword).trim();
    if (!keyword) return;
    set({ keyword, loading: true, results: [] });
    try {
      const list = await invoke<Track[]>("search_all", { keyword });
      set({ results: list });
      usePlayerStore.getState().setQueue(list);
    } catch {
      set({ results: [] });
    } finally {
      set({ loading: false });
    }
  },

  clear: () => set({ keyword: "", results: [] }),
}));
