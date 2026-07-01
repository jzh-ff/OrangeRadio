//! STEM 分轨
//!
//! 将混音拆为人声 / 鼓 / 贝斯 / 和声 / 其他 独立轨道，
//! 供 DAW 编辑器单独编辑——专业创作的关键能力。

use serde::{Deserialize, Serialize};

/// 分轨类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StemKind {
    Vocals,   // 人声
    Drums,    // 鼓
    Bass,     // 贝斯
    Harmony,  // 和声 / 其他乐器
    Other,    // 其他
}

/// 分轨结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stems {
    pub vocals: Option<String>,
    pub drums: Option<String>,
    pub bass: Option<String>,
    pub harmony: Option<String>,
    pub other: Option<String>,
}

impl Stems {
    /// 获取指定类型的 URL
    pub fn get(&self, kind: StemKind) -> Option<&str> {
        match kind {
            StemKind::Vocals => self.vocals.as_deref(),
            StemKind::Drums => self.drums.as_deref(),
            StemKind::Bass => self.bass.as_deref(),
            StemKind::Harmony => self.harmony.as_deref(),
            StemKind::Other => self.other.as_deref(),
        }
    }
}

/// 分轨器
pub struct StemSeparator;

impl StemSeparator {
    pub fn new() -> Self { Self }

    /// 分离音轨
    /// v0.6 实现：调用 MiniMax / Demucs
    pub async fn separate(&self, _audio_url: &str) -> orange_core::Result<Stems> {
        Err(orange_core::CoreError::AiService("STEM分轨尚未实现 (v0.6)".into()))
    }
}

impl Default for StemSeparator {
    fn default() -> Self { Self::new() }
}
