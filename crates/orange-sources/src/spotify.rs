//! Spotify 音源（官方 Web API）
//!
//! 认证：用户配置 Client ID + Secret，走 Client Credentials 流程获取 token
//! 搜索：官方 /v1/search 接口
//! 播放：使用 preview_url（30 秒试听片段，无需 Premium）
//!
//! 完整播放需要 Premium 账号 + Playback SDK，后续实现。
//!
//! 凭据持久化：Client ID + Secret + 当前 token 都加密存到 [`AuthStore`]，
//! 启动时自动恢复，无需重新输入。token 1h 过期由 [`SpotifySource::ensure_token`]
//! 在 API 调用前检查并自动续期。

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::{Track, TrackMeta};
use orange_core::Result;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::auth_store::AuthStore;

const AUTH_SOURCE_KEY: &str = "spotify";

pub struct SpotifySource {
    id: SourceId,
    client: reqwest::Client,
    /// 当前 access token + 过期时间（Unix 秒）。None 表示还没拿。
    token: Arc<RwLock<Option<String>>>,
    /// token 过期时间（Unix 秒），由 `token_expires_at` 原子跟踪（便于 `is_ready` 等同步检查）
    token_expires_at: Arc<AtomicI64>,
    /// Client Credentials
    client_id: Arc<RwLock<Option<String>>>,
    client_secret: Arc<RwLock<Option<String>>>,
    configured: Arc<AtomicBool>,
    /// 加密持久化存储（保存 client_id/client_secret + 可选缓存当前 token）
    auth_store: Arc<AuthStore>,
    /// 鉴权过期事件 sink（token 获取失败 / Client ID 失效时调用）
    event_sink: Option<Arc<dyn orange_core::AuthEventSink>>,
}

impl SpotifySource {
    pub fn new(
        auth_store: Arc<AuthStore>,
        event_sink: Option<Arc<dyn orange_core::AuthEventSink>>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("OrangeRadio/0.3")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();

        let source = Self {
            id: SourceId(uuid::Uuid::new_v4()),
            client,
            token: Arc::new(RwLock::new(None)),
            token_expires_at: Arc::new(AtomicI64::new(0)),
            client_id: Arc::new(RwLock::new(None)),
            client_secret: Arc::new(RwLock::new(None)),
            configured: Arc::new(AtomicBool::new(false)),
            auth_store,
            event_sink,
        };

        // 注意：启动恢复凭据的逻辑（tokio::spawn）不能在 new() 里跑，
        // 因为调用方（如 AppState::default）通常是同步上下文，没有 tokio runtime。
        // 调用方应在 Tauri setup 钩子里 spawn 后调 [`SpotifySource::resume_from_store`]。

        source
    }

    /// 从 AuthStore 恢复 Client Credentials 并异步拿 token
    ///
    /// 必须在 tokio runtime 上下文里调（不能在同步构造函数里）。
    /// 通常在 Tauri Builder::setup() 里 spawn 一个 task 调它。
    pub async fn resume_from_store(&self) -> Result<()> {
        // 注意：get_sync() 用 blocking_read，但 setup 钩子本身在 Tauri runtime 内，
        // 且这里没有别的 .await 在前面，所以 blocking_read 也不冲突。
        // 不过为了安全，统一用异步 get()
        let auth = self
            .auth_store
            .get(AUTH_SOURCE_KEY)
            .await
            .ok_or_else(|| orange_core::CoreError::AuthFailed("Spotify 凭据未保存".into()))?;
        let (cid, secret) = parse_creds(&auth.cookie).ok_or_else(|| {
            orange_core::CoreError::AuthFailed("AuthStore 中 Spotify 凭据格式损坏".into())
        })?;
        tracing::info!("Spotify 从 AuthStore 恢复 Client Credentials");
        *self.client_id.write().await = Some(cid.clone());
        *self.client_secret.write().await = Some(secret.clone());
        match fetch_token(&self.client, &cid, &secret).await {
            Ok((t, expires_in)) => {
                *self.token.write().await = Some(t);
                self.token_expires_at
                    .store(now_secs() + expires_in - 60, Ordering::Relaxed);
                self.configured.store(true, Ordering::Relaxed);
                if let Err(e) = self
                    .auth_store
                    .save(AUTH_SOURCE_KEY, format_creds(&cid, &secret))
                    .await
                {
                    tracing::warn!("Spotify 刷新 saved_at 失败: {}", e);
                }
                tracing::info!("Spotify 启动恢复成功");
                Ok(())
            }
            Err(e) => {
                tracing::warn!("Spotify 启动恢复 token 失败: {}", e);
                if let Some(sink) = &self.event_sink {
                    sink.on_auth_expired(orange_core::AuthExpiredPayload {
                        source: "spotify".into(),
                        source_name: "Spotify".into(),
                        reason: Some(format!("凭据失效: {}", e)),
                    });
                }
                Err(e)
            }
        }
    }

    /// 不带 AuthStore（用于测试 / default fallback）
    pub fn without_persistence() -> Self {
        let tmp = std::env::temp_dir().join("orangeradio-spotify-default-auth");
        let store = AuthStore::new(tmp);
        Self::new(store, None)
    }

    /// 配置 Client Credentials 并立即尝试拿 token
    async fn fetch_and_store(&self, client_id: &str, client_secret: &str) -> Result<()> {
        let (token, expires_in) = fetch_token(&self.client, client_id, client_secret).await?;
        *self.token.write().await = Some(token);
        self.token_expires_at
            .store(now_secs() + expires_in - 60, Ordering::Relaxed);
        self.configured.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// 在每次 API 调用前确保 token 有效（自动续期过期 token）
    async fn ensure_token(&self) -> Result<()> {
        // token 还有效（提前 60s 判断）→ 直接用
        let expires_at = self.token_expires_at.load(Ordering::Relaxed);
        if expires_at > now_secs() {
            return Ok(());
        }
        // 过期或还没拿 —— 用 client_id/secret 重拿
        let cid =
            self.client_id.read().await.clone().ok_or_else(|| {
                orange_core::CoreError::AuthFailed("未配置 Spotify Client ID".into())
            })?;
        let secret = self.client_secret.read().await.clone().ok_or_else(|| {
            orange_core::CoreError::AuthFailed("未配置 Spotify Client Secret".into())
        })?;
        let (token, expires_in) = fetch_token(&self.client, &cid, &secret)
            .await
            .map_err(|e| {
                tracing::warn!("Spotify 自动续 token 失败: {}", e);
                orange_core::CoreError::Network(format!("Spotify token 续期失败: {}", e))
            })?;
        *self.token.write().await = Some(token);
        self.token_expires_at
            .store(now_secs() + expires_in - 60, Ordering::Relaxed);
        // 更新 saved_at（让 settings 页的"上次刷新时间"实时刷新）
        if let Err(e) = self
            .auth_store
            .save(AUTH_SOURCE_KEY, format_creds(&cid, &secret))
            .await
        {
            tracing::warn!("Spotify 更新 saved_at 失败: {}", e);
        }
        Ok(())
    }

    /// 上次 token 刷新时间（Unix 秒）—— 给 settings 页显示用
    pub fn last_token_refresh_at(&self) -> i64 {
        let expires_at = self.token_expires_at.load(Ordering::Relaxed);
        if expires_at == 0 {
            0
        } else {
            // 过期时间 - 3600（Spotify token 默认 1h）≈ 上次刷新时间
            // 更精确：保存 token 时同时存 refresh_at 字段
            expires_at.saturating_sub(3600)
        }
    }
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// 调用 Spotify token endpoint
async fn fetch_token(client: &reqwest::Client, cid: &str, secret: &str) -> Result<(String, i64)> {
    #[derive(Deserialize)]
    struct TokenResp {
        access_token: String,
        #[serde(default = "default_expires_in")]
        expires_in: i64,
    }
    fn default_expires_in() -> i64 {
        3600
    }
    let resp: TokenResp = client
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", cid),
            ("client_secret", secret),
        ])
        .send()
        .await
        .map_err(|e| orange_core::CoreError::Network(format!("token fetch: {}", e)))?
        .json()
        .await
        .map_err(|e| orange_core::CoreError::Network(format!("token parse: {}", e)))?;
    Ok((resp.access_token, resp.expires_in))
}

/// 解析 `client_id;client_secret` 格式的 cookie
fn parse_creds(cookie: &str) -> Option<(String, String)> {
    let (cid, secret) = cookie.split_once(';')?;
    let cid = cid.trim();
    let secret = secret.trim();
    if cid.is_empty() || secret.is_empty() {
        return None;
    }
    Some((cid.to_string(), secret.to_string()))
}

fn format_creds(cid: &str, secret: &str) -> String {
    format!("{};{}", cid.trim(), secret.trim())
}

#[derive(Debug, Deserialize)]
struct SearchResp {
    tracks: Option<TrackPage>,
}
#[derive(Debug, Deserialize)]
struct TrackPage {
    items: Vec<SpTrack>,
}
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
struct SpArtist {
    name: String,
}
#[derive(Debug, Deserialize)]
struct SpAlbum {
    name: String,
}

fn sp_track(sp: &SpTrack, source_id: SourceId) -> Track {
    let artist = sp
        .artists
        .iter()
        .map(|a| a.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
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
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::Spotify
    }
    fn name(&self) -> &str {
        "Spotify"
    }
    fn requires_auth(&self) -> bool {
        true
    }
    fn is_ready(&self) -> bool {
        self.configured.load(Ordering::Relaxed)
    }

    async fn search(&self, query: &SearchQuery) -> Result<SearchResult> {
        self.ensure_token().await?;
        let token = self
            .token
            .read()
            .await
            .clone()
            .ok_or_else(|| orange_core::CoreError::AuthFailed("无 token".into()))?;
        let url = format!(
            "https://api.spotify.com/v1/search?q={}&type=track&limit={}",
            query.keyword, query.page_size
        );
        let resp: SearchResp = self
            .client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let items = resp.tracks.map(|t| t.items).unwrap_or_default();
        // 只保留有 preview_url 的曲目（可播放）
        let tracks = items
            .iter()
            .filter(|t| t.preview_url.is_some())
            .map(|t| sp_track(t, self.id))
            .collect::<Vec<_>>();
        let total = tracks.len() as u32;
        Ok(SearchResult {
            tracks,
            total,
            has_more: false,
        })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        if track.source_track_id.is_empty() {
            return Err(orange_core::CoreError::Unsupported(
                "无试听片段（完整播放需 Premium + SDK）".into(),
            ));
        }
        Ok(StreamLocation::Url {
            url: track.source_track_id.clone(),
            headers: vec![],
        })
    }
}

/// 配置 / 登出
impl SpotifySource {
    /// 配置 Client Credentials 并保存到 AuthStore（下次启动自动恢复）
    pub async fn configure(&self, client_id: &str, client_secret: &str) -> Result<()> {
        *self.client_id.write().await = Some(client_id.to_string());
        *self.client_secret.write().await = Some(client_secret.to_string());
        // 立即测试获取 token —— 失败说明凭据无效，不保存
        self.fetch_and_store(client_id, client_secret).await?;
        // 加密持久化 Client ID + Secret（注意：Secret 比较敏感但用户已在 UI 明文输入过）
        self.auth_store
            .save(AUTH_SOURCE_KEY, format_creds(client_id, client_secret))
            .await?;
        tracing::info!("Spotify 已配置并保存凭据");
        Ok(())
    }

    /// 登出：清内存状态 + AuthStore
    pub async fn logout(&self) -> Result<()> {
        *self.token.write().await = None;
        *self.client_id.write().await = None;
        *self.client_secret.write().await = None;
        self.token_expires_at.store(0, Ordering::Relaxed);
        self.configured.store(false, Ordering::Relaxed);
        self.auth_store.clear(AUTH_SOURCE_KEY).await?;
        tracing::info!("Spotify 已登出 + 清凭据");
        Ok(())
    }
}

impl Default for SpotifySource {
    fn default() -> Self {
        Self::without_persistence()
    }
}
