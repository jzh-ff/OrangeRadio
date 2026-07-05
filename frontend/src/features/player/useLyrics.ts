import { useMemo } from "react";
import { usePlayerStore } from "../../stores/playerStore";

/** YRC 逐字：单个词的时间区间 + 字符偏移 */
export interface LyricWord {
  /** 词开始时间（秒） */
  t: number;
  /** 词持续时长（秒） */
  d: number;
  /** 词在行内的起始字符偏移 */
  c0: number;
  /** 词在行内的结束字符偏移（不含） */
  c1: number;
}

/** 一行歌词 */
export interface LyricLine {
  /** 时间戳（秒） */
  time: number;
  /** 原文 */
  text: string;
  /** 翻译（可选） */
  translation?: string;
  /** AI 注解（典故/彩蛋/创作背景，由 FullPlayer 译注完成后合并写入） */
  annotation?: string;
  /** YRC 逐字词表（无 YRC 时为空，按行级 smoothstep 兜底） */
  words?: LyricWord[];
}

/**
 * 解析 YRC 逐字行：`[startMs,durMs](wordStart,wordDur,0)词1(wordStart,wordDur,0)词2...`
 * 返回 { time, text, words }。非 YRC 行返回 null。
 */
function parseYrcLine(line: string): { time: number; text: string; words: LyricWord[] } | null {
  // YRC 行首：[startMs,durMs]
  const head = line.match(/^\[(\d+),(\d+)\]/);
  if (!head) return null;
  const time = parseInt(head[1]) / 1000;
  const rest = line.slice(head[0].length);
  // 词：(wordStart,wordDur,0)词文本  —— 词文本到下一个 ( 或行尾
  const words: LyricWord[] = [];
  let text = "";
  const re = /\((\d+),(\d+),\d+\)([^()]*)/g;
  let m: RegExpExecArray | null;
  let c0 = 0;
  while ((m = re.exec(rest)) !== null) {
    const wt = parseInt(m[1]) / 1000;
    const wd = parseInt(m[2]) / 1000;
    const wtext = m[3] || "";
    if (wtext) {
      words.push({ t: wt, d: wd, c0, c1: c0 + wtext.length });
      text += wtext;
      c0 += wtext.length;
    }
  }
  if (!text) return null;
  return { time, text, words };
}

/**
 * LRC 歌词解析 + 当前行同步 + 逐字 progress
 *
 * 解析 `[mm:ss.xx]文本` 格式，支持多时间戳行和翻译歌词（tlyric）。
 * 若行内含 YRC `[startMs,durMs](...)` 格式，按逐字解析。
 * activeIndex 根据当前播放位置二分查找。
 * activeProgress 返回当前行已唱比例 0~1（YRC 按词插值，LRC 行级 smoothstep）。
 */
export function useLyrics(rawLrc: string | null, translatedLrc: string | null | undefined) {
  const position = usePlayerStore((s) => s.position);

  const lines = useMemo<LyricLine[]>(() => {
    if (!rawLrc) return [];
    // 翻译歌词：按时间戳建索引
    const transMap = new Map<number, string>();
    if (translatedLrc) {
      for (const m of translatedLrc.matchAll(/\[(\d+):(\d+)\.(\d+)\]([^\n]*)/g)) {
        const t = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / 1000;
        transMap.set(Math.round(t * 100), (m[4] || "").trim());
      }
    }
    const result: LyricLine[] = [];
    for (const line of rawLrc.split("\n")) {
      // 先尝试 YRC 解析
      const yrc = parseYrcLine(line);
      if (yrc) {
        result.push({
          time: yrc.time,
          text: yrc.text,
          words: yrc.words,
          translation: transMap.get(Math.round(yrc.time * 100)),
        });
        continue;
      }
      // LRC：一行可能有多个 [mm:ss.xx]
      const stamps = [...line.matchAll(/\[(\d+):(\d+)\.(\d+)\]/g)];
      if (stamps.length === 0) continue;
      const text = line.replace(/\[\d+:\d+\.\d+\]/g, "").trim();
      if (!text) continue;
      for (const s of stamps) {
        const t = parseInt(s[1]) * 60 + parseInt(s[2]) + parseInt(s[3]) / 1000;
        result.push({ time: t, text, translation: transMap.get(Math.round(t * 100)) });
      }
    }
    result.sort((a, b) => a.time - b.time);
    return result;
  }, [rawLrc, translatedLrc]);

  // 二分查找当前行
  const activeIndex = useMemo(() => {
    if (lines.length === 0) return -1;
    let lo = 0, hi = lines.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= position) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }, [lines, position]);

  // 当前行已唱比例 0~1（YRC 按词字符插值，LRC 行级 smoothstep 匀速）
  const activeProgress = useMemo(() => {
    if (activeIndex < 0 || activeIndex >= lines.length) return 0;
    const cur = lines[activeIndex];
    const next = lines[activeIndex + 1];
    const endTime = next ? next.time : cur.time + 5; // 无下一行时给 5s 兜底
    const span = Math.max(0.1, endTime - cur.time);
    const local = Math.max(0, Math.min(1, (position - cur.time) / span));
    // 无 YRC：直接返回行级进度
    if (!cur.words || cur.words.length === 0) return local;
    // YRC：按词时间插值得到已唱字符比例
    const charCount = cur.text.length;
    if (charCount === 0) return 0;
    let sungChars = 0;
    for (const w of cur.words) {
      if (position < w.t) break;
      if (position >= w.t + w.d) {
        sungChars += (w.c1 - w.c0);
      } else {
        // 词内插值
        const wLocal = Math.max(0, Math.min(1, (position - w.t) / Math.max(0.01, w.d)));
        sungChars += (w.c1 - w.c0) * wLocal;
        break;
      }
    }
    return Math.max(0, Math.min(1, sungChars / charCount));
  }, [lines, activeIndex, position]);

  return { lines, activeIndex, activeProgress };
}
