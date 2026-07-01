import { LibraryView } from "./LibraryView";
import "../../styles/player.css";

const FEATURES = [
  { title: "Hi-Res 高保真", desc: "FLAC/WAV/ALAC 无损解码，专业 DSP", icon: "🎧", stage: "v0.2" },
  { title: "沉浸式视觉", desc: "Three.js 粒子频谱随音乐律动", icon: "🌌", stage: "v0.2" },
  { title: "懂你模式", desc: "AI 行为画像驱动动态推荐", icon: "🧠", stage: "v0.5" },
  { title: "AI 歌词译注", desc: "实时翻译 + 典故标注", icon: "📝", stage: "v0.5" },
  { title: "AI 音乐创作", desc: "MiniMax 写词 / 作曲 / 演唱", icon: "🎹", stage: "v0.6" },
  { title: "智能光效", desc: "Hue / RGB 灯随音乐跳动", icon: "💡", stage: "v0.8" },
];

export function PlayerView() {
  return (
    <div className="player-view">
      <header className="player-view__header">
        <h1 className="player-view__title">音乐库</h1>
        <p className="player-view__subtitle">OrangeRadio · 沉浸式智能音乐播放器</p>
      </header>

      <LibraryView />

      <h2 className="section-title">核心能力</h2>
      <section className="feature-grid">
        {FEATURES.map((f) => (
          <div key={f.title} className="feature-card">
            <div className="feature-card__top">
              <span className="feature-card__icon">{f.icon}</span>
              <span className="feature-card__stage">{f.stage}</span>
            </div>
            <h3 className="feature-card__title">{f.title}</h3>
            <p className="feature-card__desc">{f.desc}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
