//! 语音交互助手
//!
//! 纯云端：ASR 上传 + LLM 意图理解 + 自然语言点歌。

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::provider::LlmProvider;

/// 解析后的语音指令
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "intent", rename_all = "snake_case")]
pub enum VoiceCommand {
    /// 播放某首歌
    PlaySong {
        title: String,
        artist: Option<String>,
    },
    /// 播放歌单
    PlayPlaylist {
        name: String,
    },
    /// 切换播放模式
    SetMode {
        mode: orange_core::player::PlaybackMode,
    },
    /// 调音量
    SetVolume {
        volume: f32,
    },
    /// 下一首 / 上一首
    Next,
    Previous,
    /// 暂停 / 恢复
    Pause,
    Resume,
    /// 自由对话
    Chat {
        text: String,
    },
}

/// 语音助手
pub struct VoiceAssistant {
    llm: Arc<dyn LlmProvider>,
}

impl VoiceAssistant {
    pub fn new(llm: Arc<dyn LlmProvider>) -> Self {
        Self { llm }
    }

    /// 识别语音为文本（ASR，v0.5 接云端）
    pub async fn transcribe(&self, _audio: &[f32]) -> orange_core::Result<String> {
        Err(orange_core::CoreError::AiService(
            "ASR 尚未实现 (v0.5)".into(),
        ))
    }

    /// 将文本解析为结构化指令
    pub async fn parse_command(&self, _text: &str) -> orange_core::Result<VoiceCommand> {
        Err(orange_core::CoreError::AiService(
            "语音指令解析尚未实现 (v0.5)".into(),
        ))
    }
}
