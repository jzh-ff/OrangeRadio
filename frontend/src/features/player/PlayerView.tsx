import type { PointerEvent } from "react";
import { LibraryView } from "./LibraryView";
import { useLibraryStore } from "../../stores/libraryStore";
import { usePlayerStore, type PlaybackMode } from "../../stores/playerStore";
import "../../styles/player.css";

const FEATURES = [
  { title: "Hi-Res 高保真", desc: "FLAC/WAV/ALAC 无损解码，专业 DSP", icon: "24B", stage: "v0.2", live: true },
  { title: "沉浸式视觉", desc: "Three.js 粒子频谱随音乐律动", icon: "VIS", stage: "v0.2", live: true },
  { title: "懂你模式", desc: "AI 行为画像驱动动态推荐", icon: "YOU", stage: "v0.5", live: false },
  { title: "AI 歌词译注", desc: "实时翻译 + 典故标注", icon: "LYR", stage: "v0.5", live: false },
  { title: "AI 音乐创作", desc: "MiniMax 写词 / 作曲 / 演唱", icon: "STU", stage: "v0.6", live: false },
  { title: "智能光效", desc: "Hue / RGB 灯随音乐跳动", icon: "HUE", stage: "v0.8", live: false },
];

const MODE_LABELS: Record<PlaybackMode, string> = {
  sequence: "顺序播放",
  list_loop: "列表循环",
  single_loop: "单曲循环",
  shuffle: "随机播放",
  understand_you: "懂你模式",
};

const setSpotlight = (event: PointerEvent<HTMLElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
};

export function PlayerView() {
  const trackCount = useLibraryStore((s) => s.tracks.length);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const mode = usePlayerStore((s) => s.mode);

  return (
    <div className="player-view">
      <header className="player-hero" onPointerMove={setSpotlight}>
        <div className="player-hero__copy">
          <div className="signal-chip">
            <span className="signal-chip__dot" />
            ORANGE WAVE 92.6
          </div>
          <h1 className="player-view__title">调谐你的本地音乐宇宙</h1>
          <p className="player-view__subtitle">
            本地曲库、沉浸视觉和 AI 创作工作台被收进同一台深夜电台控制台。
          </p>
          <div className="player-hero__stats">
            <span><strong>{trackCount}</strong> tracks</span>
            <span><strong>{MODE_LABELS[mode]}</strong> mode</span>
            <span><strong>{currentTrack ? "LOCKED" : "STANDBY"}</strong> signal</span>
          </div>
        </div>

        <div className="player-hero__console" aria-hidden="true">
          <div className="tuner">
            <div className="tuner__top">
              <span>FM</span>
              <strong>{currentTrack?.meta.title || "OrangeRadio"}</strong>
            </div>
            <div className="tuner__rail">
              {Array.from({ length: 18 }).map((_, i) => (
                <span key={i} className={i % 3 === 0 ? "is-major" : ""} />
              ))}
              <i />
            </div>
            <div className="tuner__bars">
              {[44, 72, 58, 90, 64, 36, 78, 52, 84, 48].map((height, i) => (
                <span key={i} style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        </div>
      </header>

      <LibraryView />

      <h2 className="section-title">核心能力</h2>
      <section className="feature-grid">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className={`feature-card ${f.live ? "feature-card--live" : "feature-card--next"}`}
            onPointerMove={setSpotlight}
          >
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
