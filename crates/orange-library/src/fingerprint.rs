//! 听歌识曲：声纹指纹识别
//!
//! 类似 Shazam：录制环境音频几秒，生成 chromaprint 指纹，
//! 与数据库匹配识别歌曲。

use orange_core::track::Track;
use serde::{Deserialize, Serialize};

/// 指纹识别结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecognitionResult {
    pub matched: bool,
    pub track: Option<Track>,
    /// 匹配置信度 (0.0 - 1.0)
    pub confidence: f32,
}

/// 声纹识别器
pub struct FingerprintRecognizer;

impl FingerprintRecognizer {
    pub fn new() -> Self {
        Self
    }

    /// 识别一段录音
    /// v0.8 实现：chromaprint + AcoustID 查询
    pub async fn recognize(
        &self,
        _audio_samples: &[f32],
    ) -> orange_core::Result<RecognitionResult> {
        Ok(RecognitionResult {
            matched: false,
            track: None,
            confidence: 0.0,
        })
    }
}

impl Default for FingerprintRecognizer {
    fn default() -> Self {
        Self::new()
    }
}
