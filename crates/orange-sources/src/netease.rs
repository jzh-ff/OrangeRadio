//! 网易云音乐音源（用户账号 + 第三方接口）
//!
//! 设计原则：
//! - 用户绑定自己的网易云账号（Cookie / 二维码），使用自己的权益
//! - 不破解付费墙，VIP 曲目需用户自己是 VIP 才能播放
//! - 依赖网易云网页接口，标注为"实验性"，可能因风控变动而失效
//!
//! 登录方式：
//! 1. Cookie 导入（用户从 music.163.com 浏览器复制 MUSIC_U cookie）
//! 2. 二维码扫码（后续实现）

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::{Track, TrackMeta};
use orange_core::Result;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

const BASE: &str = "https://music.163.com";

pub struct NeteaseSource {
    id: SourceId,
    client: reqwest::Client,
    /// 登录态 Cookie（MUSIC_U=xxx）
    cookie: Arc<RwLock<Option<String>>>,
    /// 是否已登录（同步可读，配合 is_ready）
    logged_in: Arc<AtomicBool>,
}

impl NeteaseSource {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
            .unwrap_or_default();
        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            client,
            cookie: Arc::new(RwLock::new(None)),
            logged_in: Arc::new(AtomicBool::new(false)),
        }
    }

    /// 当前 cookie（克隆）
    async fn cookie_str(&self) -> Option<String> {
        self.cookie.read().await.clone()
    }
}

/// 网易云搜索结果（歌曲）
#[derive(Debug, Deserialize)]
struct NeteaseSearchResp {
    result: Option<NeteaseSearchResult>,
}
#[derive(Debug, Deserialize, Default)]
struct NeteaseSearchResult {
    songs: Option<Vec<NeteaseSong>>,
    songCount: Option<u32>,
}
#[derive(Debug, Deserialize)]
struct NeteaseSong {
    id: u64,
    name: String,
    #[serde(default)]
    artists: Vec<NeteaseArtist>,
    #[serde(default)]
    album: Option<NeteaseAlbum>,
    duration: Option<u64>,
}
#[derive(Debug, Deserialize)]
struct NeteaseArtist { name: String }
#[derive(Debug, Deserialize)]
struct NeteaseAlbum { name: String }

/// 播放 URL 响应
#[derive(Debug, Deserialize)]
struct SongUrlResp { data: Vec<SongUrlData> }
#[derive(Debug, Deserialize)]
struct SongUrlData { url: Option<String>, size: Option<u64> }

fn song_to_track(song: &NeteaseSong, source_id: SourceId) -> Track {
    let artist = song.artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join("/");
    let album = song.album.as_ref().map(|a| a.name.clone());
    let mut t = Track::new(
        source_id,
        song.id.to_string(), // source_track_id 存网易云歌曲 ID
        TrackMeta {
            title: song.name.clone(),
            artist,
            album,
            duration_secs: song.duration.map(|d| d as f64 / 1000.0),
            ..Default::default()
        },
    );
    t.format = orange_core::audio_format::AudioFormat::Mp3;
    t.quality = orange_core::audio_format::Quality::High;
    t
}

#[async_trait]
impl AudioSource for NeteaseSource {
    fn id(&self) -> SourceId { self.id }
    fn kind(&self) -> SourceKind { SourceKind::NeteaseCloudMusic }
    fn name(&self) -> &str { "网易云音乐" }
    fn requires_auth(&self) -> bool { true }

    fn is_ready(&self) -> bool {
        self.logged_in.load(Ordering::Relaxed)
    }

    async fn search(&self, query: &SearchQuery) -> Result<SearchResult> {
        let cookie = self.cookie_str().await;
        let limit = query.page_size.min(50);
        let offset = ((query.page.saturating_sub(1)) as usize) * limit as usize;
        let url = format!("{}/api/search/get?s={}&type=1&limit={}&offset={}", BASE, query.keyword, limit, offset);

        let mut req = self.client.get(&url).header("Referer", BASE);
        if let Some(c) = &cookie {
            req = req.header("Cookie", c);
        }
        let resp: NeteaseSearchResp = req.send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let result = resp.result.unwrap_or_default();
        let songs = result.songs.unwrap_or_default();
        let total = result.songCount.unwrap_or(0);
        let tracks = songs.iter().map(|s| song_to_track(s, self.id)).collect();
        Ok(SearchResult { tracks, total, has_more: total > (offset as u32 + limit) })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        let cookie = self.cookie_str().await
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录网易云".into()))?;
        // 获取播放 URL（需登录态）
        let url = format!("{}/song/enhance/player/url?ids=[{}]&br=320000", BASE, track.source_track_id);
        let resp: SongUrlResp = self.client.get(&url)
            .header("Cookie", &cookie)
            .header("Referer", BASE)
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let play_url = resp.data.into_iter()
            .next()
            .and_then(|d| d.url)
            .ok_or_else(|| orange_core::CoreError::Unsupported("无法获取播放地址（可能需VIP）".into()))?;
        Ok(StreamLocation::Url { url: play_url, headers: vec![] })
    }
}

#[async_trait]
impl AuthSource for NeteaseSource {
    /// Cookie 登录：用户从浏览器复制 MUSIC_U=xxx
    async fn login_with_cookie(&self, cookie: &str) -> Result<()> {
        // 简单校验：网易云登录态核心是 MUSIC_U
        if !cookie.contains("MUSIC_U") && !cookie.contains("music_u") {
            return Err(orange_core::CoreError::AuthFailed("Cookie 缺少 MUSIC_U，请确认从 music.163.com 复制完整 Cookie".into()));
        }
        *self.cookie.write().await = Some(cookie.to_string());
        self.logged_in.store(true, Ordering::Relaxed);
        tracing::info!("网易云账号已登录（Cookie）");
        Ok(())
    }

    async fn logout(&self) -> Result<()> {
        *self.cookie.write().await = None;
        self.logged_in.store(false, Ordering::Relaxed);
        Ok(())
    }

    async fn current_user(&self) -> Result<Option<UserInfo>> {
        let cookie = self.cookie_str().await;
        if cookie.is_none() { return Ok(None); }
        // 简化：从 cookie 提取 uid（MUSIC_U 解码复杂，暂返回占位）
        Ok(Some(UserInfo {
            uid: "已登录".into(),
            nickname: "网易云用户".into(),
            avatar_url: None,
            vip: false,
        }))
    }
}

impl Default for NeteaseSource {
    fn default() -> Self { Self::new() }
}
