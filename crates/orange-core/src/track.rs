//! 曲目数据模型

use crate::audio_format::{AudioFormat, BitDepth, Quality, SampleRate};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 曲目全局唯一 ID
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TrackId(pub Uuid);

impl TrackId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for TrackId {
    fn default() -> Self {
        Self::new()
    }
}

/// 封面图片
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artwork {
    /// 来源：本地路径 / URL / 内嵌数据引用
    pub source: ArtworkSource,
    /// 主色调 (用于视觉主题提取)
    pub dominant_color: Option<[u8; 3]>,
    /// 调色板
    pub palette: Vec<[u8; 3]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ArtworkSource {
    Local { path: String },
    Url { url: String },
    Embedded { track_id: TrackId },
}

/// 曲目元数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TrackMeta {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<u16>,
    pub genre: Vec<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub duration_secs: Option<f64>,
    pub bpm: Option<f32>,
    pub musical_key: Option<String>,
    /// ISRC 编码
    pub isrc: Option<String>,
    /// 歌词（LRC / 同步歌词）
    pub lyrics: Option<String>,
    pub artwork: Option<Artwork>,
    pub composer: Option<String>,
    pub label: Option<String>,
}

/// 一首可播放的曲目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: TrackId,
    /// 来自哪个音源
    #[serde(default)]
    pub source_id: crate::source::SourceId,
    /// 在音源中的原始 ID（本地=文件路径；网易云/QQ=歌曲ID）
    pub source_track_id: String,
    /// 音源类型（用于跨源收藏后定位取流方式）
    #[serde(default)]
    pub source_kind: crate::source::SourceKind,
    pub meta: TrackMeta,
    /// 音频格式
    #[serde(default)]
    pub format: AudioFormat,
    /// 质量等级
    #[serde(default)]
    pub quality: Quality,
    pub sample_rate: Option<SampleRate>,
    pub bit_depth: Option<BitDepth>,
    pub bitrate_kbps: Option<u32>,
    /// 添加到库的时间
    #[serde(default = "Utc::now")]
    pub added_at: DateTime<Utc>,
    /// 最后播放时间
    pub last_played_at: Option<DateTime<Utc>>,
    /// 播放次数
    #[serde(default)]
    pub play_count: u32,
    /// 是否喜欢
    #[serde(default)]
    pub liked: bool,
}

impl Track {
    pub fn new(
        source_id: crate::source::SourceId,
        source_track_id: String,
        meta: TrackMeta,
    ) -> Self {
        Self {
            id: TrackId::new(),
            source_id,
            source_track_id,
            source_kind: crate::source::SourceKind::Local,
            meta,
            format: AudioFormat::Unknown,
            quality: Quality::Standard,
            sample_rate: None,
            bit_depth: None,
            bitrate_kbps: None,
            added_at: Utc::now(),
            last_played_at: None,
            play_count: 0,
            liked: false,
        }
    }

    /// 是否为 Hi-Res 曲目
    pub fn is_hires(&self) -> bool {
        self.format.is_hires() || matches!(self.quality, Quality::HiRes | Quality::Master)
    }
}
