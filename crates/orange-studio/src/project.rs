//! 创作工程文件 (.orp) 管理
//!
//! DAW 式工程：多轨道、时间线、clip、自动化。
//!
//! `.orp` 文件是 JSON 序列化的 [`StudioProject`]，保存了工程元数据、轨道/片段
//! 配置和关联的歌词。音频以**本地路径**形式存储（跨设备不可用，端云同步是 v0.7）。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 创作工程
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioProject {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,
    /// 工程采样率
    pub sample_rate: u32,
    /// BPM
    pub bpm: f32,
    /// 调性
    pub musical_key: String,
    /// 轨道列表
    pub tracks: Vec<ProjectTrack>,
    /// 工程总时长（秒）
    pub duration_secs: f64,
    /// 关联歌词
    pub lyrics: Option<String>,
    /// 元数据
    pub metadata: serde_json::Value,
}

impl StudioProject {
    pub fn new(name: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            created_at: now,
            modified_at: now,
            sample_rate: 48000,
            bpm: 120.0,
            musical_key: "C major".into(),
            tracks: vec![],
            duration_secs: 0.0,
            lyrics: None,
            metadata: serde_json::json!({}),
        }
    }

    /// 更新修改时间戳（任何编辑操作后调用）
    pub fn touch(&mut self) {
        self.modified_at = Utc::now();
    }

    /// 保存到 `.orp` 文件（JSON 格式，pretty print）
    pub fn save_to_path(&self, path: &std::path::Path) -> orange_core::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| orange_core::CoreError::AiService(format!("创建工程目录失败: {e}")))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| orange_core::CoreError::AiService(format!("序列化工程失败: {e}")))?;
        std::fs::write(path, json)
            .map_err(|e| orange_core::CoreError::AiService(format!("写入工程文件失败: {e}")))?;
        tracing::info!("工程已保存: {}", path.display());
        Ok(())
    }

    /// 从 `.orp` 文件加载
    pub fn load_from_path(path: &std::path::Path) -> orange_core::Result<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| orange_core::CoreError::AiService(format!("读取工程文件失败: {e}")))?;
        let project: Self = serde_json::from_str(&content)
            .map_err(|e| orange_core::CoreError::AiService(format!("解析工程文件失败: {e}")))?;
        tracing::info!("工程已加载: {}", path.display());
        Ok(project)
    }
}

/// 工程轨道
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTrack {
    pub id: Uuid,
    pub name: String,
    pub kind: crate::stems::StemKind,
    /// 音量 (0.0 - 1.0)
    pub volume: f32,
    /// 声相 (-1.0 左 - 1.0 右)
    pub pan: f32,
    /// 静音
    pub muted: bool,
    /// 独奏
    pub solo: bool,
    /// 轨道上的音频片段
    pub clips: Vec<ProjectClip>,
    /// 轨道效果链 (EQ / 压缩 / 混响)
    pub effects: Vec<TrackEffect>,
}

/// 音频片段（时间线上的一段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectClip {
    pub id: Uuid,
    /// 音频源 URL / 路径
    pub source: String,
    /// 在时间线上的起始位置（秒）
    pub start_secs: f64,
    /// 片段时长（秒）
    pub duration_secs: f64,
    /// 源音频内的偏移（秒）
    pub offset_secs: f64,
    /// 淡入（秒）
    pub fade_in: f64,
    /// 淡出（秒）
    pub fade_out: f64,
}

/// 轨道效果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TrackEffect {
    Eq { bands: Vec<(f32, f32)> },
    Compressor { threshold: f32, ratio: f32 },
    Reverb { wet: f32, decay: f32 },
    Delay { time: f32, feedback: f32 },
    Distortion { amount: f32 },
}
