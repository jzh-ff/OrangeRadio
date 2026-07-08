import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { useLibraryStore, type Track } from "../../stores/libraryStore";
import { getCoverUrl } from "./useCover";
import { engineRef } from "../../App";
import { getLlmConfig } from "../../lib/llmConfig";
import { HeroSpectrum } from "./HeroSpectrum";
import { RightWaveFlow } from "./RightWaveFlow";
import "../../styles/home.css";

/** 后端 aggregate_user_profile 返回的画像（完整字段）
 *  缺失或为 0 表示用户尚未产生听歌数据
 */
interface UserProfile {
  top_artists?: [string, number][];
  top_genres?: [string, number][];
  bpm_preference?: { min: number; max: number; center: number; distribution: number[] };
  total_listen_secs?: number;
  [k: string]: unknown;
}

type HomeTone = "library" | "mix" | "playlist" | "local";

const TONE: Record<HomeTone, [string, string]> = {
  library: ["#ff6b1a", "#ff3d00"],
  mix: ["#ff9d45", "#00f5d4"],
  playlist: ["#00f5d4", "#73a7ff"],
  local: ["#f4d28a", "#8fe9ff"],
};

/** 来源徽章（与 SearchView/LibraryView 全局一致） */
const SOURCE_BADGE: Record<string, { label: string; cls: string; color: string }> = {
  local:          { label: "本", cls: "q-std",     color: "#b9c7c4" },
  netease_cloud_music: { label: "NE", cls: "q-lossless", color: "#d63d3d" },
  qq_music:       { label: "QQ", cls: "q-high",    color: "#4ea3ff" },
  kugou:          { label: "KG", cls: "q-high",    color: "#7adfb0" },
  kuwo:           { label: "KW", cls: "q-high",    color: "#ff8a4c" },
  qishui:         { label: "QS", cls: "q-hires",   color: "#c084fc" },
  gequbao:        { label: "GQB", cls: "q-high",   color: "#9cffdf" },
  spotify:        { label: "SP", cls: "q-master",  color: "#1ed760" },
  apple_music:    { label: "AM", cls: "q-master",  color: "#fc3c5c" },
  web_radio:      { label: "LIVE", cls: "q-hires", color: "#f4d28a" },
  podcast:        { label: "POD", cls: "q-std",    color: "#a8c4d6" },
};

/** 统计一个曲库的来源分布（按数量降序） */
function countSources(tracks: Track[]): { key: string; count: number; label: string; color: string }[] {
  const m: Record<string, number> = {};
  for (const t of tracks) {
    const k = (t.source_kind as string) || "local";
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      key,
      count,
      label: SOURCE_BADGE[key]?.label || key,
      color: SOURCE_BADGE[key]?.color || "#b9c7c4",
    }));
}

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
    invoke<Track[]>("recommend_next", { llmConfig: getLlmConfig() }).then(setRecommend).catch(() => setRecommend(null));
  }, []);

  /** AI 推荐：重新拉取推荐队列并立即播放 */
  const refreshRecommend = () => {
    usePlayerStore.getState().setSmartAction("recommend");
    invoke<Track[]>("recommend_next", { limit: 10, llmConfig: getLlmConfig() })
      .then((list) => {
        if (list.length) {
          setRecommend(list);
          usePlayerStore.getState().setQueue(list);
          engineRef.playTrack(list[0], 0);
        }
      })
      .catch(() => {});
  };

  const likedCount = libraryTracks.filter((t) => t.liked).length;
  const recentTracks = tracks.slice(-5).reverse();
  const topArtists = profile?.top_artists?.slice(0, 3) || [];
  const heroCover = getCoverUrl(currentTrack);

  // ===== 数据真实性判断（决定标题/副标题显示真实数据 vs 明确空态）=====
  const hasProfile = (profile?.total_listen_secs ?? 0) > 0;
  const totalSecs = profile?.total_listen_secs ?? 0;
  const fmtTotal = (s: number) => {
    if (s >= 3600) return `${Math.floor(s / 3600)} 小时总时长`;
    if (s >= 60) return `${Math.floor(s / 60)} 分钟总时长`;
    return `${s} 秒总时长`;
  };
  const openProfilePanel = () => usePlayerStore.getState().setProfileOpen(true);

  const cards: {
    id: string;
    label: string;
    title: string;
    sub: string;
    tone: HomeTone;
    featured?: boolean;
    cover?: string | null;
    /** 封面右下角叠加的来源徽章（最多 4 个） */
    sourceBadges?: { key: string; count: number; label: string; color: string }[];
    onClick: () => void;
  }[] = [
    {
      id: "library",
      label: "Library",
      title: "我的歌单",
      sub: (() => {
        const list = countSources(libraryTracks);
        const total = libraryTracks.length;
        if (total === 0) return "还没有歌曲，去搜一首吧";
        // 拼成 "本 32 · NE 18 · QQ 12 · 共 78"
        const shown = list.slice(0, 3);
        const left = total - shown.reduce((s, x) => s + x.count, 0);
        return [
          ...shown.map((x) => `${x.label} ${x.count}`),
          left > 0 ? `其他 ${left}` : null,
          `共 ${total}`,
        ].filter(Boolean).join(" · ");
      })(),
      tone: "library",
      featured: true,
      cover: getCoverUrl(libraryTracks[0]),
      sourceBadges: countSources(libraryTracks).slice(0, 4),  // 封面右下角徽章层
      onClick: () => setSubView("library"),
    },
    {
      id: "daily",
      label: "Daily",
      // 真实数据：recommend 列表的第一首
      title: recommend?.[0]?.meta.title ?? "暂无推荐",
      sub: recommend?.length
        ? `基于最近 ${recentTracks.length || "几首"} 播放生成 · ${recommend.length} 首候选`
        : "多听几首歌解锁",
      tone: "mix",
      cover: getCoverUrl(recommend?.[0]),
      onClick: () => {
        if (recommend?.length) {
          usePlayerStore.getState().setQueue(recommend);
          engineRef.playTrack(recommend[0], 0);
        } else {
          setSubView("library");
        }
      },
    },
    {
      id: "radio",
      label: "Radio",
      title: "私人电台",
      sub: likedCount
        ? `${likedCount} 首收藏随机漫游`
        : "收藏几首歌开启漫游",
      tone: "playlist",
      cover: getCoverUrl(libraryTracks.find((t) => t.liked)),
      onClick: () => {
        const liked = libraryTracks.filter((t) => t.liked);
        if (liked.length) {
          usePlayerStore.getState().setQueue(liked);
          engineRef.playTrack(liked[Math.floor(Math.random() * liked.length)], 0);
        } else {
          setSubView("library");
        }
      },
    },
    {
      id: "continue",
      label: "Resume",
      // 真实数据：最近播放的最后一首
      title: recentTracks[0]?.meta.title ?? "暂无播放历史",
      sub: recentTracks.length
        ? `最近 ${recentTracks.length} 首 · 上一首：${recentTracks[1]?.meta.artist ?? recentTracks[0].meta.artist}`
        : "去音乐库挑首歌开始",
      tone: "mix",
      cover: getCoverUrl(recentTracks[0]),
      onClick: () => {
        if (recentTracks.length) {
          usePlayerStore.getState().setQueue(recentTracks);
          engineRef.playTrack(recentTracks[0], 0);
        } else {
          setSubView("library");
        }
      },
    },
    {
      id: "profile",
      label: "Profile",
      // 真实数据：累计播放时长 + 是否有数据
      title: hasProfile ? fmtTotal(totalSecs) : "听歌画像未生成",
      sub: hasProfile
        ? topArtists[0]
          ? `常听：${topArtists[0][0]}${topArtists[1] ? " / " + topArtists[1][0] : ""}`
          : "播放历史聚合自本地 SQLite"
        : "播放几首歌后自动生成",
      tone: "local",
      onClick: openProfilePanel,
    },
    {
      id: "artist",
      label: "Artist",
      // 真实数据：top_artists 第一个
      title: topArtists[0]?.[0] ?? "尚未统计",
      sub: topArtists.length
        ? `Top · ${topArtists.map(([a]) => a).join(" / ")}`
        : "播放更多歌曲后显示常听歌手",
      tone: "local",
      onClick: openProfilePanel,
    },
  ];

  const tiles: { title: string; sub: string; source: "最近" | "推荐" | "本地"; cover: string | null; onClick: () => void }[] = [
    ...recentTracks.slice(0, 3).map((t) => ({
      title: t.meta.title,
      sub: t.meta.artist,
      source: "最近" as const,
      cover: getCoverUrl(t),
      onClick: () => engineRef.playTrack(t, 0),
    })),
    ...(recommend?.slice(0, 2) || []).map((t) => ({
      title: t.meta.title,
      sub: t.meta.artist,
      source: "推荐" as const,
      cover: getCoverUrl(t),
      onClick: () => {
        usePlayerStore.getState().setQueue(recommend!);
        engineRef.playTrack(t, 0);
      },
    })),
  ];
  // 不足 5 个时：用本地库补齐（同时明确标 "本地" 来源，不混充"推荐"）
  while (tiles.length < 5 && tiles.length < libraryTracks.length) {
    const t = libraryTracks[tiles.length]!;
    tiles.push({
      title: t.meta.title,
      sub: t.meta.artist,
      source: "本地" as const,
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
            <button type="button" className="home-btn home-btn--ghost" onClick={refreshRecommend} title="根据听歌画像重新生成推荐">
              AI 推荐
            </button>
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
              <span className="home-hero__vinyl-folio">
                {currentTrack
                  ? `${currentTrack.meta.title.slice(0, 12)}${currentTrack.meta.title.length > 12 ? "…" : ""} · ${currentTrack.meta.artist.slice(0, 10)}${currentTrack.meta.artist.length > 10 ? "…" : ""}`
                  : "FOLIO · EMPTY"}
              </span>
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
                {/* 来源徽章层（右下角，最多 4 个：NE 18 / QQ 12 / KG 8 ...） */}
                {c.sourceBadges && c.sourceBadges.length > 0 && (
                  <div className="home-card__badges">
                    {c.sourceBadges.map((b) => (
                      <span
                        key={b.key}
                        className="home-card__badge"
                        style={{ ["--badge-color" as string]: b.color }}
                        title={`${b.label}: ${b.count} 首`}
                      >
                        {b.label} <em>{b.count}</em>
                      </span>
                    ))}
                  </div>
                )}
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
                  <span className="home-queue__sub">
                    <span className={`home-queue__src home-queue__src--${t.source}`}>{t.source}</span>
                    <span className="home-queue__sep">·</span>
                    {t.sub}
                  </span>
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
