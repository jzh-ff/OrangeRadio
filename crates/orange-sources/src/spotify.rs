//! Spotify 音源（官方 Web API）
//!
//! 认证：用户配置 Client ID + Secret，走 Client Credentials 流程获取 token
//! 搜索：官方 /v1/search 接口
//! 播放：使用 preview_url（30 秒试听片段，无需 Premium）
//!
//! 完整播放需要 Premium 账号 + Playback SDK，后续实现。

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::{Track, TrackMeta};
use orange_core::Result;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct SpotifySource {
    id: SourceId,
    client: reqwest::Client,
    /// OAuth2 access token
    token: Arc<RwLock<Option<String>>>,
    /// Client Credentials
    client_id: Arc<RwLock<Option<String>>>,
    client_secret: Arc<RwLock<Option<String>>>,
    configured: Arc<AtomicBool>,
}

impl SpotifySource {
    pub fn new() -> Self {
        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            client: reqwest::Client::builder()
                .user_agent("OrangeRadio/0.3")
                .build()
                .unwrap_or_default(),
            token: Arc::new(RwLock::new(None)),
            client_id: Arc::new(RwLock::new(None)),
            client_secret: Arc::new(RwLock::new(None)),
            configured: Arc::new(AtomicBool::new(false)),
        }
    }

    /// 配置 Client Credentials 并获取 token
    async fn ensure_token(&self) -> Result<()> {
        // 已有 token 则跳过
        if self.token.read().await.is_some() {
            return Ok(());
        }
        let cid = self.client_id.read().await.clone()
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未配置 Spotify Client ID".into()))?;
        let secret = self.client_secret.read().await.clone()
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未配置 Spotify Client Secret".into()))?;

        let resp: TokenResp = self.client
            .post("https://accounts.spotify.com/api/token")
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", &cid),
                ("client_secret", &secret),
            ])
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        *self.token.write().await = Some(resp.access_token);
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct TokenResp { access_token: String }

#[derive(Debug, Deserialize)]
struct SearchResp { tracks: Option<TrackPage> }
#[derive(Debug, Deserialize)]
struct TrackPage { items: Vec<SpTrack> }
#[derive(Debug, Deserialize)]
struct SpTrack {
    id: String,
    name: String,
    artists: Vec<SpArtist>,
    album: Option<SpAlbum>,
    duration_ms: u64,
    preview_url: Option<String>,
}
#[derive(Debug, Deserialize)]
struct SpArtist { name: String }
#[derive(Debug, Deserialize)]
struct SpAlbum { name: String }

fn sp_track(sp: &SpTrack, source_id: SourceId) -> Track {
    let artist = sp.artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ");
    let mut t = Track::new(
        source_id,
        sp.preview_url.clone().unwrap_or_default(), // source_track_id 存 preview_url
        TrackMeta {
            title: sp.name.clone(),
            artist,
            album: sp.album.as_ref().map(|a| a.name.clone()),
            duration_secs: Some(sp.duration_ms as f64 / 1000.0),
            ..Default::default()
        },
    );
    t.format = orange_core::audio_format::AudioFormat::Mp3;
    t.quality = orange_core::audio_format::Quality::Standard;
    t
}

#[async_trait]
impl AudioSource for SpotifySource {
    fn id(&self) -> SourceId { self.id }
    fn kind(&self) -> SourceKind { SourceKind::Spotify }
    fn name(&self) -> &str { "Spotify" }
    fn requires_auth(&self) -> bool { true }
    fn is_ready(&self) -> bool { self.configured.load(Ordering::Relaxed) }

    async fn search(&self, query: &SearchQuery) -> Result<SearchResult> {
        self.ensure_token().await?;
        let token = self.token.read().await.clone()
            .ok_or_else(|| orange_core::CoreError::AuthFailed("无 token".into()))?;
        let url = format!(
            "https://api.spotify.com/v1/search?q={}&type=track&limit={}",
            query.keyword, query.page_size
        );
        let resp: SearchResp = self.client
            .get(&url)
            .bearer_auth(&token)
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let items = resp.tracks.map(|t| t.items).unwrap_or_default();
        // 只保留有 preview_url 的曲目（可播放）
        let tracks = items.iter()
            .filter(|t| t.preview_url.is_some())
            .map(|t| sp_track(t, self.id))
            .collect::<Vec<_>>();
        let total = tracks.len() as u32;
        Ok(SearchResult { tracks, total, has_more: false })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        if track.source_track_id.is_empty() {
            return Err(orange_core::CoreError::Unsupported(
                "无试听片段（完整播放需 Premium + SDK）".into()
            ));
        }
        Ok(StreamLocation::Url { url: track.source_track_id.clone(), headers: vec![] })
    }
}

/// 配置 Client Credentials
impl SpotifySource {
    pub async fn configure(&self, client_id: &str, client_secret: &str) -> Result<()> {
        *self.client_id.write().await = Some(client_id.to_string());
        *self.client_secret.write().await = Some(client_secret.to_string());
        // 立即测试获取 token
        self.ensure_token().await?;
        self.configured.store(true, Ordering::Relaxed);
        tracing::info!("Spotify 已配置并获取 token");
        Ok(())
    }
}

impl Default for SpotifySource { fn default() -> Self { Self::new() } }
