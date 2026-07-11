import { useEffect, useState, type PointerEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openInShell } from "@tauri-apps/plugin-shell";
import { useStudioStore } from "../../stores/studioStore";
import { getStudioConfig, saveProject, loadProject } from "../../lib/studio";
import { MultiTrackPlayer } from "./MultiTrackPlayer";
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

/** 段落标签中文映射 */
const SECTION_LABELS: Record<string, string> = {
  "[Verse]": "主歌",
  "[Chorus]": "副歌",
  "[Pre-Chorus]": "预副歌",
  "[Bridge]": "桥段",
  "[Intro]": "前奏",
  "[Outro]": "尾奏",
  "[Hook]": "Hook",
};

/** 解析 MiniMax 格式歌词，按段落拆分 */
function parseLyricSections(text: string): { tag: string; lines: string[] }[] {
  const sections: { tag: string; lines: string[] }[] = [];
  let currentTag = "";
  let currentLines: string[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    // 匹配 [Verse] [Chorus] 等标签
    const tagMatch = trimmed.match(/^\[(Intro|Verse|Pre-Chorus|Chorus|Bridge|Outro|Hook)\]$/i);
    if (tagMatch) {
      if (currentTag && currentLines.length > 0) {
        sections.push({ tag: currentTag, lines: currentLines });
      }
      currentTag = `[${tagMatch[1]}]`;
      currentLines = [];
    } else if (trimmed && currentTag) {
      currentLines.push(trimmed);
    } else if (trimmed && !currentTag) {
      // 没有标签的歌词行，归入默认段落
      if (currentLines.length === 0) {
        currentTag = "[Verse]";
      }
      currentLines.push(trimmed);
    }
  }
  if (currentTag && currentLines.length > 0) {
    sections.push({ tag: currentTag, lines: currentLines });
  }
  return sections;
}

interface StudioViewProps {
  pushToast?: (msg: string, kind?: ToastKind, ttl?: number) => void;
}

export function StudioView({ pushToast }: StudioViewProps) {
  const {
    prompt,
    lyrics,
    lyricsText,
    audioPath,
    generatedTrack,
    stems,
    chatHistory,
    generatingLyrics,
    generatingMusic,
    separating,
    revising,
    error,
    projectName,
    setPrompt,
    setLyricsText,
    setProjectName,
    clearError,
    doGenerateLyrics,
    doGenerateMusic,
    doSeparateVocal,
    doReviseLyrics,
    playInPlayer,
    reset,
  } = useStudioStore();

  const [showLyrics, setShowLyrics] = useState(false);
  const [showSections, setShowSections] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);

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
      pushToast?.("音乐生成完成，可在播放器中播放", "info", 4000);
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

  const onPlayInPlayer = () => {
    playInPlayer();
    pushToast?.("已加入播放队列，正在播放…", "info", 3000);
  };

  const onSendChat = async () => {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatInput("");
    await doReviseLyrics(msg);
  };

  const onNewProject = () => {
    if (audioPath && !confirm("确定要新建工程吗？当前未保存的内容将丢失。")) return;
    reset();
  };

  const onSaveProject = async () => {
    if (!prompt.trim() && !lyricsText.trim()) {
      pushToast?.("没有可保存的内容", "warning", 4000);
      return;
    }
    const name = projectName.trim() || `studio-${Date.now()}`;
    const projectJson = {
      name,
      prompt,
      lyrics: lyricsText,
      audio_path: audioPath,
      stems,
      created_at: new Date().toISOString(),
    };
    try {
      const path = await saveProject(projectJson, name);
      pushToast?.(`工程已保存: ${path}`, "info", 5000);
    } catch (e) {
      pushToast?.(`保存失败: ${e instanceof Error ? e.message : String(e)}`, "error", 6000);
    }
  };

  const onLoadProject = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        filters: [{ name: "OrangeStudio 工程", extensions: ["orp"] }],
        multiple: false,
      });
      if (!selected || typeof selected !== "string") return;
      const data = await loadProject(selected) as {
        name?: string;
        prompt?: string;
        lyrics?: string;
        audio_path?: string;
        stems?: { vocals: string; instrumental: string } | null;
      };
      useStudioStore.setState({
        projectName: data.name || "",
        prompt: data.prompt || "",
        lyricsText: data.lyrics || "",
        audioPath: data.audio_path || null,
        stems: data.stems || null,
        generatedTrack: null,
        chatHistory: [],
      });
      pushToast?.("工程已加载", "info", 3000);
    } catch (e) {
      pushToast?.(`加载失败: ${e instanceof Error ? e.message : String(e)}`, "error", 6000);
    }
  };

  // 解析歌词段落
  const sections = lyricsText ? parseLyricSections(lyricsText) : [];

  // 多轨播放器数据
  const mixerTracks = stems
    ? [
        { label: "人声版（带唱）", path: stems.vocals, color: "#ff6b35" },
        { label: "纯伴奏版", path: stems.instrumental, color: "#4ecdc4" },
      ]
    : [];

  return (
    <div className="studio-view">
      {/* 顶部工具栏 */}
      <div className="studio-toolbar">
        <input
          className="studio-toolbar__name"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="工程名称（保存时用）"
        />
        <button className="studio-toolbar__btn" onClick={onSaveProject} title="保存工程到 .orp 文件">
          保存
        </button>
        <button className="studio-toolbar__btn" onClick={onLoadProject} title="从 .orp 文件加载工程">
          加载
        </button>
        <button className="studio-toolbar__btn" onClick={onNewProject} title="新建设计">
          新建
        </button>
      </div>

      <header className="studio-view__header" onPointerMove={setSpotlight}>
        <div className="studio-view__copy">
          <span className="studio-view__badge">OrangeStudio / MiniMax music-2.6</span>
          <h1 className="studio-view__title">把一句灵感推上母带轨</h1>
          <p className="studio-view__subtitle">
            输入一句风格描述，AI 帮你写词、生成带唱完整歌曲、分离人声与伴奏。
            生成结果可直接在播放器中播放，歌词支持 AI 对话式迭代修改。
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

      {/* 步骤 2：AI 写词 + 对话修改 */}
      <h2 className="section-title">② AI 写词 & 对话修改</h2>
      <section className="studio-step studio-step--panel" onPointerMove={setSpotlight}>
        <div className="studio-step__head">
          <div>
            <h3 className="studio-step__title">用 LLM 生成并迭代修改歌词</h3>
            <p className="studio-step__desc">
              {lyrics
                ? `主题：${lyrics.theme}${lyrics.rhyme_scheme ? ` · 押韵：${lyrics.rhyme_scheme}` : ""}`
                : "点击下方按钮，AI 会根据你的提示词写一版主歌/副歌/桥段结构歌词。可手动编辑后再生成音乐，也可通过对话让 AI 修改。"}
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

        {/* 歌词编辑器 + 分段预览 */}
        {lyricsText && (
          <div className="studio-lyrics-area">
            <div className="studio-lyrics-editor-wrap">
              <div className="studio-lyrics-editor-head">
                <span>歌词编辑（MiniMax 格式）</span>
                <button
                  className="studio-lyrics-toggle"
                  onClick={() => setShowSections((v) => !v)}
                >
                  {showSections ? "隐藏分段" : "显示分段"}
                </button>
              </div>
              <textarea
                className="studio-lyrics-editor"
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
                rows={12}
                placeholder="[Verse]\n歌词一行一行写在这里...\n\n[Chorus]\n副歌..."
              />
            </div>

            {/* 分段预览 */}
            {showSections && sections.length > 0 && (
              <div className="studio-lyrics-sections">
                <div className="studio-lyrics-sections-head">段落预览</div>
                {sections.map((section, i) => (
                  <div className="studio-lyrics-section" key={i}>
                    <span className="studio-lyrics-section-tag">
                      {SECTION_LABELS[section.tag] || section.tag}
                    </span>
                    <div className="studio-lyrics-section-lines">
                      {section.lines.map((line, j) => (
                        <div className="studio-lyrics-section-line" key={j}>
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AI 对话修改面板 */}
        {lyricsText && (
          <div className="studio-chat">
            <div className="studio-chat__head">
              <button
                className="studio-prompt__btn studio-prompt__btn--ghost"
                onClick={() => setShowChat((v) => !v)}
              >
                {showChat ? "收起对话" : "与 AI 讨论修改歌词"}
              </button>
            </div>
            {showChat && (
              <div className="studio-chat__panel">
                <div className="studio-chat__messages">
                  {chatHistory.length === 0 && (
                    <div className="studio-chat__empty">
                      输入修改意见，如"副歌改得更激昂"、"第二段主歌换成冬天主题"、"整体押韵改为 ABAB"
                    </div>
                  )}
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`studio-chat__msg studio-chat__msg--${msg.role}`}>
                      <span className="studio-chat__role">
                        {msg.role === "user" ? "你" : "AI"}
                      </span>
                      <span className="studio-chat__content">{msg.content}</span>
                    </div>
                  ))}
                  {revising && (
                    <div className="studio-chat__msg studio-chat__msg--assistant">
                      <span className="studio-chat__role">AI</span>
                      <span className="studio-chat__content">正在修改歌词…</span>
                    </div>
                  )}
                </div>
                <div className="studio-chat__input-wrap">
                  <input
                    className="studio-chat__input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSendChat();
                      }
                    }}
                    placeholder="输入修改意见…"
                    disabled={revising}
                  />
                  <button
                    className="studio-prompt__btn"
                    onClick={onSendChat}
                    disabled={revising || !chatInput.trim()}
                  >
                    {revising ? "修改中…" : "发送"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 步骤 3：生成结果 */}
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
              {generatedTrack && (
                <button
                  className="studio-prompt__btn"
                  onClick={onPlayInPlayer}
                  title="在播放详情页播放（含歌词同步/节拍图/队列）"
                >
                  ▶ 在播放器中播放
                </button>
              )}
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
            生成后可一键推入播放器，在播放详情页享受歌词同步和节拍律动。
          </p>
        )}
      </section>

      {/* 步骤 4：人声/伴奏分轨（多轨播放器） */}
      <h2 className="section-title">④ 人声 / 伴奏分轨</h2>
      <section className="studio-step studio-step--panel" onPointerMove={setSpotlight}>
        <div className="studio-step__head">
          <div>
            <h3 className="studio-step__title">分离人声与纯伴奏（多轨同步播放）</h3>
            <p className="studio-step__desc">
              调用 MiniMax 两次（带唱 + 纯伴奏），消耗双倍额度。使用多轨播放器可独立控制
              各轨音量、静音和独奏，同步播放对比人声与伴奏效果。
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
        {stems ? (
          <MultiTrackPlayer tracks={mixerTracks} />
        ) : (
          <p className="studio-step__desc">
            还没有分轨结果。点击「生成分轨」开始（约需 1-3 分钟，消耗双倍额度）。
          </p>
        )}
      </section>
    </div>
  );
}
