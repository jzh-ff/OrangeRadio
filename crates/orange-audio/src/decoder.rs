//! 音频解码器
//!
//! v0.1 骨架：定义解码 trait，v0.2 将接入 symphonia 实现完整 Hi-Res 解码。

use orange_core::audio_format::AudioFormat;
use orange_core::Result;

/// 解码后的 PCM 音频数据
pub struct DecodedAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_secs: f64,
}

/// 解码器 trait
pub trait Decoder: Send + Sync {
    /// 支持的格式
    fn supports(&self, format: AudioFormat) -> bool;

    /// 从字节流解码
    fn decode(&self, data: &[u8]) -> Result<DecodedAudio>;
}

/// 占位解码器（v0.1）
pub struct StubDecoder;

impl Decoder for StubDecoder {
    fn supports(&self, _format: AudioFormat) -> bool {
        false
    }
    fn decode(&self, _data: &[u8]) -> Result<DecodedAudio> {
        Err(orange_core::CoreError::Unsupported("解码器尚未实现 (v0.1 骨架)".into()))
    }
}
