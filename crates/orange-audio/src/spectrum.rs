//! 频谱分析器（音频可视化数据源）
//!
//! 输出 FFT 频谱数据，通过 IPC 传给前端 Three.js 驱动粒子 / 流体视觉。

use serde::{Deserialize, Serialize};

/// 频谱数据（用于前端可视化）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumData {
    /// 各频段能量 (0.0 - 1.0)
    pub bands: Vec<f32>,
    /// 整体响度 (0.0 - 1.0)
    pub loudness: f32,
    /// 低频能量（鼓点检测用）
    pub bass: f32,
    /// 中频能量
    pub mid: f32,
    /// 高频能量
    pub treble: f32,
    /// 当前 BPM（若已检测）
    pub bpm: Option<f32>,
}

impl Default for SpectrumData {
    fn default() -> Self {
        Self {
            bands: vec![0.0; 64],
            loudness: 0.0,
            bass: 0.0,
            mid: 0.0,
            treble: 0.0,
            bpm: None,
        }
    }
}

/// 频谱分析器
pub struct SpectrumAnalyzer {
    pub band_count: usize,
}

impl SpectrumAnalyzer {
    pub fn new(band_count: usize) -> Self {
        Self { band_count }
    }
}

impl Default for SpectrumAnalyzer {
    fn default() -> Self {
        Self::new(64)
    }
}
