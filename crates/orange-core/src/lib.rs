//! # OrangeRadio Core
//!
//! OrangeRadio 系统的核心抽象层。定义了音源、播放器、AI、创作工作站
//! 等模块的统一 trait 接口。所有功能模块都基于这些抽象构建，
//! 保证可插拔、可扩展、可测试。
//!
//! ## 核心概念
//!
//! - [`Track`] —— 一首可播放的曲目（来自本地、网络电台或第三方平台）
//! - [` AudioSource`] —— 音源提供者（本地库、网易云、Spotify、网络电台...）
//! - [`Player`] —— 播放器内核（Hi-Res 解码 + DSP）
//! - [`PlaybackMode`] —— 播放模式（顺序/随机/循环/懂你模式）

pub mod error;
pub mod track;
pub mod source;
pub mod player;
pub mod events;
pub mod audio_format;
pub mod recommendation;

pub use error::{CoreError, Result};
pub use track::{Track, TrackId, TrackMeta, Artwork};
pub use source::{AudioSource, SourceId, SourceKind, SearchQuery, SearchResult};
pub use player::{Player, PlayerState, PlayerEvent, PlaybackMode, RepeatMode};
pub use events::{EventBus, EventSubscription};
pub use audio_format::AudioFormat;
pub use recommendation::{RecommendationEngine, RecommendContext, UserProfile};

/// OrangeRadio 版本号
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
