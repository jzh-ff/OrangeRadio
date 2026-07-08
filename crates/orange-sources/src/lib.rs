//! # OrangeRadio Sources
//!
//! 插件式音源实现族。
//!
//! ## 内置音源
//! - [`local`] —— 本地音乐库
//! - [`netease`] —— 网易云音乐（第三方接口）
//! - [`qqmusic`] —— QQ 音乐
//! - [`spotify`] —— Spotify (官方 API)
//! - [`web_radio`] —— 网络电台 (RadioBrowser / Icecast / Shoutcast)
//! - [`podcast`] —— 播客 RSS
//! - [`gequbao`] —— 歌曲宝（第三方聚合音源，HTML 抓取）
//!
//! ## 扩展音源
//! 用户/社区可通过实现 [`AudioSource`](orange_core::source::AudioSource) trait
//! 编写自定义音源插件。

pub mod auth_store;
pub mod gequbao;
pub mod kugou;
pub mod kuwo;
pub mod local;
pub mod podcast;
pub mod qishui;
pub mod weapi;
pub mod web_radio;
// 第三方平台 v0.3 实现
pub mod netease;
pub mod qqmusic;
pub mod spotify;

pub use auth_store::{AuthStore, StoredAuth};
pub use gequbao::GequbaoSource;
pub use kugou::KugouSource;
pub use kuwo::KuwoSource;
pub use netease::NeteaseSource;
pub use podcast::PodcastSource;
pub use qishui::QishuiSource;
pub use qqmusic::QqMusicSource;
pub use spotify::SpotifySource;
pub use web_radio::WebRadioSource;

use std::sync::Arc;

/// 音源注册表：管理所有已注册的音源实例（供 search_all 遍历）
pub struct SourceRegistry {
    sources: Vec<Arc<dyn orange_core::source::AudioSource>>,
}

impl SourceRegistry {
    pub fn new() -> Self {
        Self {
            sources: Vec::new(),
        }
    }

    /// 注册一个音源
    pub fn register(&mut self, source: Arc<dyn orange_core::source::AudioSource>) {
        tracing::info!("已注册音源: {} ({:?})", source.name(), source.kind());
        self.sources.push(source);
    }

    /// 列出所有已注册音源（返回 Arc 副本，可跨 await 持有）
    pub fn list(&self) -> Vec<Arc<dyn orange_core::source::AudioSource>> {
        self.sources.clone()
    }

    /// 已注册音源数量
    pub fn len(&self) -> usize {
        self.sources.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }
}

impl Default for SourceRegistry {
    fn default() -> Self {
        Self::new()
    }
}
