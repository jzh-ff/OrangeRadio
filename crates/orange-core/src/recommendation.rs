//! 推荐引擎 trait
//!
//! 驱动「懂你模式」与个性化推荐。基于用户行为画像 +
//! AI 云端大模型推理生成下一首。

use crate::track::Track;
use crate::Result;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 用户画像（驱动「懂你模式」）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserProfile {
    /// 常听流派及权重
    pub top_genres: Vec<(String, f32)>,
    /// 常听艺人
    pub top_artists: Vec<(String, f32)>,
    /// 时段偏好（一天 24 小时的播放热度分布）
    pub hourly_activity: [f32; 24],
    /// BPM 偏好分布
    pub bpm_preference: BpmPreference,
    /// 跳过率高的特征（用于负反馈）
    pub skip_patterns: Vec<String>,
    /// 完整听完率高的特征（用于正反馈）
    pub complete_patterns: Vec<String>,
    /// 最近收藏
    pub recent_likes: Vec<String>,
    /// 听歌总时长（秒）
    pub total_listen_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BpmPreference {
    /// 各 BPM 区间偏好：慢(<90) / 中(90-120) / 快(120-140) / 极快(>140)
    pub slow: f32,
    pub medium: f32,
    pub fast: f32,
    pub very_fast: f32,
}

impl Default for BpmPreference {
    fn default() -> Self {
        Self {
            slow: 0.25,
            medium: 0.35,
            fast: 0.25,
            very_fast: 0.15,
        }
    }
}

/// 推荐上下文（实时场景）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendContext {
    /// 当前时间
    pub now: DateTime<Utc>,
    /// 当前天气（可选，天气电台用）
    pub weather: Option<WeatherMood>,
    /// 用户当前情绪（可选，由 AI 推断）
    pub mood: Option<Mood>,
    /// 当前场景
    pub scene: Option<Scene>,
    /// 最近播放的曲目 ID（避免重复）
    pub recent_track_ids: Vec<String>,
    /// 期望数量
    pub limit: u32,
    /// 候选曲目池（由调用方注入，如本地库 + 跨源收藏）；引擎从中打分挑选，
    /// 避免 ai crate 反向依赖 library
    #[serde(default)]
    pub candidates: Vec<Track>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherMood {
    pub city: String,
    pub condition: String,
    pub temperature: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mood {
    Happy,
    Sad,
    Calm,
    Energetic,
    Focused,
    Romantic,
    Nostalgic,
    Melancholy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scene {
    Work,
    Study,
    Workout,
    Commute,
    Sleep,
    Party,
    Relax,
    Driving,
}

/// 推荐引擎 trait
///
/// 实现可对接云端大模型 (GLM 等) 做语义推理。
#[async_trait]
pub trait RecommendationEngine: Send + Sync {
    /// 基于画像 + 上下文生成推荐
    async fn recommend(&self, profile: &UserProfile, ctx: &RecommendContext) -> Result<Vec<Track>>;

    /// 「懂你模式」核心：基于实时行为（跳过/收藏/完整听完）
    /// 动态决定队列中的下一首
    async fn next_understand_you(
        &self,
        profile: &UserProfile,
        ctx: &RecommendContext,
        current: Option<&Track>,
        feedback: &ListenFeedback,
    ) -> Result<Track>;
}

/// 实时收听反馈（驱动「懂你模式」实时调整）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListenFeedback {
    /// 跳过过的曲目 ID
    pub skipped: Vec<String>,
    /// 收藏的曲目 ID
    pub liked: Vec<String>,
    /// 完整听完的曲目 ID
    pub completed: Vec<String>,
}
