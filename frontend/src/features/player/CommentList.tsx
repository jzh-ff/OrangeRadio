import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface HotComment {
  content: string;
  nickname: string;
  avatar_url: string | null;
  liked_count: number;
}

interface CommentData {
  total: number;
  hot_comments: HotComment[];
}

/** 格式化点赞数 */
function fmtCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

/**
 * 热门评论列表（多源支持：网易云 / QQ 音乐）
 *
 * 根据 sourceKind 分发到对应音源的评论命令。两源在 IPC 层返回同构 shape：
 * `{ total, hot_comments: [{ content, nickname, avatar_url, liked_count }] }`
 */
export function CommentList({
  songId,
  compact,
  sourceKind,
}: {
  songId: string;
  compact?: boolean;
  sourceKind?: string;
}) {
  const [data, setData] = useState<CommentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!songId) {
      setData(null);
      return;
    }
    // 按音源分发评论命令
    const cmd =
      sourceKind === "netease_cloud_music"
        ? "netease_comments"
        : sourceKind === "qq_music"
        ? "qqmusic_comments"
        : null;
    if (!cmd) {
      // 该音源暂不支持评论（酷我/酷狗/歌曲宝等）
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    invoke<CommentData>(cmd, { songId, limit: 20 })
      .then((d) => setData(d))
      .catch((e) => setError(e?.message || "评论加载失败"))
      .finally(() => setLoading(false));
  }, [songId, sourceKind]);

  if (loading) {
    return (
      <div className="cl-list">
        {[1, 2, 3].map((i) => (
          <div className="cl-skeleton" key={i}>
            <div className="cl-skeleton__avatar" />
            <div className="cl-skeleton__body">
              <div className="cl-skeleton__name" />
              <div className="cl-skeleton__text" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="cl-empty">{error}</div>;
  }

  if (!data || data.hot_comments.length === 0) {
    return <div className="cl-empty">暂无评论</div>;
  }

  return (
    <div className="cl-list">
      {!compact && (
        <div className="cl-header">
          热门评论 <span className="cl-total">{data.total > 0 ? `· ${fmtCount(data.total)}条` : ""}</span>
        </div>
      )}
      {data.hot_comments.map((c, i) => (
        <div className="cl-item" key={i}>
          {c.avatar_url ? (
            <img className="cl-avatar" src={c.avatar_url} alt={c.nickname} loading="lazy" />
          ) : (
            <div className="cl-avatar cl-avatar--placeholder">{c.nickname[0] || "?"}</div>
          )}
          <div className="cl-body">
            <div className="cl-name">{c.nickname}</div>
            <div className="cl-content">{c.content}</div>
            <div className="cl-meta">
              <span className="cl-like">{fmtCount(c.liked_count)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
