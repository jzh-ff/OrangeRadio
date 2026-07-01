//! AI 推荐引擎（实现 RecommendationEngine trait）
//!
//! 「懂你模式」核心：基于用户画像 + 实时反馈 + 云端 LLM 推理，
//! 动态生成下一首。

use async_trait::async_trait;
use orange_core::recommendation::*;
use orange_core::track::Track;
use orange_core::Result;
use std::sync::Arc;

use crate::provider::LlmProvider;

/// AI 推荐引擎
pub struct AiRecommendationEngine {
    llm: Arc<dyn LlmProvider>,
}

impl AiRecommendationEngine {
    pub fn new(llm: Arc<dyn LlmProvider>) -> Self {
        Self { llm }
    }
}

#[async_trait]
impl RecommendationEngine for AiRecommendationEngine {
    async fn recommend(&self, _profile: &UserProfile, _ctx: &RecommendContext) -> Result<Vec<Track>> {
        // v0.5 实现：将画像 + 上下文序列化为 prompt，调用 LLM 推理
        Ok(vec![])
    }

    async fn next_understand_you(
        &self,
        _profile: &UserProfile,
        _current: Option<&Track>,
        _feedback: &ListenFeedback,
    ) -> Result<Track> {
        // v0.5 实现：懂你模式实时下一首
        Err(orange_core::CoreError::Unsupported("懂你模式尚未实现 (v0.5)".into()))
    }
}
