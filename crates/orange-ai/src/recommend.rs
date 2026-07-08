//! 推荐引擎（实现 RecommendationEngine trait）
//!
//! 「懂你模式」核心：本地画像打分（artist/genre/BPM 加权 + skip 负反馈 +
//! 实时 ListenFeedback + 多样性）作为基础分；可选 LLM 语义重排增强。
//! - 未配置 LLM → 纯本地打分，开箱即用
//! - 配置 LLM → 本地打分取 top-N 候选 → LLM 从中选最合适的（带上下文）

use async_trait::async_trait;
use orange_core::recommendation::*;
use orange_core::track::Track;
use orange_core::Result;
use std::collections::HashSet;
use std::sync::Arc;

use crate::provider::{LlmProvider, LlmRequest};

/// 推荐引擎（本地打分优先；LLM 增强可选）
pub struct AiRecommendationEngine {
    llm: Option<Arc<dyn LlmProvider>>,
}

impl AiRecommendationEngine {
    /// 纯本地推荐引擎（不依赖 LLM，开箱即用）
    pub fn local() -> Self {
        Self { llm: None }
    }

    /// 带 LLM 的推荐引擎（语义重排增强）
    pub fn with_llm(llm: Arc<dyn LlmProvider>) -> Self {
        Self { llm: Some(llm) }
    }

    /// 构造 LLM 重排 prompt（画像 + 候选 + 上下文 → 让 LLM 选最佳）
    fn build_rerank_prompt(
        profile: &UserProfile,
        ctx: &RecommendContext,
        candidates: &[Track],
    ) -> (String, String) {
        let top_artists: Vec<String> = profile
            .top_artists
            .iter()
            .take(8)
            .map(|(n, w)| format!("{n}({w:.2})"))
            .collect();
        let top_genres: Vec<String> = profile
            .top_genres
            .iter()
            .take(8)
            .map(|(n, w)| format!("{n}({w:.2})"))
            .collect();
        let mood_str = ctx
            .mood
            .as_ref()
            .map(|m| format!("{:?}", m))
            .unwrap_or_else(|| "未知".into());
        let scene_str = ctx
            .scene
            .as_ref()
            .map(|s| format!("{:?}", s))
            .unwrap_or_else(|| "未知".into());
        let hour = ctx.now.format("%H").to_string();

        let system = "你是音乐推荐助手。根据用户画像、当前情绪/场景，从候选歌曲中选出最合适的 1 首。只回复歌曲在候选列表中的序号（整数，从 0 开始），不要其他文字。".to_string();

        let cands_json: Vec<String> = candidates
            .iter()
            .enumerate()
            .map(|(i, t)| {
                let bpm = t
                    .meta
                    .bpm
                    .map(|b| format!("{b:.0}"))
                    .unwrap_or_else(|| "-".into());
                let genre = t.meta.genre.first().cloned().unwrap_or_default();
                format!(
                    "[{}] {} - {} | 流派:{} BPM:{}",
                    i, t.meta.title, t.meta.artist, genre, bpm
                )
            })
            .collect();

        let user = format!(
            "用户画像：\n常听艺人: {}\n常听流派: {}\n当前情绪: {}\n当前场景: {} ({}时)\n\n候选歌曲：\n{}\n\n请选出最合适的 1 首的序号：",
            top_artists.join(", "),
            top_genres.join(", "),
            mood_str,
            scene_str,
            hour,
            cands_json.join("\n")
        );
        (system, user)
    }

    /// 用 LLM 从候选里选一首（解析返回的序号）；失败返回 None，由调用方回退本地 top1
    async fn llm_pick(
        &self,
        profile: &UserProfile,
        ctx: &RecommendContext,
        candidates: &[Track],
    ) -> Option<usize> {
        let llm = self.llm.as_ref()?;
        if candidates.is_empty() {
            return None;
        }
        let (system, user) = Self::build_rerank_prompt(profile, ctx, candidates);
        let req = LlmRequest {
            system: Some(system),
            user,
            temperature: Some(0.3),
            max_tokens: Some(16),
        };
        let resp = llm.chat(&req).await.ok()?;
        // 解析序号（LLM 可能返回 "3" 或 "第3首" 或 "序号3"）
        let text = resp.text.trim();
        let num: usize = text.parse().ok().or_else(|| {
            // 提取第一个连续数字
            text.chars()
                .skip_while(|c| !c.is_ascii_digit())
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .ok()
        })?;
        if num < candidates.len() {
            Some(num)
        } else {
            None
        }
    }
}

#[async_trait]
impl RecommendationEngine for AiRecommendationEngine {
    async fn recommend(&self, profile: &UserProfile, ctx: &RecommendContext) -> Result<Vec<Track>> {
        let recent: HashSet<String> = ctx.recent_track_ids.iter().cloned().collect();
        let empty_fb = ListenFeedback::default();
        let mut scored: Vec<(f32, Track)> = ctx
            .candidates
            .iter()
            .filter(|t| !recent.contains(&t.id.0.to_string()))
            .map(|t| (score(t, profile, None, &empty_fb), t.clone()))
            .collect();
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

        // LLM 重排增强：取 top-20 候选让 LLM 选 1 首（失败回退本地 top1）
        if self.llm.is_some() {
            let top_candidates: Vec<Track> =
                scored.iter().take(20).map(|(_, t)| t.clone()).collect();
            if let Some(idx) = self.llm_pick(profile, ctx, &top_candidates).await {
                tracing::info!(
                    "LLM 重排选中第 {} 首: {}",
                    idx,
                    top_candidates[idx].meta.title
                );
                return Ok(top_candidates[idx].clone());
            }
            tracing::debug!("LLM 重排失败，回退本地打分 top1");
        }
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
    let genre_hit = |p: &str| genres.contains(&p);

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
    if profile
        .skip_patterns
        .iter()
        .any(|p| p.as_str() == artist && !artist.is_empty())
    {
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
    // BPM 偏好匹配（曲目有 bpm 元数据时；无则不加分不减分）
    if let Some(bpm) = track.meta.bpm {
        let pref = &profile.bpm_preference;
        let (bucket_weight, _) = if bpm < 90.0 {
            (pref.slow, "slow")
        } else if bpm < 120.0 {
            (pref.medium, "medium")
        } else if bpm < 140.0 {
            (pref.fast, "fast")
        } else {
            (pref.very_fast, "very_fast")
        };
        // 落入偏好高峰档（>0.3）加分，落入低谷档（<0.1）减分
        if bucket_weight > 0.3 {
            s += 0.2;
        } else if bucket_weight < 0.1 {
            s -= 0.2;
        }
    }
    s.max(0.0)
}
