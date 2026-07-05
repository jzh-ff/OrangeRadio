//! AI 演唱 / 音色克隆
//!
//! 选音色或克隆用户音色演唱旋律；支持多语言。

use serde::{Deserialize, Serialize};

/// 音色档案
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceProfile {
    pub id: String,
    pub name: String,
    /// 音色来源：预设 / 克隆
    pub source: VoiceSource,
    /// 语言支持
    pub languages: Vec<String>,
    /// 音域
    pub range: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VoiceSource {
    Preset,
    /// 克隆自用户上传的参考音频
    Cloned {
        reference_url: String,
    },
}

/// 演唱合成器
pub struct VocalSynth {
    provider: Box<dyn crate::provider::AudioAIProvider>,
}

impl VocalSynth {
    pub fn new(provider: Box<dyn crate::provider::AudioAIProvider>) -> Self {
        Self { provider }
    }

    /// 用指定音色演唱歌词 + 旋律
    /// v0.6 实现：MiniMax TTS / 歌声合成
    pub async fn sing(
        &self,
        _voice: &VoiceProfile,
        _lyrics: &str,
        _melody_hint: Option<&str>,
    ) -> orange_core::Result<String> {
        Err(orange_core::CoreError::AiService(
            "AI演唱尚未实现 (v0.6)".into(),
        ))
    }

    /// 克隆音色
    pub async fn clone_voice(
        &self,
        _reference_audio_url: &str,
        _name: &str,
    ) -> orange_core::Result<VoiceProfile> {
        Err(orange_core::CoreError::AiService(
            "音色克隆尚未实现 (v0.6)".into(),
        ))
    }
}
