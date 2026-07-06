import { create } from "zustand";
import {
  generateLyrics,
  generateMusic,
  separateVocal,
  getStudioConfig,
  type LyricsDraft,
} from "../lib/studio";

/**
 * 从 invoke reject 出来的错误对象里提取可读文案。
 * Tauri 2 reject 字符串错误时通常是 string；若是对象，尽量取 message。
 * 纯 String(e) 在对象情况下会得到 "[object Object]"，这里兜底。
 */
function extractError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return String(e);
}

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
      set({ error: extractError(e) });
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
      // 优先使用用户编辑后的歌词文本；为空时让后端自动写词（autoLyrics 默认开启）
      const userLyrics = get().lyricsText.trim() || null;
      const result = await generateMusic({
        prompt,
        lyrics: userLyrics,
        isInstrumental: instrumental,
      });
      // 后端回传的歌词（用户词原样回显，或自动写词的产物）。
      // 仅当本地 lyricsText 为空时回填，避免覆盖用户正在编辑的内容。
      if (result.lyrics && !get().lyricsText.trim()) {
        set({ lyricsText: result.lyrics });
      }
      set({ audioPath: result.audio_path });
      // 自动写词降级提示透传到 error（用 Toast 展示，但不阻断播放）
      if (result.lyrics_note) {
        set({ error: result.lyrics_note });
      }
    } catch (e) {
      set({ error: extractError(e) });
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
      set({ error: extractError(e) });
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
