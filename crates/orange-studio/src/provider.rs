//! AudioAIProvider trait —— 创作侧 AI 抽象
//!
//! 抽象音乐创作能力，使 MiniMax / Suno / Udio 等可插拔，
//! 不绑死单一厂商。当前主力实现为 MiniMax。

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// 生成请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationRequest {
    /// 风格描述（自然语言，如 "80年代复古合成器流行，欢快"）
    pub style_prompt: String,
    /// 期望时长（秒）
    pub duration_secs: Option<f32>,
    /// 是否需要 STEM 分轨
    pub need_stems: bool,
    /// 参考歌词（可选）
    pub lyrics: Option<String>,
    /// 参考音频（可选，用于风格模仿）
    pub reference_audio_url: Option<String>,
    /// 自定义参数
    pub params: serde_json::Value,
}

/// 生成结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationResult {
    /// 生成任务 ID（异步生成）
    pub task_id: String,
    /// 完整曲目音频 URL
    pub audio_url: Option<String>,
    /// STEM 分轨（若请求 need_stems）
    pub stems: Option<crate::stems::Stems>,
    /// 状态
    pub status: GenerationStatus,
    /// 错误信息
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerationStatus {
    Pending,
    Processing,
    Succeeded,
    Failed,
}

/// 创作 AI Provider trait
#[async_trait]
pub trait AudioAIProvider: Send + Sync {
    /// Provider 名称
    fn name(&self) -> &str;

    /// 提交生成任务（异步）
    async fn generate(&self, request: &GenerationRequest) -> orange_core::Result<GenerationResult>;

    /// 查询任务状态
    async fn query(&self, task_id: &str) -> orange_core::Result<GenerationResult>;

    /// 支持的能力
    fn capabilities(&self) -> ProviderCapabilities;
}

/// Provider 能力声明
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub music_generation: bool,
    pub stem_separation: bool,
    pub vocal_synthesis: bool,
    pub voice_cloning: bool,
    pub lyrics_writing: bool,
}
