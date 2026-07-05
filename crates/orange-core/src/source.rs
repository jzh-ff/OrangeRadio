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
    /// 歌曲宝（第三方聚合音源，HTML 抓取）
    Gequbao,
    /// 自定义 / 插件音源
    Plugin,
}

impl Default for SourceKind {
    fn default() -> Self {
        SourceKind::Local
    }
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

/// 可登录音源 trait（网易云/QQ 等需要账号的平台实现）
///
/// 支持两种登录方式：
/// - 二维码扫码（推荐，最安全）
/// - Cookie 导入（用户从浏览器复制登录态）
#[async_trait]
pub trait AuthSource: AudioSource {
    /// 生成二维码登录 key + 图片 URL（二维码扫码登录）
    async fn qrcode_create(&self) -> Result<QrCodeLogin> {
        Err(crate::CoreError::Unsupported(
            "该音源不支持二维码登录".into(),
        ))
    }

    /// 查询二维码扫码状态（轮询）
    async fn qrcode_check(&self, _key: &str) -> Result<QrCodeStatus> {
        Err(crate::CoreError::Unsupported(
            "该音源不支持二维码登录".into(),
        ))
    }

    /// 用 Cookie 登录（用户导入浏览器 Cookie）
    async fn login_with_cookie(&self, _cookie: &str) -> Result<()> {
        Err(crate::CoreError::Unsupported(
            "该音源不支持 Cookie 登录".into(),
        ))
    }

    /// 登出
    async fn logout(&self) -> Result<()> {
        Ok(())
    }

    /// 当前登录用户信息
    async fn current_user(&self) -> Result<Option<UserInfo>> {
        Ok(None)
    }
}

/// 二维码登录信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodeLogin {
    /// 二维码 key（用于轮询状态）
    pub key: String,
    /// 二维码图片 URL 或 base64 data URI
    pub qr_image: String,
}

/// 二维码扫码状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QrCodeStatus {
    /// 等待扫码
    Waiting,
    /// 已扫码，等待确认
    Scanned,
    /// 已确认，登录成功
    Confirmed { cookie: String },
    /// 已过期
    Expired,
    /// 被风控/拦截（如网易云 8821：非官方客户端被安全系统识别）
    Blocked { message: String },
}

/// 用户信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub uid: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub vip: bool,
}

/// 流地址：播放器据此获取音频数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum StreamLocation {
    /// 本地文件路径
    File { path: String },
    /// HTTP(S) 流 URL
    Url {
        url: String,
        headers: Vec<(String, String)>,
    },
    /// 需要先获取的临时 URL（带过期）
    TempUrl {
        url: String,
        expires_at: chrono::DateTime<chrono::Utc>,
    },
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
