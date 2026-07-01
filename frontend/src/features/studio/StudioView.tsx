import { useState, type PointerEvent } from "react";
import "../../styles/studio.css";

const STUDIO_STEPS = [
  { num: 1, title: "灵感输入", desc: "对话 / 哼唱 / 描述风格", icon: "IDEA" },
  { num: 2, title: "AI 写词", desc: "MiniMax LLM 生成结构化歌词", icon: "LYR" },
  { num: 3, title: "AI 作曲编曲", desc: "风格化生成 + STEM 分轨", icon: "ARR" },
  { num: 4, title: "AI 演唱", desc: "音色选择或克隆你的声音", icon: "VOX" },
  { num: 5, title: "多轨编辑", desc: "DAW 时间线 / 钢琴卷帘 / 混音台", icon: "DAW" },
  { num: 6, title: "混音母带", desc: "AI 母带 + 响度归一", icon: "MIX" },
  { num: 7, title: "发布", desc: "社区 / 分享 / 商用授权", icon: "PUB" },
];

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

export function StudioView() {
  const [prompt, setPrompt] = useState("");

  return (
    <div className="studio-view">
      <header className="studio-view__header" onPointerMove={setSpotlight}>
        <div className="studio-view__copy">
          <span className="studio-view__badge">OrangeStudio / v0.6 preview</span>
          <h1 className="studio-view__title">把一句灵感推上母带轨</h1>
          <p className="studio-view__subtitle">
            这里先把 AI 创作流程做成可感知的控制台：提示词、分轨、频谱、时间线都在同一块面板里等待接入。
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

      {/* AI 创作对话框 */}
      <section className="studio-prompt" onPointerMove={setSpotlight}>
        <div className="studio-prompt__label">描述你想要的歌</div>
        <div className="studio-prompt__input-wrap">
          <textarea
            className="studio-prompt__input"
            placeholder="例如：一首 80 年代复古合成器流行，关于夏夜海边的回忆，欢快中带点怀旧，BPM 110..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
          <button className="studio-prompt__btn">开始创作</button>
        </div>
        <div className="studio-prompt__chips">
          {PROMPTS.map((item) => (
            <button key={item} onClick={() => setPrompt(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="studio-prompt__hint">将在 v0.6 上线 · 接入 MiniMax 音乐生成</div>
      </section>

      {/* 创作流程 */}
      <h2 className="section-title">全流程 AI 创作</h2>
      <section className="studio-steps">
        {STUDIO_STEPS.map((step) => (
          <div key={step.num} className="studio-step" onPointerMove={setSpotlight}>
            <div className="studio-step__num">{step.num}</div>
            <div className="studio-step__icon">{step.icon}</div>
            <h3 className="studio-step__title">{step.title}</h3>
            <p className="studio-step__desc">{step.desc}</p>
          </div>
        ))}
      </section>

      {/* DAW 预览区（v0.6 完整实现）*/}
      <h2 className="section-title">多轨编辑器预览</h2>
      <section className="daw-preview">
        <div className="daw-ruler">
          {["00", "04", "08", "12", "16", "20", "24", "28"].map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
        <div className="daw-preview__tracks">
          {["VOX 人声", "DRM 鼓组", "BAS 贝斯", "KEY 和声", "FX 其他"].map((t, i) => (
            <div key={t} className="daw-track">
              <div className="daw-track__label">{t}</div>
              <div className="daw-track__lane">
                <div
                  className="daw-clip"
                  style={{ marginLeft: `${i * 20}px`, width: `${200 - i * 15}px`, opacity: 0.4 + i * 0.12 }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="daw-preview__note">DAW 多轨编辑器 · v0.6 完整上线</div>
      </section>
    </div>
  );
}
