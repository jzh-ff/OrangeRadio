//! # OrangeRadio AI
//!
//! 播放侧 AI 能力（纯云端大模型）。
//!
//! ## 职责
//! - [`recommend`] —— 智能推荐 + 「懂你模式」实时下一首
//! - [`voice`] —— 语音交互（ASR 上传、自然语言点歌）
//! - [`lyrics`] —— AI 歌词译注（翻译 + 典故 + 创作背景）
//! - [`provider`] —— 抽象大模型 provider（GLM / OpenAI 兼容）
//!
//! 注意：创作侧 AI（MiniMax 写歌/作曲/演唱）在独立 crate `orange-studio`。

pub mod provider;
pub mod recommend;
pub mod voice;
pub mod lyrics;

pub use provider::{LlmProvider, LlmRequest, LlmResponse, CloudLlmProvider};
pub use recommend::AiRecommendationEngine;
pub use voice::{VoiceAssistant, VoiceCommand};
pub use lyrics::{LyricsTranslator, AnnotatedLyrics};
