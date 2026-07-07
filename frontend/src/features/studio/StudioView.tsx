import { useEffect, useState, type PointerEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openInShell } from "@tauri-apps/plugin-shell";
import { useStudioStore } from "../../stores/studioStore";
import { getStudioConfig } from "../../lib/studio";
import type { ToastKind } from "../../components/Toast";
import "../../styles/studio.css";

/** 取一个文件绝对路径的父目录（用于在资源管理器中打开）。 */
function parentDir(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx > 0 ? norm.slice(0, idx) : norm;
}

const PROMPTS = [
  "深夜电台感的 synthwave，BPM 108，女声，副歌有城市霓虹的画面。",
  "一首像夏天海边落日的 indie pop，鼓点轻快，结尾加入合唱。",
  "中文 R&B，低频温暖，歌词关于错过的消息和凌晨三点的橙色路灯。",
];

const setSpotlight = (event: PointerEvent<HTMLElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
};

interface StudioViewProps {
  pushToast?: (msg: string, kind?: ToastKind, ttl?: number) => void;
}

export function StudioView({ pushToast }: StudioViewProps) {
  const {
    prompt,
    lyrics,
    lyricsText,
    audioPath,
    stems,
    generatingLyrics,
    generatingMusic,
    separating,
    error,
    setPrompt,
    setLyricsText,
    clearError,
    doGenerateLyrics,
    doGenerateMusic,
    doSeparateVocal,
  } = useStudioStore();

  const [showLyrics, setShowLyrics] = useState(false);

  const onOpenFolder = async () => {
    if (!audioPath) return;
    try {
      await openInShell(parentDir(audioPath));
    } catch (e) {
      pushToast?.(`打开目录失败: ${e instanceof Error ? e.message : String(e)}`, "error", 6000);
    }
  };

  // 错误 → Toast
  useEffect(() => {
    if (error) {
      pushToast?.(error, "error", 8000);
      clearError();
    }
  }, [error, pushToast, clearError]);

  const hasKey = Boolean(getStudioConfig().apiKey);

  const onGenerateLyrics = async () => {
    if (!hasKey) {
      pushToast?.("请先在设置中配置 MiniMax API Key", "warning", 6000);
      return;
    }
    await doGenerateLyrics();
  };

  const onGenerateMusic = async () => {
    if (!hasKey) {
      pushToast?.("请先在设置中配置 MiniMax API Key", "warning", 6000);
      return;
    }
    pushToast?.("开始生成音乐，约需 30-90 秒…", "info", 5000);
    await doGenerateMusic(false);
    if (useStudioStore.getState().audioPath) {
      pushToast?.("音乐生成完成", "info", 4000);
    }
  };

  const onSeparate = async () => {
    if (!hasKey) {
      pushToast?.("请先在设置中配置 MiniMax API Key", "warning", 6000);
      return;
    }
    if (!confirm("人声/伴奏分轨会调用 MiniMax 两次（消耗双倍额度），且两次生成的旋律会有差异。继续？")) {
      return;
    }
    pushToast?.("开始分轨生成，约需 1-3 分钟…", "info", 5000);
    await doSeparateVocal();
    if (useStudioStore.getState().stems) {
      pushToast?.("分轨完成", "info", 4000);
    }
  };

  return (
    <div className="studio-view">
      <header className="studio-view__header" onPointerMove={setSpotlight}>
        <div className="studio-view__copy">
          <span className="studio-view__badge">OrangeStudio / MiniMax music-2.6</span>
          <h1 className="studio-view__title">把一句灵感推上母带轨</h1>
          <p className="studio-view__subtitle">
            输入一句风格描述，AI 帮你写词、生成带唱完整歌曲、分离人声与伴奏。
            接入 MiniMax music_generation，所有生成结果缓存到本地可反复回放。
          </p>
        </div>
        <div className="studio-view__scope" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <i />
        </div>
      </header>

      {/* 步骤 1：提示词输入 */}
      <section className="studio-prompt" onPointerMove={setSpotlight}>
        <div className="studio-prompt__label">① 描述你想要的歌</div>
        <div className="studio-prompt__input-wrap">
          <textarea
            className="studio-prompt__input"
            placeholder="例如：一首 80 年代复古合成器流行，关于夏夜海边的回忆，欢快中带点怀旧，BPM 110..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
          <button
            className="studio-prompt__btn"
            onClick={onGenerateMusic}
            disabled={generatingMusic || !prompt.trim()}
          >
            {generatingMusic ? "生成中…" : "开始创作"}
          </button>
        </div>
        <div className="studio-prompt__chips">
          {PROMPTS.map((item) => (
            <button key={item} onClick={() => setPrompt(item)}>
              {item}
            </button>
          ))}
        </div>
        {!hasKey && (
          <div className="studio-prompt__hint" style={{ color: "var(--amber)" }}>
            未配置 MiniMax API Key，请先点击左下角齿轮设置
          </div>
        )}
      </section>

      {/* 步骤 2：AI 写词 */}
      <h2 className="section-title">② AI 写词</h2>
      <section className="studio-step studio-step--panel" onPointerMove={setSpotlight}>
        <div className="studio-step__head">
          <div>
            <h3 className="studio-step__title">用 LLM 生成结构化歌词</h3>
            <p className="studio-step__desc">
              {lyrics
                ? `主题：${lyrics.theme}${lyrics.rhyme_scheme ? ` · 押韵：${lyrics.rhyme_scheme}` : ""}`
                : "点击下方按钮，AI 会根据你的提示词写一版主歌/副歌/桥段结构歌词。可手动编辑后再生成音乐。"}
            </p>
          </div>
          <button
            className="studio-prompt__btn studio-prompt__btn--ghost"
            onClick={onGenerateLyrics}
            disabled={generatingLyrics || !prompt.trim()}
          >
            {generatingLyrics ? "写词中…" : lyrics ? "重新写词" : "AI 写词"}
          </button>
        </div>
        {lyricsText && (
          <textarea
            className="studio-lyrics-editor"
            value={lyricsText}
            onChange={(e) => setLyricsText(e.target.value)}
            rows={10}
            placeholder="[Verse]\n歌词一行一行写在这里...\n\n[Chorus]\n副歌..."
          />
        )}
      </section>

      {/* 步骤 3：生成结果回放 */}
      <h2 className="section-title">③ 生成结果</h2>
      <section className="studio-step studio-step--panel" onPointerMove={setSpotlight}>
        {generatingMusic ? (
          <div className="studio-loading">
            <div className="studio-loading__spinner" />
            <p>MiniMax 正在生成音乐，约需 30-90 秒，请稍候…</p>
          </div>
        ) : audioPath ? (
          <div className="studio-result">
            <audio
              className="studio-result__audio"
              src={convertFileSrc(audioPath)}
              controls
              autoPlay
            />
            <div className="studio-result__actions">
              <button
                className="studio-prompt__btn studio-prompt__btn--ghost"
                onClick={onOpenFolder}
              >
                打开目录
              </button>
              {lyricsText && (
                <button
                  className="studio-prompt__btn studio-prompt__btn--ghost"
                  onClick={() => setShowLyrics((v) => !v)}
                >
                  {showLyrics ? "隐藏歌词" : "查看歌词"}
                </button>
              )}
            </div>
            {showLyrics && lyricsText && (
              <pre className="studio-result__lyrics">{lyricsText}</pre>
            )}
            <p className="studio-result__path">本地缓存：{audioPath}</p>
          </div>
        ) : (
          <p className="studio-step__desc">
            还没有生成结果。回到顶部输入提示词，点「开始创作」即可生成带词带唱的完整歌曲。
          </p>
        )}
      </section>

      {/* 步骤 4：人声/伴奏分轨 */}
      <h2 className="section-title">④ 人声 / 伴奏分轨</h2>
      <section className="studio-step studio-step--panel" onPointerMove={setSpotlight}>
        <div className="studio-step__head">
          <div>
            <h3 className="studio-step__title">分离人声与纯伴奏</h3>
            <p className="studio-step__desc">
              调用 MiniMax 两次（带唱 + 纯伴奏），消耗双倍额度。两次生成旋律会有随机差异，适合试听用途。
            </p>
          </div>
          <button
            className="studio-prompt__btn studio-prompt__btn--ghost"
            onClick={onSeparate}
            disabled={separating || !prompt.trim()}
          >
            {separating ? "分轨中…" : stems ? "重新分轨" : "生成分轨"}
          </button>
        </div>
        {stems && (
          <div className="studio-stems">
            <div className="studio-stems__track">
              <div className="studio-stems__label">人声版（带唱）</div>
              <audio src={convertFileSrc(stems.vocals)} controls />
            </div>
            <div className="studio-stems__track">
              <div className="studio-stems__label">纯伴奏版（instrumental）</div>
              <audio src={convertFileSrc(stems.instrumental)} controls />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
