//! 音源抽象
//!
//! [`AudioSource`] 是 OrangeRadio 可插拔音源体系的核心 trait。
//! 本地库、网易云、QQ音乐、Spotify、Apple Music、网络电台、播客 RSS
//! 都实现此 trait，从而被播放器统一调度。

use crate::track::Track;
use crate::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 音源 ID
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SourceId(pub Uuid);

/// 音源类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    /// 本地音乐库
    Local,
    /// 网易云音乐
    NeteaseCloudMusic,
    /// QQ 音乐
    QqMusic,
    /// Spotify
    Spotify,
    /// Apple Music
    AppleMusic,
    /// 网络电台 (RadioBrowser / Icecast / Shoutcast)
    WebRadio,
    /// 播客 RSS
    Podcast,
    /// 自定义 / 插件音源
    Plugin,
}

/// 搜索查询
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub keyword: String,
    /// 限定类型：单曲 / 专辑 / 歌手 / 歌单 / 播客
    pub kind: Option<SearchKind>,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchKind {
    Song,
    Album,
    Artist,
    Playlist,
    Podcast,
    Radio,
}

impl Default for SearchQuery {
    fn default() -> Self {
        Self {
            keyword: String::new(),
            kind: None,
            page: 1,
            page_size: 30,
        }
    }
}

/// 搜索结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub tracks: Vec<Track>,
    pub total: u32,
    pub has_more: bool,
}

/// 音源提供者 trait
///
/// 所有音源（本地 / 云端 / 电台 / 播客）实现此接口，
/// 即可被播放器统一索引、搜索、播放。
#[async_trait]
pub trait AudioSource: Send + Sync {
    /// 音源唯一 ID
    fn id(&self) -> SourceId;

    /// 音源类型
    fn kind(&self) -> SourceKind;

    /// 人类可读名称
    fn name(&self) -> &str;

    /// 是否需要登录鉴权
    fn requires_auth(&self) -> bool {
        false
    }

    /// 是否已就绪（已登录 / 已配置）
    fn is_ready(&self) -> bool {
        true
    }

    /// 搜索曲目
    async fn search(&self, query: &SearchQuery) -> Result<SearchResult>;

    /// 获取曲目的可播放流地址（URL 或本地路径）
    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation>;

    /// 获取音源下的推荐/热门（可选实现）
    async fn recommendations(&self, _limit: u32) -> Result<Vec<Track>> {
        Ok(vec![])
    }

    /// 获取用户歌单（可选，第三方平台实现）
    async fn user_playlists(&self) -> Result<Vec<PlaylistRef>> {
        Ok(vec![])
    }
}

/// 流地址：播放器据此获取音频数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum StreamLocation {
    /// 本地文件路径
    File { path: String },
    /// HTTP(S) 流 URL
    Url { url: String, headers: Vec<(String, String)> },
    /// 需要先获取的临时 URL（带过期）
    TempUrl { url: String, expires_at: chrono::DateTime<chrono::Utc> },
}

/// 歌单引用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistRef {
    pub id: String,
    pub name: String,
    pub cover_url: Option<String>,
    pub track_count: u32,
    pub source: SourceKind,
}
