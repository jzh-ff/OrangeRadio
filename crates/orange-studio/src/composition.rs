//! AI 作曲 / 编曲生成
//!
//! 风格描述 → 完整伴奏 + 旋律。可选 STEM 分轨导出。

use serde::{Deserialize, Serialize};

/// 作曲风格
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositionStyle {
    pub genre: String,        // 流派：流行/电子/摇滚/古风/Lo-Fi...
    pub tempo_bpm: Option<f32>,
    pub musical_key: Option<String>,
    pub instruments: Vec<String>,
    pub mood: String,
}

/// 作曲结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositionResult {
    /// 完整混音音频 URL
    pub mixed_audio_url: String,
    /// 时长
    pub duration_secs: f32,
    /// BPM
    pub bpm: f32,
    /// 调性
    pub musical_key: String,
    /// 和弦进行
    pub chord_progression: Vec<String>,
    /// STEM 分轨（若请求）
    pub stems: Option<crate::stems::Stems>,
}

/// 作曲器
pub struct Composer {
    provider: Box<dyn crate::provider::AudioAIProvider>,
}

impl Composer {
    pub fn new(provider: Box<dyn crate::provider::AudioAIProvider>) -> Self {
        Self { provider }
    }

    /// 根据风格生成完整曲目
    pub async fn compose(&self, style: &CompositionStyle, lyrics: Option<&str>) -> orange_core::Result<CompositionResult> {
        let request = crate::provider::GenerationRequest {
            style_prompt: format!("{}, {}, BPM: {:?}", style.mood, style.genre, style.tempo_bpm),
            duration_secs: None,
            need_stems: true,
            lyrics: lyrics.map(|s| s.to_string()),
            reference_audio_url: None,
            params: serde_json::json!({}),
        };
        let result = self.provider.generate(&request).await?;
        Ok(CompositionResult {
            mixed_audio_url: result.audio_url.unwrap_or_default(),
            duration_secs: 180.0,
            bpm: style.tempo_bpm.unwrap_or(120.0),
            musical_key: style.musical_key.clone().unwrap_or_else(|| "C major".into()),
            chord_progression: vec![],
            stems: result.stems,
        })
    }
}
