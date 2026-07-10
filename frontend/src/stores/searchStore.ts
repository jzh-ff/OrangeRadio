import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./libraryStore";
import { usePlayerStore } from "./playerStore";

// 搜索防抖时间（ms）：输入时停 300ms 才触发，避免每个按键触发一次 search_all
const SEARCH_DEBOUNCE_MS = 300;

interface SearchState {
  keyword: string;
  results: Track[];
  loading: boolean;
  page: number;
  hasMore: boolean;
  setKeyword: (k: string) => void;
  /** 立即搜索（绕过防抖，Enter 触发） */
  doSearch: (kw?: string) => Promise<void>;
  /** 防抖搜索（输入时调用，300ms 内多次调用只触发一次） */
  doSearchDebounced: (kw?: string) => void;
  /** 加载下一页聚合搜索结果（追加） */
  loadMore: () => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => {
  let debounceTimer: number | null = null;
  // 单调递增的请求序号：每次发起请求前自增，响应回调里若发现序号已过期则丢弃，
  // 避免防抖请求与立即请求（Enter）之间的竞态——晚返回的过期响应不会覆盖新结果。
  let reqId = 0;

  /** 共享的搜索执行逻辑，带请求序号防竞态。 */
  const runSearch = async (keyword: string) => {
    const myId = ++reqId;
    set({ loading: true, results: [], page: 1, hasMore: true });
    try {
      const list = await invoke<Track[]>("search_all", { keyword, page: 1 });
      if (myId !== reqId) return; // 已被更新的请求取代，丢弃过期响应
      // 聚合各源返回数量不固定：满 page_size 条认为可能还有更多（保守判断）
      set({ results: list, hasMore: list.length >= 50 });
      usePlayerStore.getState().setQueue(list);
    } catch {
      if (myId !== reqId) return;
      set({ results: [], hasMore: false });
    } finally {
      if (myId === reqId) set({ loading: false });
    }
  };

  /** 清理待触发的防抖定时器 */
  const clearDebounce = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  return {
    keyword: "",
    results: [],
    loading: false,
    page: 1,
    hasMore: false,

    setKeyword: (keyword) => set({ keyword }),

    doSearch: async (kw?: string) => {
      const keyword = (kw ?? get().keyword).trim();
      if (!keyword) return;
      // 立即搜索时取消任何待触发的防抖请求，防止它稍后覆盖本次结果
      clearDebounce();
      set({ keyword });
      await runSearch(keyword);
    },

    doSearchDebounced: (kw?: string) => {
      const keyword = (kw ?? get().keyword).trim();
      set({ keyword });
      clearDebounce();
      if (!keyword) {
        set({ results: [], hasMore: false });
        return;
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void runSearch(keyword);
      }, SEARCH_DEBOUNCE_MS);
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

    clear: () => {
      clearDebounce();
      // clear 后让所有在途响应失效
      reqId += 1;
      set({ keyword: "", results: [], page: 1, hasMore: false });
    },
  };
});
