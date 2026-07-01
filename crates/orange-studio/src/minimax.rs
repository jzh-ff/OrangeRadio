//! MiniMax 官方对接
//!
//! 国内音乐 AIGC 最强之一，提供：
//! - LLM（写词、创作意图理解、指令式编辑）
//! - 音乐生成（风格化生成 + STEM 分轨）
//! - TTS / 语音克隆（AI 演唱）
//!
//! 实现 AudioAIProvider trait，未来可被其他厂商替代。

use async_trait::async_trait;
use crate::provider::*;

/// MiniMax Provider
pub struct MiniMaxProvider {
    pub api_key: String,
    pub api_base: String,
    pub client: reqwest::Client,
}

impl MiniMaxProvider {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            api_base: "https://api.minimax.chat".into(),
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl AudioAIProvider for MiniMaxProvider {
    fn name(&self) -> &str { "MiniMax" }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            music_generation: true,
            stem_separation: true,
            vocal_synthesis: true,
            voice_cloning: true,
            lyrics_writing: true,
        }
    }

    async fn generate(&self, _request: &GenerationRequest) -> orange_core::Result<GenerationResult> {
        // v0.6 实现完整 MiniMax 音乐生成 API 调用
        Err(orange_core::CoreError::AiService("MiniMax 生成尚未实现 (v0.6)".into()))
    }

    async fn query(&self, _task_id: &str) -> orange_core::Result<GenerationResult> {
        Err(orange_core::CoreError::AiService("MiniMax 查询尚未实现 (v0.6)".into()))
    }
}
