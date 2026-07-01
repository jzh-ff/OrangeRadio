//! DSP 处理链
//!
//! v0.1 骨架：定义 EQ / 空间音频 / 响度归一化 trait，v0.2 接入实现。

use serde::{Deserialize, Serialize};

/// EQ 频段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Equalizer {
    pub bands: Vec<EqBand>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqBand {
    pub freq: f32,
    pub gain_db: f32,
    pub q: f32,
}

impl Default for Equalizer {
    fn default() -> Self {
        // 默认 10 段 EQ
        let freqs = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
        Self {
            bands: freqs.iter().map(|&f| EqBand { freq: f, gain_db: 0.0, q: 1.0 }).collect(),
            enabled: false,
        }
    }
}

/// 空间音频（立体声拓宽 / 模拟环绕 / 头部追踪）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialAudio {
    pub enabled: bool,
    pub mode: SpatialMode,
    /// 立体声拓宽强度 (0.0 - 1.0)
    pub width: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpatialMode {
    Stereo,
    Wide,
    Surround,
    Binaural,
}

impl Default for SpatialAudio {
    fn default() -> Self {
        Self { enabled: false, mode: SpatialMode::Stereo, width: 0.5 }
    }
}

/// 响度归一化（EBU R128 / ReplayGain）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoudnessNormalizer {
    pub enabled: bool,
    /// 目标响度 (LUFS)，EBU R128 推荐 -23，音乐流媒体常用 -14
    pub target_lufs: f32,
}

impl Default for LoudnessNormalizer {
    fn default() -> Self {
        Self { enabled: true, target_lufs: -14.0 }
    }
}

/// DSP 处理链（顺序应用各效果器）
pub struct DspChain {
    pub eq: Equalizer,
    pub spatial: SpatialAudio,
    pub loudness: LoudnessNormalizer,
}

impl Default for DspChain {
    fn default() -> Self {
        Self {
            eq: Equalizer::default(),
            spatial: SpatialAudio::default(),
            loudness: LoudnessNormalizer::default(),
        }
    }
}
