//! 播放器内核 trait
//!
//! 抽象 Hi-Res 解码 + DSP 处理 + 播放控制。
//! 参考网易云播放模式，并新增自研「懂你模式」。

use crate::track::Track;
use crate::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// 播放器状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlayerState {
    Stopped,
    Loading,
    Playing,
    Paused,
    Error,
}

/// 播放模式（参考网易云）
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackMode {
    /// 顺序播放
    #[default]
    Sequence,
    /// 列表循环
    ListLoop,
    /// 单曲循环
    SingleLoop,
    /// 随机播放
    Shuffle,
    /// ★ 懂你模式（自研）—— AI 行为画像驱动，结合实时情绪、时段、
    /// 跳过/收藏/完整听完等行为动态调整下一首
    UnderstandYou,
}

/// 重复模式（旧式三态，与 PlaybackMode 互补）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RepeatMode {
    Off,
    All,
    One,
}

/// 播放器事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlayerEvent {
    /// 状态变化
    StateChanged { state: PlayerState },
    /// 开始加载曲目
    Loading { track_id: crate::track::TrackId },
    /// 曲目开始播放
    Started { track_id: crate::track::TrackId },
    /// 进度更新
    Progress {
        position_secs: f64,
        duration_secs: f64,
    },
    /// 曲目播放结束
    Ended { track_id: crate::track::TrackId },
    /// 暂停
    Paused { track_id: crate::track::TrackId },
    /// 恢复
    Resumed { track_id: crate::track::TrackId },
    /// 队列变化
    QueueChanged,
    /// 播放模式变化
    ModeChanged { mode: PlaybackMode },
    /// 错误
    Error { message: String },
}

/// 播放器 trait
#[async_trait]
pub trait Player: Send + Sync {
    /// 当前播放的曲目
    async fn current_track(&self) -> Option<Track>;

    /// 播放状态
    async fn state(&self) -> PlayerState;

    /// 当前进度（秒）
    async fn position(&self) -> f64;

    /// 总时长（秒）
    async fn duration(&self) -> f64;

    /// 音量 (0.0 - 1.0)
    async fn volume(&self) -> f32;
    async fn set_volume(&self, volume: f32) -> Result<()>;

    /// 静音
    async fn set_muted(&self, muted: bool) -> Result<()>;

    /// 播放指定曲目（加入队首并播放）
    async fn play(&self, track: Track) -> Result<()>;

    /// 播放整个队列
    async fn play_queue(&self, tracks: Vec<Track>, start_index: usize) -> Result<()>;

    /// 暂停 / 恢复
    async fn pause(&self) -> Result<()>;
    async fn resume(&self) -> Result<()>;

    /// 上一首 / 下一首
    async fn next(&self) -> Result<()>;
    async fn previous(&self) -> Result<()>;

    /// 跳转进度
    async fn seek(&self, position_secs: f64) -> Result<()>;

    /// 设置播放模式
    async fn set_mode(&self, mode: PlaybackMode) -> Result<()>;
    async fn mode(&self) -> PlaybackMode;

    /// 当前队列
    async fn queue(&self) -> Vec<Track>;
}
