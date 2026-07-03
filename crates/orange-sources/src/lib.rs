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
//!
//! ## 扩展音源
//! 用户/社区可通过实现 [`AudioSource`](orange_core::source::AudioSource) trait
//! 编写自定义音源插件。

pub mod local;
pub mod web_radio;
pub mod podcast;
pub mod weapi;
// 第三方平台 v0.3 实现
pub mod netease;
pub mod qqmusic;
pub mod spotify;

pub use web_radio::WebRadioSource;
pub use netease::NeteaseSource;
pub use podcast::PodcastSource;
pub use qqmusic::QqMusicSource;
pub use spotify::SpotifySource;

/// 音源注册表：管理所有已注册的音源实例
pub struct SourceRegistry {
    sources: Vec<Box<dyn orange_core::source::AudioSource>>,
}

impl SourceRegistry {
    pub fn new() -> Self {
        Self { sources: Vec::new() }
    }

    /// 注册一个音源
    pub fn register(&mut self, source: Box<dyn orange_core::source::AudioSource>) {
        tracing::info!("已注册音源: {} ({:?})", source.name(), source.kind());
        self.sources.push(source);
    }

    /// 按 ID 查找音源
    pub fn get(&self, id: orange_core::source::SourceId) -> Option<&dyn orange_core::source::AudioSource> {
        self.sources.iter().map(|s| s.as_ref()).find(|s| s.id() == id)
    }

    /// 列出所有音源
    pub fn list(&self) -> Vec<&dyn orange_core::source::AudioSource> {
        self.sources.iter().map(|s| s.as_ref()).collect()
    }
}

impl Default for SourceRegistry {
    fn default() -> Self {
        Self::new()
    }
}
