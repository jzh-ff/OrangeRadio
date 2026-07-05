import { create } from "zustand";
import {
  generateLyrics,
  generateMusic,
  separateVocal,
  getStudioConfig,
  type LyricsDraft,
} from "../lib/studio";

interface StudioState {
  /** 用户输入的创作提示词 */
  prompt: string;
  /** AI 生成的歌词草稿 */
  lyrics: LyricsDraft | null;
  /** 用户可编辑的歌词文本（MiniMax 格式，[Verse]\n... 形式） */
  lyricsText: string;
  /** 生成的完整歌曲本地路径 */
  audioPath: string | null;
  /** 分轨结果 */
  stems: { vocals: string; instrumental: string } | null;

  /** 各阶段 loading */
  generatingLyrics: boolean;
  generatingMusic: boolean;
  separating: boolean;
  /** 最近一次错误（用于 Toast 展示） */
  error: string | null;

  setPrompt: (p: string) => void;
  setLyricsText: (t: string) => void;
  clearError: () => void;

  doGenerateLyrics: () => Promise<void>;
  doGenerateMusic: (instrumental?: boolean) => Promise<void>;
  doSeparateVocal: () => Promise<void>;
  reset: () => void;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  prompt: "",
  lyrics: null,
  lyricsText: "",
  audioPath: null,
  stems: null,
  generatingLyrics: false,
  generatingMusic: false,
  separating: false,
  error: null,

  setPrompt: (prompt) => set({ prompt }),
  setLyricsText: (lyricsText) => set({ lyricsText }),
  clearError: () => set({ error: null }),

  doGenerateLyrics: async () => {
    const { apiKey } = getStudioConfig();
    if (!apiKey) {
      set({ error: "未配置 MiniMax API Key，请先在设置中填写" });
      return;
    }
    const prompt = get().prompt.trim();
    if (!prompt) {
      set({ error: "请先输入创作提示词" });
      return;
    }
    set({ generatingLyrics: true, error: null });
    try {
      const draft = await generateLyrics({
        theme: prompt,
        mood: "自由发挥",
        style: "流行",
        language: "中文",
      });
      // 渲染成 MiniMax 歌词文本，便于用户编辑
      const text = draftToText(draft);
      set({ lyrics: draft, lyricsText: text });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ generatingLyrics: false });
    }
  },

  doGenerateMusic: async (instrumental = false) => {
    const { apiKey } = getStudioConfig();
    if (!apiKey) {
      set({ error: "未配置 MiniMax API Key，请先在设置中填写" });
      return;
    }
    const prompt = get().prompt.trim();
    if (!prompt) {
      set({ error: "请先输入创作提示词" });
      return;
    }
    set({ generatingMusic: true, error: null, audioPath: null, stems: null });
    try {
      // 优先使用用户编辑后的歌词文本
      const lyrics = get().lyricsText.trim() || null;
      const result = await generateMusic({
        prompt,
        lyrics,
        isInstrumental: instrumental,
      });
      set({ audioPath: result.audio_path });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ generatingMusic: false });
    }
  },

  doSeparateVocal: async () => {
    const { apiKey } = getStudioConfig();
    if (!apiKey) {
      set({ error: "未配置 MiniMax API Key，请先在设置中填写" });
      return;
    }
    const prompt = get().prompt.trim();
    if (!prompt) {
      set({ error: "请先输入创作提示词" });
      return;
    }
    set({ separating: true, error: null, stems: null });
    try {
      const lyrics = get().lyricsText.trim() || null;
      const result = await separateVocal({ prompt, lyrics });
      set({
        stems: {
          vocals: result.vocals_path,
          instrumental: result.instrumental_path,
        },
      });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ separating: false });
    }
  },

  reset: () =>
    set({
      prompt: "",
      lyrics: null,
      lyricsText: "",
      audioPath: null,
      stems: null,
      error: null,
    }),
}));

/** 把 LyricsDraft 渲染成可编辑的 MiniMax 歌词文本 */
function draftToText(draft: LyricsDraft): string {
  const tagMap: Record<string, string> = {
    intro: "[Intro]",
    verse: "[Verse]",
    pre_chorus: "[Pre-Chorus]",
    chorus: "[Chorus]",
    bridge: "[Bridge]",
    outro: "[Outro]",
    hook: "[Hook]",
  };
  return draft.sections
    .map(([kind, lines]) => {
      const tag = tagMap[kind] || "[Verse]";
      return `${tag}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
