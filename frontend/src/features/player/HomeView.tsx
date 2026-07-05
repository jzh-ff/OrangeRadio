import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { useLibraryStore, type Track } from "../../stores/libraryStore";
import { getCoverUrl } from "./useCover";
import { engineRef } from "../../App";
import { HeroSpectrum } from "./HeroSpectrum";
import { RightWaveFlow } from "./RightWaveFlow";
import "../../styles/home.css";

interface UserProfile {
  top_artists?: [string, number][];
  top_genres?: [string, number][];
  total_listen_secs?: number;
}

type HomeTone = "library" | "mix" | "playlist" | "local";

const TONE: Record<HomeTone, [string, string]> = {
  library: ["#ff6b1a", "#ff3d00"],
  mix: ["#ff9d45", "#00f5d4"],
  playlist: ["#00f5d4", "#73a7ff"],
  local: ["#f4d28a", "#8fe9ff"],
};

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "夜深了，还有旋律陪你";
  if (h < 12) return "早安，调谐今日频率";
  if (h < 18) return "午后，换一首心情";
  return "晚上好，进入私人波段";
}

export function HomeView() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const tracks = usePlayerStore((s) => s.tracks);
  const setSubView = usePlayerStore((s) => s.setSubView);
  const setFullPlayer = usePlayerStore((s) => s.setFullPlayer);
  const setSettingsOpen = usePlayerStore((s) => s.setSettingsOpen);
  const libraryTracks = useLibraryStore((s) => s.tracks);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [recommend, setRecommend] = useState<Track[] | null>(null);

  // ===== Featured 卡视差（鼠标移动驱动） =====
  // 用 CSS 变量 --px / --py / --rx / --ry 注入 transform，避免重渲染
  const [parallax, setParallax] = useState({ px: 0, py: 0, rx: 0, ry: 0 });
  const rafIdRef = useRef<number>(0);

  const handleFeaturedMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / rect.width;
      const dy = (e.clientY - cy) / rect.height;
      // 限制范围避免极端角度，背景图轻移 + 封面浮起 + 微旋转
      setParallax({
        px: dx * 10,
        py: dy * 10,
        rx: -dy * 1.6,
        ry: dx * 1.6,
      });
    });
  }, []);
  const handleFeaturedLeave = useCallback(() => {
    setParallax({ px: 0, py: 0, rx: 0, ry: 0 });
  }, []);

  useEffect(() => {
    invoke<UserProfile>("get_user_profile").then(setProfile).catch(() => setProfile(null));
    invoke<Track[]>("recommend_next").then(setRecommend).catch(() => setRecommend(null));
  }, []);

  const likedCount = libraryTracks.filter((t) => t.liked).length;
  const recentTracks = tracks.slice(-5).reverse();
  const topArtists = profile?.top_artists?.slice(0, 3) || [];
  const heroCover = getCoverUrl(currentTrack);

  const cards: {
    id: string;
    label: string;
    title: string;
    sub: string;
    tone: HomeTone;
    featured?: boolean;
    cover?: string | null;
    onClick: () => void;
  }[] = [
    {
      id: "library",
      label: "Library",
      title: "我的歌单",
      sub: `${libraryTracks.length} 首 · ${likedCount} 收藏`,
      tone: "library",
      featured: true,
      cover: getCoverUrl(libraryTracks[0]),
      onClick: () => setSubView("library"),
    },
    {
      id: "daily",
      label: "Daily",
      title: recommend?.[0]?.meta.title || "每日推荐",
      sub: recommend ? "根据最近播放生成" : "多听几首解锁",
      tone: "mix",
      cover: getCoverUrl(recommend?.[0]),
      onClick: () => {
        if (recommend?.length) {
          usePlayerStore.getState().setQueue(recommend);
          engineRef.playTrack(recommend[0], 0);
        }
      },
    },
    {
      id: "radio",
      label: "Radio",
      title: "私人电台",
      sub: `${likedCount} 首收藏随机漫游`,
      tone: "playlist",
      cover: getCoverUrl(libraryTracks.find((t) => t.liked)),
      onClick: () => {
        const liked = libraryTracks.filter((t) => t.liked);
        if (liked.length) {
          usePlayerStore.getState().setQueue(liked);
          engineRef.playTrack(liked[Math.floor(Math.random() * liked.length)], 0);
        }
      },
    },
    {
      id: "continue",
      label: "Resume",
      title: recentTracks[0]?.meta.title || "继续听",
      sub: recentTracks.length ? `最近 ${recentTracks.length} 首` : "暂无播放历史",
      tone: "mix",
      cover: getCoverUrl(recentTracks[0]),
      onClick: () => {
        if (recentTracks.length) {
          usePlayerStore.getState().setQueue(recentTracks);
          engineRef.playTrack(recentTracks[0], 0);
        }
      },
    },
    {
      id: "profile",
      label: "Profile",
      title: "听歌画像",
      sub: profile
        ? `${Math.floor((profile.total_listen_secs || 0) / 3600) || Math.floor((profile.total_listen_secs || 0) / 60)}${(profile.total_listen_secs || 0) >= 3600 ? " 小时" : " 分钟"} 总时长`
        : "画像生成中",
      tone: "local",
      onClick: () => setSettingsOpen(true),
    },
    {
      id: "artist",
      label: "Artist",
      title: topArtists[0]?.[0] || "常听歌手",
      sub: topArtists.length ? `Top · ${topArtists.map(([a]) => a).join(" / ")}` : "数据积累中",
      tone: "local",
      onClick: () => setSubView("search"),
    },
  ];

  const tiles = [
    ...recentTracks.slice(0, 3).map((t) => ({
      title: t.meta.title,
      sub: t.meta.artist,
      cover: getCoverUrl(t),
      onClick: () => engineRef.playTrack(t, 0),
    })),
    ...(recommend?.slice(0, 2) || []).map((t) => ({
      title: t.meta.title,
      sub: "推荐",
      cover: getCoverUrl(t),
      onClick: () => {
        usePlayerStore.getState().setQueue(recommend!);
        engineRef.playTrack(t, 0);
      },
    })),
  ];
  while (tiles.length < 5 && tiles.length < libraryTracks.length) {
    const t = libraryTracks[tiles.length]!;
    tiles.push({
      title: t.meta.title,
      sub: t.meta.artist,
      cover: getCoverUrl(t),
      onClick: () => engineRef.playTrack(t, 0),
    });
  }

  return (
    <div className="home">
      <header className="home-hero">
        {/* Live 频谱条（顶替原 signal bar） */}
        <HeroSpectrum />

        <div className="home-hero__copy">
          <div className="home-hero__kicker">
            <span className="home-hero__index">01</span>
            <span className="home-hero__rule" />
            <span className="home-hero__eyebrow">{greeting()}</span>
            <span className={`eq-mini ${isPlaying ? "" : "eq-mini--mute"}`} aria-hidden>
              <i /><i /><i /><i /><i />
            </span>
          </div>

          <h1 className="home-hero__title">
            {currentTrack ? (
              currentTrack.meta.title
            ) : (
              <>
                调谐你的<br />
                <em>音乐宇宙</em>
              </>
            )}
          </h1>

          <p className="home-hero__lead">
            {currentTrack
              ? currentTrack.meta.artist
              : "本地曲库、沉浸视觉与 AI 译注，收进同一台深夜电台控制台。"}
          </p>

          <div className="home-hero__actions">
            {currentTrack ? (
              <>
                <button type="button" className="home-btn home-btn--primary" onClick={() => setFullPlayer(true)}>
                  进入播放详情
                </button>
                <span className={`home-hero__status ${isPlaying ? "is-live" : ""}`}>
                  {isPlaying ? "正在播出" : "已暂停"}
                </span>
              </>
            ) : (
              <button type="button" className="home-btn home-btn--primary" onClick={() => setSubView("library")}>
                浏览音乐库
              </button>
            )}
          </div>
        </div>

        <div className="home-hero__stage" aria-hidden>
          {/* 从右往左的声波瀑布：spectrum 数据驱动，真实跟随音乐 */}
          <RightWaveFlow />
          {heroCover && (
            <div className="home-hero__vinyl">
              <div className="home-hero__vinyl-shadow">
                <img src={heroCover} alt="" />
              </div>
              <div className="home-hero__vinyl-disc">
                <img src={heroCover} alt="" />
              </div>
              <span className="home-hero__vinyl-folio">FOLIO · NO.01</span>
            </div>
          )}
        </div>

        <div className="home-hero__corner home-hero__corner--br">
          <span>FREQ 92.6 MHz</span>
        </div>
      </header>

      <section className="home-bento" aria-label="快捷入口">
        {cards.map((c) => {
          const [a, b] = TONE[c.tone];
          const isCoverFeatured = !!(c.featured && c.cover);
          // 仅 featured 卡接收视差；其他卡用空函数避免每个卡都绑事件
          const mouseProps = isCoverFeatured
            ? {
                onMouseMove: handleFeaturedMove,
                onMouseLeave: handleFeaturedLeave,
              }
            : {};
          // featured 卡额外注入视差 CSS 变量
          const styleExtra = isCoverFeatured
            ? ({
                ["--tone-a" as string]: a,
                ["--tone-b" as string]: b,
                ["--cover-url" as string]: `url("${c.cover}")`,
                ["--px" as string]: `${parallax.px}px`,
                ["--py" as string]: `${parallax.py}px`,
                ["--rx" as string]: `${parallax.rx}deg`,
                ["--ry" as string]: `${parallax.ry}deg`,
              } as React.CSSProperties)
            : ({
                ["--tone-a" as string]: a,
                ["--tone-b" as string]: b,
                ...(c.cover ? { ["--cover-url" as string]: `url("${c.cover}")` } : {}),
              } as React.CSSProperties);
          return (
            <button
              key={c.id}
              type="button"
              className={`home-card ${c.featured ? "home-card--featured" : ""} ${isCoverFeatured ? "home-card--cover" : ""}`}
              style={styleExtra}
              onClick={c.onClick}
              {...mouseProps}
            >
              <span className="home-card__eyebrow">{c.label}</span>
              <span className="home-card__title">{c.title}</span>
              <span className="home-card__sub">{c.sub}</span>
              <div className="home-card__art">
                {c.cover ? <img src={c.cover} alt="" /> : <div className="home-card__disc" />}
              </div>
            </button>
          );
        })}
      </section>

      {tiles.length > 0 && (
        <section className="home-queue">
          <div className="home-queue__head">
            <h2 className="home-queue__title">
              预听着
              <span className="home-queue__index">— PREVIEW · {String(tiles.length).padStart(2, "0")} / 05</span>
            </h2>
            <span className="home-queue__hint">最近播放与推荐</span>
          </div>
          <div className="home-queue__track">
            {tiles.map((t, i) => (
              <button key={i} type="button" className="home-queue__item" onClick={t.onClick}>
                <span className="home-queue__num">{String(i + 1).padStart(2, "0")}</span>
                <div className="home-queue__cover">
                  {t.cover ? <img src={t.cover} alt="" /> : <div className="home-card__disc" />}
                </div>
                <span className="home-queue__meta">
                  <span className="home-queue__name">{t.title}</span>
                  <span className="home-queue__sub">{t.sub}</span>
                </span>
                <span className="home-queue__spectrum" aria-hidden>
                  <i /><i /><i /><i /><i /><i /><i /><i />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
