//! 推荐引擎（实现 RecommendationEngine trait）
//!
//! 「懂你模式」核心：v0.5 用本地画像打分（artist/genre 加权 + skip 负反馈 +
//! 实时 ListenFeedback + 多样性），不依赖 LLM，任何用户开箱可用。
//! LLM 语义增强（with_llm）留后续迭代。

use async_trait::async_trait;
use orange_core::recommendation::*;
use orange_core::track::Track;
use orange_core::Result;
use std::collections::HashSet;
use std::sync::Arc;

use crate::provider::LlmProvider;

/// 推荐引擎（本地打分优先；LLM 增强可选）
pub struct AiRecommendationEngine {
    #[allow(dead_code)]
    llm: Option<Arc<dyn LlmProvider>>,
}

impl AiRecommendationEngine {
    /// 纯本地推荐引擎（不依赖 LLM，开箱即用）
    pub fn local() -> Self {
        Self { llm: None }
    }

    /// 带 LLM 的推荐引擎（未来语义增强用，当前未调用）
    pub fn with_llm(llm: Arc<dyn LlmProvider>) -> Self {
        Self { llm: Some(llm) }
    }
}

#[async_trait]
impl RecommendationEngine for AiRecommendationEngine {
    async fn recommend(
        &self,
        profile: &UserProfile,
        ctx: &RecommendContext,
    ) -> Result<Vec<Track>> {
        let recent: HashSet<String> = ctx.recent_track_ids.iter().cloned().collect();
        let empty_fb = ListenFeedback::default();
        let mut scored: Vec<(f32, Track)> = ctx
            .candidates
            .iter()
            .filter(|t| !recent.contains(&t.id.0.to_string()))
            .map(|t| (score(t, profile, None, &empty_fb), t.clone()))
            .collect();
        // 打分排序（top-N）；分数相近时保留候选原顺序，避免每次完全一样需要随机源
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let limit = ctx.limit.max(1) as usize;
        Ok(scored.into_iter().take(limit).map(|(_, t)| t).collect())
    }

    async fn next_understand_you(
        &self,
        profile: &UserProfile,
        ctx: &RecommendContext,
        current: Option<&Track>,
        feedback: &ListenFeedback,
    ) -> Result<Track> {
        let recent: HashSet<String> = ctx.recent_track_ids.iter().cloned().collect();
        let skipped: HashSet<String> = feedback.skipped.iter().cloned().collect();

        let mut scored: Vec<(f32, Track)> = ctx
            .candidates
            .iter()
            .filter(|t| {
                let id = t.id.0.to_string();
                !recent.contains(&id) && !skipped.contains(&id)
            })
            .map(|t| (score(t, profile, current, feedback), t.clone()))
            .collect();

        // 候选都被排除：放宽（忽略 recent，仅排除 skipped），再不行就全网
        if scored.is_empty() {
            scored = ctx
                .candidates
                .iter()
                .filter(|t| !skipped.contains(&t.id.0.to_string()))
                .map(|t| (score(t, profile, current, feedback), t.clone()))
                .collect();
        }
        if scored.is_empty() {
            return Err(orange_core::CoreError::Unsupported(
                "没有可推荐的候选曲目（曲库为空）".into(),
            ));
        }
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(scored[0].1.clone())
    }
}

/// 给候选曲目打分（越高越推荐）。权重为经验值，可后续调参。
fn score(
    track: &Track,
    profile: &UserProfile,
    current: Option<&Track>,
    feedback: &ListenFeedback,
) -> f32 {
    let mut s: f32 = 1.0;
    let id = track.id.0.to_string();
    let artist = track.meta.artist.trim();
    let genres: Vec<&str> = track.meta.genre.iter().map(|g| g.trim()).collect();
    let genre_hit = |p: &str| genres.iter().any(|g| *g == p);

    // 艺人匹配（top_artists 是 (name, weight) 已归一化到 [0,1]）
    for (name, w) in &profile.top_artists {
        if name.as_str() == artist && !artist.is_empty() {
            s += w * 0.6;
            break;
        }
    }
    // 流派匹配
    for (name, w) in &profile.top_genres {
        if genre_hit(name) {
            s += w * 0.4;
        }
    }
    // 负反馈：跳过率高的艺人/流派
    if profile.skip_patterns.iter().any(|p| p.as_str() == artist && !artist.is_empty()) {
        s -= 0.5;
    }
    if profile.skip_patterns.iter().any(|p| genre_hit(p)) {
        s -= 0.3;
    }
    // 正反馈：完整听完率高的
    if profile
        .complete_patterns
        .iter()
        .any(|p| p.as_str() == artist && !artist.is_empty())
    {
        s += 0.3;
    }
    if profile.complete_patterns.iter().any(|p| genre_hit(p)) {
        s += 0.2;
    }
    // 实时反馈
    if feedback.skipped.iter().any(|x| x == &id) {
        s -= 1.0;
    }
    if feedback.liked.iter().any(|x| x == &id) {
        s += 0.5;
    }
    if feedback.completed.iter().any(|x| x == &id) {
        s += 0.3;
    }
    // 多样性：避免连续同艺人
    if let Some(c) = current {
        if !artist.is_empty() && c.meta.artist.trim() == artist {
            s -= 0.3;
        }
    }
    // 收藏加权
    if track.liked {
        s += 0.2;
    }
    s.max(0.0)
}
