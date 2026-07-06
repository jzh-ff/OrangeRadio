import { invoke } from "@tauri-apps/api/core";

/** 歌曲段落类型（与 Rust SongSection 对齐，snake_case） */
export type SongSectionKind =
  | "intro"
  | "verse"
  | "pre_chorus"
  | "chorus"
  | "bridge"
  | "outro"
  | "hook";

/** 歌词草稿（与 Rust LyricsDraft 对齐） */
export interface LyricsDraft {
  title: string;
  sections: [SongSectionKind, string[]][];
  theme: string;
  rhyme_scheme: string | null;
}

/** 音乐生成结果 */
export interface MusicGenerationResult {
  audio_path: string;
  task_id: string;
  /** 实际演唱用的歌词（用户传入的词原样回显，或 autoLyrics 自动写词的产物）。
   *  null 表示没词（如纯伴奏，或自动写词失败降级）。 */
  lyrics?: string | null;
  /** 自动写词降级提示（如 "自动写词失败…已改用 MiniMax 自动补词"），正常时为 null */
  lyrics_note?: string | null;
}

/** 人声/伴奏分轨结果 */
export interface SeparateVocalResult {
  vocals_path: string;
  instrumental_path: string;
}

/**
 * 从 localStorage 读取 MiniMax 配置。
 * - LLM 写词/译注用 `orangeradio_minimax_*`（Anthropic 兼容端点）
 * - 音乐生成用 `orangeradio_minimax_music_*`（api.minimaxi.com）
 * 两者共用同一个 API Key。
 * - 创作输出目录用 `orangeradio_studio_output_dir`（为空表示用应用数据目录默认值）
 */
export function getStudioConfig() {
  const apiKey = localStorage.getItem("orangeradio_minimax_key") || "";
  const llmBase =
    localStorage.getItem("orangeradio_minimax_base") ||
    "https://api.minimaxi.com/anthropic";
  const llmModel = localStorage.getItem("orangeradio_minimax_model") || "MiniMax-M1";
  const musicBase =
    localStorage.getItem("orangeradio_minimax_music_base") || "https://api.minimaxi.com";
  const musicModel =
    localStorage.getItem("orangeradio_minimax_music_model") || "music-2.6-free";
  const outputDir = localStorage.getItem("orangeradio_studio_output_dir") || "";
  return { apiKey, llmBase, llmModel, musicBase, musicModel, outputDir };
}

/** AI 写词 */
export async function generateLyrics(params: {
  theme: string;
  mood: string;
  style: string;
  language: string;
}): Promise<LyricsDraft> {
  const { apiKey, llmBase, llmModel } = getStudioConfig();
  return invoke<LyricsDraft>("studio_generate_lyrics", {
    ...params,
    apiBase: llmBase,
    apiKey,
    model: llmModel,
  });
}

/** 音乐生成（MiniMax music_generation，约 30-90 秒）
 *
 * `autoLyrics`（默认 true）：用户没传歌词且非纯伴奏时，后端会先调一次 LLM 写词，
 * 把词同时用于 MiniMax 演唱和回传展示。用户已传歌词时跳过。
 */
export async function generateMusic(params: {
  prompt: string;
  lyrics?: string | null;
  isInstrumental?: boolean;
  outputDir?: string;
  autoLyrics?: boolean;
}): Promise<MusicGenerationResult> {
  const { apiKey, musicBase, musicModel, outputDir, llmBase, llmModel } = getStudioConfig();
  return invoke<MusicGenerationResult>("studio_generate_music", {
    ...params,
    apiBase: musicBase,
    apiKey,
    model: musicModel,
    outputDir: params.outputDir ?? outputDir,
    autoLyrics: params.autoLyrics ?? true,
    lyricsApiBase: llmBase,
    lyricsApiKey: apiKey,
    lyricsModel: llmModel,
  });
}

/**
 * 人声/伴奏分轨（会调用 MiniMax 两次，消耗双倍额度）。
 * 两次生成基于同一 prompt，旋律/编曲有随机差异（适合试听，非精确分离）。
 */
export async function separateVocal(params: {
  prompt: string;
  lyrics?: string | null;
  outputDir?: string;
}): Promise<SeparateVocalResult> {
  const { apiKey, musicBase, musicModel, outputDir } = getStudioConfig();
  return invoke<SeparateVocalResult>("studio_separate_vocal", {
    ...params,
    apiBase: musicBase,
    apiKey,
    model: musicModel,
    outputDir: params.outputDir ?? outputDir,
  });
}

/** 保存创作工程到 .orp 文件 */
export async function saveProject(
  projectJson: unknown,
  name: string,
  outputDir?: string,
): Promise<string> {
  const { outputDir: cfgOutputDir } = getStudioConfig();
  return invoke<string>("studio_project_save", {
    projectJson,
    name,
    outputDir: outputDir ?? cfgOutputDir,
  });
}

/** 从 .orp 文件加载创作工程 */
export async function loadProject(path: string): Promise<unknown> {
  return invoke<unknown>("studio_project_load", { path });
}

/**
 * 弹出文件夹选择器让用户选创作输出目录。
 * @returns 选中目录的绝对路径；用户取消则返回 null。
 */
export async function pickOutputDir(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  if (!selected) return null;
  return typeof selected === "string" ? selected : null;
}
