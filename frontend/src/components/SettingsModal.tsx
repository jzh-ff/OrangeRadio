import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openInShell } from "@tauri-apps/plugin-shell";
import { usePlayerStore } from "../stores/playerStore";
import { pickOutputDir } from "../lib/studio";
import "./SettingsModal.css";

interface AuthStatusItem {
  source: string;
  source_name: string;
  configured: boolean;
  saved_at: number; // Unix 秒
}

interface AuthOverview {
  items: AuthStatusItem[];
}

/** 距离当前多久（中文） */
function relativeTime(unixSecs: number): string {
  if (!unixSecs) return "未配置";
  const now = Math.floor(Date.now() / 1000);
  const delta = now - unixSecs;
  if (delta < 60) return `${delta} 秒前`;
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`;
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)} 天前`;
  const date = new Date(unixSecs * 1000);
  return date.toLocaleDateString("zh-CN");
}

/** 格式化 ISO 时间戳 */
function formatDate(unixSecs: number): string {
  if (!unixSecs) return "—";
  return new Date(unixSecs * 1000).toLocaleString("zh-CN");
}

/** 格式化听歌总时长 */
function fmtDuration(s: number): string {
  if (!s) return "0 分钟";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

/** 设置弹窗：鉴权总览 + 视觉参数 + 关于 */
export function SettingsModal() {
  const open = usePlayerStore((s) => s.settingsOpen);
  const close = () => usePlayerStore.getState().setSettingsOpen(false);
  const requestRelogin = usePlayerStore((s) => s.requestRelogin);
  const setSubView = usePlayerStore((s) => s.setSubView);
  const setView = usePlayerStore((s) => s.setView);

  const [authItems, setAuthItems] = useState<AuthStatusItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<{
    top_artists?: [string, number][];
    top_genres?: [string, number][];
    total_listen_secs?: number;
  } | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  // AI 配置（MiniMax，持久化到 localStorage，FullPlayer 译注用）
  const [minimaxKey, setMinimaxKey] = useState(() => localStorage.getItem("orangeradio_minimax_key") || "");
  const [minimaxBase, setMinimaxBase] = useState(() => localStorage.getItem("orangeradio_minimax_base") || "https://api.minimaxi.com/anthropic");
  const [minimaxModel, setMinimaxModel] = useState(() => localStorage.getItem("orangeradio_minimax_model") || "MiniMax-M1");
  // OpenAI 兼容配置（推荐系统 LLM 重排用，覆盖 GLM/DeepSeek/通义等）
  const [llmProvider, setLlmProvider] = useState<"minimax" | "openai">(() => (localStorage.getItem("orangeradio_llm_provider") as "minimax" | "openai") || "minimax");
  const [llmKey, setLlmKey] = useState(() => localStorage.getItem("orangeradio_llm_key") || "");
  const [llmBase, setLlmBase] = useState(() => localStorage.getItem("orangeradio_llm_base") || "https://open.bigmodel.cn/api/paas/v4");
  const [llmModel, setLlmModel] = useState(() => localStorage.getItem("orangeradio_llm_model") || "glm-4-flash");
  // 音乐生成配置（Studio 创作台用，与上面共用同一个 Key）
  const [musicBase, setMusicBase] = useState(() => localStorage.getItem("orangeradio_minimax_music_base") || "https://api.minimaxi.com");
  const [musicModel, setMusicModel] = useState(() => localStorage.getItem("orangeradio_minimax_music_model") || "music-2.6-free");
  // 创作输出目录（为空表示用应用数据目录默认值 app_data_dir/studio）
  const [outputDir, setOutputDir] = useState(() => localStorage.getItem("orangeradio_studio_output_dir") || "");
  const [keySaved, setKeySaved] = useState(false);

  // 打开时拉一次鉴权状态 + 听歌画像（懂你模式用）
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    invoke<AuthOverview>("auth_overview")
      .then((r) => setAuthItems(r.items))
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
    setProfileLoading(true);
    invoke("get_user_profile")
      .then((p) => setProfile(p as any))
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
  }, [open]);

  // 打开时锁 body 滚动
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  if (!open) return null;

  const handleRelogin = (source: string) => {
    close();
    setView("player");
    setSubView(source as any);
    requestRelogin(source as any);
  };

  const handleSpotifyReconfigure = async () => {
    close();
    setView("player");
    setSubView("spotify");
    // SpotifyView 检测到配置丢失时显示配置 UI —— 这里只需切到子视图
  };

  const handleSpotifyLogout = async () => {
    try {
      await invoke("spotify_logout");
      const r = await invoke<AuthOverview>("auth_overview");
      setAuthItems(r.items);
    } catch (e: any) {
      alert("登出失败: " + (e?.message || e));
    }
  };

  return (
    <div className="settings-overlay" onClick={close}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal__head">
          <h2>设置</h2>
          <button className="settings-modal__close" onClick={close} title="关闭 (Esc)">
            ×
          </button>
        </div>

        <div className="settings-modal__body">
          {/* 鉴权状态总览 */}
          <section className="settings-section">
            <h3 className="settings-section__title">
              🔑 第三方账号登录状态
              <button
                className="settings-refresh"
                onClick={() => invoke<AuthOverview>("auth_overview").then((r) => setAuthItems(r.items)).catch(() => {})}
                title="刷新"
              >
                ↻
              </button>
            </h3>

            {loading && <div className="settings-loading">加载中…</div>}
            {error && <div className="settings-error">⚠️ {error}</div>}

            {!loading && authItems.length > 0 && (
              <div className="auth-list">
                {authItems.map((item) => (
                  <div key={item.source} className={`auth-item ${item.configured ? "auth-item--ok" : "auth-item--none"}`}>
                    <div className="auth-item__icon">
                      {item.source === "netease" ? "🎵" : item.source === "qqmusic" ? "🎶" : "🎧"}
                    </div>
                    <div className="auth-item__info">
                      <div className="auth-item__name">{item.source_name}</div>
                      <div className="auth-item__status">
                        {item.configured ? (
                          <>
                            <span className="auth-dot auth-dot--ok" /> 已登录
                          </>
                        ) : (
                          <>
                            <span className="auth-dot auth-dot--none" /> 未配置
                          </>
                        )}
                      </div>
                      <div className="auth-item__time">
                        上次更新：<strong>{relativeTime(item.saved_at)}</strong>
                        <span className="auth-item__time-detail">（{formatDate(item.saved_at)}）</span>
                      </div>
                    </div>
                    <div className="auth-item__action">
                      {item.source === "spotify" ? (
                        item.configured ? (
                          <button className="btn-link" onClick={handleSpotifyReconfigure}>重新配置</button>
                        ) : (
                          <button className="btn-link" onClick={handleSpotifyReconfigure}>配置</button>
                        )
                      ) : (
                        <button className="btn-link" onClick={() => handleRelogin(item.source)}>
                          {item.configured ? "重新登录" : "登录"}
                        </button>
                      )}
                      {item.source === "spotify" && item.configured && (
                        <button className="btn-link btn-link--danger" onClick={handleSpotifyLogout}>
                          清空
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="settings-note">
              💡 登录态加密存到本地，下次启动自动恢复。<br />
              网易云 / QQ 音乐有后台任务自动续期 cookie；Spotify Client Credentials 1h 自动续 token。
            </div>
          </section>

          {/* 听歌画像（驱动「懂你模式」） */}
          <section className="settings-section">
            <h3 className="settings-section__title">🧠 我的听歌画像</h3>
            {profileLoading && <div className="settings-loading">分析中…</div>}
            {!profileLoading && profile && (
              <div className="settings-meta">
                <div><strong>总听歌时长：</strong>{fmtDuration(profile.total_listen_secs || 0)}</div>
                <div><strong>常听艺人：</strong>{(profile.top_artists || []).slice(0, 8).map(([k, w]) => `${k}(${(w * 100).toFixed(0)})`).join(" · ") || "暂无"}</div>
                <div><strong>常听流派：</strong>{(profile.top_genres || []).slice(0, 8).map(([k, w]) => `${k}(${(w * 100).toFixed(0)})`).join(" · ") || "暂无"}</div>
              </div>
            )}
            {!profileLoading && !profile && (
              <div className="settings-note">多听几首歌，画像会更准（驱动「懂你模式」🧠）</div>
            )}
          </section>

          {/* AI 配置（驱动歌词译注/情感分析） */}
          <section className="settings-section">
            <h3 className="settings-section__title">🤖 AI 配置（MiniMax）</h3>
            <div className="settings-meta settings-ai-form">
              <label className="settings-ai-row">
                <span className="settings-ai-label">API Key</span>
                <input
                  type="password"
                  className="settings-ai-input"
                  placeholder="sk-...（用于歌词译注/情感分析）"
                  value={minimaxKey}
                  onChange={(e) => {
                    setMinimaxKey(e.target.value);
                    localStorage.setItem("orangeradio_minimax_key", e.target.value);
                    setKeySaved(true);
                    window.setTimeout(() => setKeySaved(false), 1500);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
                {keySaved && <span className="settings-ai-saved">已保存</span>}
              </label>
              <label className="settings-ai-row">
                <span className="settings-ai-label">API Base</span>
                <input
                  type="text"
                  className="settings-ai-input"
                  placeholder="https://api.minimaxi.com/anthropic"
                  value={minimaxBase}
                  onChange={(e) => {
                    setMinimaxBase(e.target.value);
                    localStorage.setItem("orangeradio_minimax_base", e.target.value);
                  }}
                  spellCheck={false}
                />
              </label>
              <label className="settings-ai-row">
                <span className="settings-ai-label">Model</span>
                <input
                  type="text"
                  className="settings-ai-input"
                  placeholder="MiniMax-M1"
                  value={minimaxModel}
                  onChange={(e) => {
                    setMinimaxModel(e.target.value);
                    localStorage.setItem("orangeradio_minimax_model", e.target.value);
                  }}
                  spellCheck={false}
                />
              </label>
            </div>
            <div className="settings-note">
              💡 Key 仅存本地 localStorage，不进 git、不上传。配置后可在全屏播放页点 🌐 译注当前歌词。
            </div>
          </section>

          {/* AI 推荐增强（LLM 重排，懂你模式用） */}
          <section className="settings-section">
            <h3 className="settings-section__title">🧠 AI 推荐增强（懂你模式 LLM 重排）</h3>
            <div className="settings-meta settings-ai-form">
              <label className="settings-ai-row">
                <span className="settings-ai-label">Provider</span>
                <select
                  className="settings-ai-input"
                  value={llmProvider}
                  onChange={(e) => {
                    const v = e.target.value as "minimax" | "openai";
                    setLlmProvider(v);
                    localStorage.setItem("orangeradio_llm_provider", v);
                  }}
                >
                  <option value="minimax">复用上方 MiniMax</option>
                  <option value="openai">OpenAI 兼容（GLM/DeepSeek/通义等）</option>
                </select>
              </label>
              {llmProvider === "openai" && (
                <>
                  <label className="settings-ai-row">
                    <span className="settings-ai-label">API Key</span>
                    <input
                      type="password"
                      className="settings-ai-input"
                      placeholder="sk-...（推荐重排用，可为空=纯本地打分）"
                      value={llmKey}
                      onChange={(e) => {
                        setLlmKey(e.target.value);
                        localStorage.setItem("orangeradio_llm_key", e.target.value);
                      }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="settings-ai-row">
                    <span className="settings-ai-label">API Base</span>
                    <input
                      type="text"
                      className="settings-ai-input"
                      placeholder="https://open.bigmodel.cn/api/paas/v4"
                      value={llmBase}
                      onChange={(e) => {
                        setLlmBase(e.target.value);
                        localStorage.setItem("orangeradio_llm_base", e.target.value);
                      }}
                      spellCheck={false}
                    />
                  </label>
                  <label className="settings-ai-row">
                    <span className="settings-ai-label">Model</span>
                    <input
                      type="text"
                      className="settings-ai-input"
                      placeholder="glm-4-flash / deepseek-chat / qwen-plus"
                      value={llmModel}
                      onChange={(e) => {
                        setLlmModel(e.target.value);
                        localStorage.setItem("orangeradio_llm_model", e.target.value);
                      }}
                      spellCheck={false}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="settings-note">
              💡 配置后「懂你模式」会用 LLM 从本地候选 top-20 中选最合适的；未配置则纯本地画像打分，开箱即用。
            </div>
          </section>

          {/* AI 音乐生成配置（Studio 创作台用） */}
          <section className="settings-section">
            <h3 className="settings-section__title">🎵 AI 音乐生成（Studio 创作台）</h3>
            <div className="settings-meta settings-ai-form">
              <div className="settings-note" style={{ marginBottom: 8 }}>
                与上方共用同一个 API Key。下方 Base / Model 用于音乐生成（music_generation 端点）。
              </div>
              <label className="settings-ai-row">
                <span className="settings-ai-label">Music Base</span>
                <input
                  type="text"
                  className="settings-ai-input"
                  placeholder="https://api.minimaxi.com"
                  value={musicBase}
                  onChange={(e) => {
                    setMusicBase(e.target.value);
                    localStorage.setItem("orangeradio_minimax_music_base", e.target.value);
                  }}
                  spellCheck={false}
                />
              </label>
              <label className="settings-ai-row">
                <span className="settings-ai-label">Music Model</span>
                <input
                  type="text"
                  className="settings-ai-input"
                  placeholder="music-2.6-free"
                  value={musicModel}
                  onChange={(e) => {
                    setMusicModel(e.target.value);
                    localStorage.setItem("orangeradio_minimax_music_model", e.target.value);
                  }}
                  spellCheck={false}
                />
              </label>
            </div>
            <div className="settings-note">
              💡 默认 <code>music-2.6-free</code> 限免版（有 RPM 限制）；额度耗尽可切 <code>music-2.6</code> 正式版。
            </div>
          </section>

          {/* 创作输出目录（生成的音频 / 歌词 / 工程文件落盘位置） */}
          <section className="settings-section">
            <h3 className="settings-section__title">📁 创作输出目录（Studio 创作台）</h3>
            <div className="settings-meta settings-ai-form">
              <div className="settings-note" style={{ marginBottom: 8 }}>
                生成的音乐、歌词、分轨、工程文件都会存到这里。留空则使用应用数据目录默认值。
              </div>
              <label className="settings-ai-row">
                <span className="settings-ai-label">输出目录</span>
                <input
                  type="text"
                  className="settings-ai-input"
                  placeholder="（留空 = 应用数据目录 /studio）"
                  value={outputDir}
                  readOnly
                  spellCheck={false}
                />
              </label>
              <div className="settings-ai-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="settings-mini-btn"
                  onClick={async () => {
                    const dir = await pickOutputDir();
                    if (dir) {
                      setOutputDir(dir);
                      localStorage.setItem("orangeradio_studio_output_dir", dir);
                    }
                  }}
                >
                  选择…
                </button>
                <button
                  type="button"
                  className="settings-mini-btn"
                  disabled={!outputDir}
                  onClick={() => {
                    setOutputDir("");
                    localStorage.removeItem("orangeradio_studio_output_dir");
                  }}
                >
                  清除（用默认）
                </button>
                <button
                  type="button"
                  className="settings-mini-btn"
                  disabled={!outputDir}
                  onClick={async () => {
                    try {
                      await openInShell(outputDir);
                    } catch (e) {
                      setError(`打开目录失败: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  }}
                >
                  打开
                </button>
              </div>
            </div>
          </section>

          {/* 关于 */}
          <section className="settings-section">
            <h3 className="settings-section__title">ℹ️ 关于</h3>
            <div className="settings-meta">
              <div><strong>版本：</strong>v0.3.0 · 音源生态</div>
              <div><strong>数据目录：</strong>.orangeradio/</div>
              <div><strong>鉴权存储：</strong>.orangeradio/auth/{`*.bin`}（AES-256-GCM 加密）</div>
              <div><strong>日志：</strong>.orangeradio/logs/</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}