import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../stores/playerStore";
import "./profile-panel.css";

/** 后端 UserProfile（crates/orange-core/src/recommendation.rs） */
interface UserProfile {
  top_genres?: [string, number][];
  top_artists?: [string, number][];
  bpm_preference?: { min: number; max: number; center: number; distribution: number[] };
  total_listen_secs?: number;
  [k: string]: unknown;
}

function fmtDuration(secs: number): string {
  if (!secs) return "0 分钟";
  if (secs < 60) return `${secs} 秒`;
  if (secs < 3600) return `${Math.floor(secs / 60)} 分钟`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`;
}

function fmtBpmRange(bpm: { min: number; max: number; center: number }) {
  if (bpm.min === 0 && bpm.max === 0) return "—";
  return `${Math.round(bpm.min)}–${Math.round(bpm.max)} BPM · 中位 ${Math.round(bpm.center)}`;
}

/**
 * ProfilePanel · 听歌画像面板
 *
 * 真实数据来源：Rust 端 `aggregate_user_profile()` 聚合 SQLite 播放历史
 *  - top_artists：常听歌手（按播放时长降序）
 *  - top_genres：常听曲风（按播放时长权重）
 *  - bpm_preference：听歌 BPM 偏好（min/max/center + 分布）
 *  - total_listen_secs：累计播放时长
 *
 * 显示空态：用户从未播放 → "听歌画像未生成，播放几首歌解锁"
 */
export function ProfilePanel() {
  const open = usePlayerStore((s) => s.profileOpen);
  const setOpen = usePlayerStore((s) => s.setProfileOpen);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);

  // 打开时拉数据；关闭不清空（保留上次数据，下次打开秒显）
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    invoke<UserProfile>("get_user_profile")
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const hasData =
    profile &&
    ((profile.total_listen_secs ?? 0) > 0 ||
      (profile.top_artists?.length ?? 0) > 0);

  return (
    <div className="profile-panel__mask" onClick={() => setOpen(false)}>
      <div
        className="profile-panel"
        role="dialog"
        aria-modal="true"
        aria-label="听歌画像"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="profile-panel__head">
          <div>
            <div className="profile-panel__eyebrow">INSIGHT · 01</div>
            <h2 className="profile-panel__title">听歌画像</h2>
          </div>
          <button
            type="button"
            className="profile-panel__close"
            onClick={() => setOpen(false)}
            aria-label="关闭"
            title="关闭（Esc）"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {loading && !profile ? (
          <div className="profile-panel__loading">正在分析播放历史…</div>
        ) : !hasData ? (
          <div className="profile-panel__empty">
            <div className="profile-panel__empty-icon" aria-hidden>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <div className="profile-panel__empty-title">听歌画像未生成</div>
            <p className="profile-panel__empty-desc">
              播放几首歌后，这里会展示你的常听歌手、曲风偏好、BPM 区间等。
            </p>
          </div>
        ) : (
          <div className="profile-panel__body">
            {/* 总览：累计时长 + BPM 偏好 */}
            <div className="profile-panel__row">
              <div className="profile-stat">
                <div className="profile-stat__label">累计播放</div>
                <div className="profile-stat__value profile-stat__value--xl">
                  {fmtDuration(profile!.total_listen_secs ?? 0)}
                </div>
                <div className="profile-stat__hint">
                  基于本地 SQLite 播放历史聚合
                </div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat__label">BPM 偏好</div>
                <div className="profile-stat__value">
                  {fmtBpmRange(profile!.bpm_preference ?? { min: 0, max: 0, center: 0 })}
                </div>
                {/* BPM 分布条 */}
                {profile!.bpm_preference?.distribution && (
                  <div className="profile-bpm">
                    {profile!.bpm_preference!.distribution.map((v, i) => (
                      <span
                        key={i}
                        className="profile-bpm__bar"
                        style={{ height: `${Math.max(2, v * 100)}%` }}
                        title={`Bucket ${i}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Top 歌手 */}
            {(profile!.top_artists?.length ?? 0) > 0 && (
              <section className="profile-section">
                <h3 className="profile-section__title">常听歌手</h3>
                <ol className="profile-top">
                  {(profile!.top_artists ?? []).slice(0, 6).map(([name, weight], i) => {
                    const maxWeight = (profile!.top_artists ?? [])[0]?.[1] || 1;
                    const pct = Math.max(8, (weight / maxWeight) * 100);
                    return (
                      <li key={`${name}-${i}`} className="profile-top__item">
                        <span className="profile-top__rank">{(i + 1).toString().padStart(2, "0")}</span>
                        <span className="profile-top__name">{name}</span>
                        <span className="profile-top__bar">
                          <span className="profile-top__bar-fill" style={{ width: `${pct}%` }} />
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {/* Top 曲风 */}
            {(profile!.top_genres?.length ?? 0) > 0 && (
              <section className="profile-section">
                <h3 className="profile-section__title">常听曲风</h3>
                <div className="profile-genres">
                  {(profile!.top_genres ?? []).slice(0, 8).map(([name, weight], i) => (
                    <span
                      key={`${name}-${i}`}
                      className="profile-genre"
                      style={{ opacity: Math.max(0.4, 1 - i * 0.08) }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
