//! AI DJ 无缝混音器
//!
//! v0.1 骨架：分析 BPM / 调性，自动 crossfade 实现不间断 DJ 现场。

use serde::{Deserialize, Serialize};

/// Crossfade 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossfadeConfig {
    /// 淡入淡出时长（秒）
    pub duration_secs: f32,
    /// 曲线类型
    pub curve: CrossfadeCurve,
    /// 是否启用自动 BPM 对齐
    pub auto_beat_match: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrossfadeCurve {
    Linear,
    EqualPower,
    SCurve,
}

impl Default for CrossfadeConfig {
    fn default() -> Self {
        Self {
            duration_secs: 8.0,
            curve: CrossfadeCurve::EqualPower,
            auto_beat_match: true,
        }
    }
}

/// DJ 混音器
pub struct DjMixer {
    pub config: CrossfadeConfig,
}

impl DjMixer {
    pub fn new(config: CrossfadeConfig) -> Self {
        Self { config }
    }

    /// 计算两曲之间的最佳切换点（节拍对齐）
    /// v0.2 实现：基于 BPM 与节拍检测
    pub fn find_mix_point(&self, _outgoing_bpm: f32, _incoming_bpm: f32) -> f32 {
        // 占位：返回推荐的淡出起始比例
        0.85
    }
}
