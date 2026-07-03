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
    /// 当前 cookie（克隆）
    async fn cookie_str(&self) -> Option<String> {
        self.cookie.read().await.clone()
    }

    /// weapi 加密 POST 请求（带登录 cookie）
    async fn weapi_post(&self, path: &str, payload: &str) -> Result<serde_json::Value> {
        let user_cookie = self.cookie_str().await
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录网易云".into()))?;
        let cookie = format!("{}; os=pc; appver=2.10.14", user_cookie);
        let (params, enc_sec_key) = crate::weapi::encrypt(payload);

        let resp = self.client
            .post(&format!("{}{}?csrf_token=", BASE, path))
            .header("Cookie", &cookie)
            .header("Referer", BASE)
            .header("Origin", "https://music.163.com")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!("params={}&encSecKey={}", urlencoding(&params), urlencoding(&enc_sec_key)))
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let text = resp.text().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        serde_json::from_str(&text)
            .map_err(|e| orange_core::CoreError::Network(format!("JSON解析失败: {} body={}", e, &text[..text.len().min(200)])))
    }

    /// 获取用户歌单
    pub async fn user_playlists(&self) -> Result<Vec<(String, String, u32)>> {
        // 先获取用户 uid（从 MUSIC_U 解析复杂，这里用 /weapi/w/nuser/account/get）
        let account = self.weapi_post("/weapi/w/nuser/account/get", r#"{"csrf_token":""}"#).await?;
        let uid = account["account"]["id"].as_i64()
            .ok_or_else(|| orange_core::CoreError::AuthFailed("无法获取用户ID".into()))?;
        tracing::info!("网易云用户ID: {}", uid);

        let payload = format!(r#"{{"uid":{},"limit":30,"offset":0,"csrf_token":""}}"#, uid);
        let resp = self.weapi_post("/weapi/user/playlist", &payload).await?;

        let mut playlists = Vec::new();
        if let Some(list) = resp["playlist"].as_array() {
            for p in list {
                let id = p["id"].as_i64().unwrap_or(0).to_string();
                let name = p["name"].as_str().unwrap_or("未知歌单").to_string();
                let count = p["trackCount"].as_i64().unwrap_or(0) as u32;
                playlists.push((id, name, count));
            }
        }
        Ok(playlists)
    }

    /// 获取每日推荐歌曲
    pub async fn daily_songs(&self) -> Result<Vec<Track>> {
        let resp = self.weapi_post("/weapi/v3/discovery/recommend/songs", r#"{"limit":30,"offset":0,"total":true,"csrf_token":""}"#).await?;

        let mut tracks = Vec::new();
        if let Some(list) = resp["data"]["dailySongs"].as_array() {
            for s in list {
                let id = s["id"].as_i64().unwrap_or(0);
                let name = s["name"].as_str().unwrap_or("").to_string();
                let artists: Vec<String> = s["ar"].as_array()
                    .map(|arr| arr.iter().filter_map(|a| a["name"].as_str().map(String::from)).collect())
                    .unwrap_or_default();
                let artist = artists.join("/");
                let album = s["al"]["name"].as_str().map(String::from);
                let dt = s["dt"].as_i64().map(|d| d as f64 / 1000.0);

                let mut t = Track::new(self.id, id.to_string(), TrackMeta {
                    title: name, artist, album, duration_secs: dt, ..Default::default()
                });
                t.format = orange_core::audio_format::AudioFormat::Mp3;
                t.quality = orange_core::audio_format::Quality::High;
                tracks.push(t);
            }
        }
        Ok(tracks)
    }

    /// 获取歌单详情（歌曲列表）
    pub async fn playlist_detail(&self, playlist_id: &str) -> Result<Vec<Track>> {
        let payload = format!(r#"{{"id":{},"n":100,"s":0,"csrf_token":""}}"#, playlist_id);
        let resp = self.weapi_post("/weapi/v6/playlist/detail", &payload).await?;

        let mut tracks = Vec::new();
        if let Some(list) = resp["playlist"]["tracks"].as_array() {
            for s in list {
                let id = s["id"].as_i64().unwrap_or(0);
                let name = s["name"].as_str().unwrap_or("").to_string();
                let artists: Vec<String> = s["ar"].as_array()
                    .map(|arr| arr.iter().filter_map(|a| a["name"].as_str().map(String::from)).collect())
                    .unwrap_or_default();
                let artist = artists.join("/");
                let album = s["al"]["name"].as_str().map(String::from);
                let dt = s["dt"].as_i64().map(|d| d as f64 / 1000.0);

                let mut t = Track::new(self.id, id.to_string(), TrackMeta {
                    title: name, artist, album, duration_secs: dt, ..Default::default()
                });
                t.format = orange_core::audio_format::AudioFormat::Mp3;
                t.quality = orange_core::audio_format::Quality::High;
                tracks.push(t);
            }
        }
        Ok(tracks)
    }
}

/// URL 编码（用于 form-urlencoded body）
fn urlencoding(s: &str) -> String {
    s.bytes().map(|b| {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            (b as char).to_string()
        } else {
            format!("%{:02X}", b)
        }
    }).collect()
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
        let url = format!("{}/api/search/get/web?csrf_token=&type=1&offset={}&limit={}&s={}",
            BASE, ((query.page.saturating_sub(1)) as usize) * limit as usize, limit, &query.keyword);

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
        let user_cookie = self.cookie_str().await
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录网易云".into()))?;

        // 补充 weapi 必需的 cookie 参数（网易云服务端要求 os=pc 等）
        let cookie = format!("{}; os=pc; appver=2.10.14", user_cookie);

        // weapi 加密 POST 获取播放地址
        let payload = format!(
            r#"{{"ids":"[{}]","level":"standard","encodeType":"aac","csrf_token":""}}"#,
            track.source_track_id
        );
        let (params, enc_sec_key) = crate::weapi::encrypt(&payload);

        let resp = self.client
            .post(&format!("{}/weapi/song/enhance/player/url/v1?csrf_token=", BASE))
            .header("Cookie", &cookie)
            .header("Referer", BASE)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .header("Origin", "https://music.163.com")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!("params={}&encSecKey={}",
                urlencoding(&params), urlencoding(&enc_sec_key)))
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let body_text = resp.text().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        tracing::debug!("网易云播放地址响应: {}", &body_text[..body_text.len().min(300)]);

        let v: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let play_url = v["data"].get(0)
            .and_then(|d| d["url"].as_str())
            .filter(|u| !u.is_empty())
            .ok_or_else(|| orange_core::CoreError::Unsupported("无法获取播放地址（可能需VIP或版权限制）".into()))?
            .to_string();

        Ok(StreamLocation::Url { url: play_url, headers: vec![] })
    }
}

#[async_trait]
impl AuthSource for NeteaseSource {
    /// 生成二维码登录 key + 二维码 URL
    ///
    /// 流程：GET /api/login/qrcode/unikey → 得到 unikey
    /// 二维码内容固定为 https://music.163.com/login?codekey={key}（APP 扫码识别）
    async fn qrcode_create(&self) -> Result<QrCodeLogin> {
        #[derive(Deserialize)]
        struct UnikeyResp { code: i32, unikey: String }
        let resp: UnikeyResp = self.client
            .get(&format!("{}/api/login/qrcode/unikey?type=1", BASE))
            .header("Referer", BASE)
            .header("User-Agent", "Mozilla/5.0")
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        if resp.code != 200 {
            return Err(orange_core::CoreError::AuthFailed(
                format!("获取二维码 key 失败: code={}", resp.code)
            ));
        }

        // 二维码内容：网易云 APP 扫码后会自动打开此 URL 完成登录
        let qr_image = format!("{}/login?codekey={}", BASE, resp.unikey);
        Ok(QrCodeLogin { key: resp.unikey, qr_image })
    }

    /// 轮询二维码扫码状态
    ///
    /// GET /api/login/qrcode/client/login?key={key}
    /// 返回码：800=过期 801=等待扫码 802=已扫码待确认 803=成功(返回cookie)
    ///
    /// 关键：用不跟随重定向的 client，确保 803 时的 Set-Cookie 不丢失。
    async fn qrcode_check(&self, key: &str) -> Result<QrCodeStatus> {
        let url = format!("{}/api/login/qrcode/client/login?key={}&type=1", BASE, key);

        // 专用 client：禁用重定向（803 可能返回 302，跟随会丢 Set-Cookie）
        let no_redirect_client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let resp = no_redirect_client
            .get(&url)
            .header("Referer", BASE)
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        // 提取 Set-Cookie（803 成功时返回 MUSIC_U）
        let set_cookie: Vec<String> = resp
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok().map(String::from))
            .collect();

        // 先读 body 文本（803 时 header 过大可能导致 json() 失败）
        let body_text = resp
            .text().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        tracing::debug!("扫码 check 响应: {}", &body_text[..body_text.len().min(200)]);

        // 解析 code
        let code = serde_json::from_str::<serde_json::Value>(&body_text)
            .ok()
            .and_then(|v| v["code"].as_i64())
            .unwrap_or(-1) as i32;

        match code {
            800 => Ok(QrCodeStatus::Expired),
            801 => Ok(QrCodeStatus::Waiting),
            802 => Ok(QrCodeStatus::Scanned),
            803 => {
                // 成功：从 Set-Cookie 提取 MUSIC_U 等登录态
                let cookie = set_cookie
                    .iter()
                    .filter(|c| c.contains("MUSIC_U") || c.contains("__csrf") || c.contains("NMTID"))
                    .map(|c| c.split(';').next().unwrap_or("").to_string())
                    .collect::<Vec<_>>()
                    .join("; ");
                // 如果 Set-Cookie 没有 MUSIC_U，尝试从 body 提取
                let cookie = if cookie.contains("MUSIC_U") {
                    cookie
                } else {
                    serde_json::from_str::<serde_json::Value>(&body_text)
                        .ok()
                        .and_then(|v| v["cookie"].as_str().map(String::from))
                        .unwrap_or(cookie)
                };
                if !cookie.contains("MUSIC_U") {
                    tracing::warn!("扫码成功但未获取到 MUSIC_U cookie，set-cookie: {:?}", set_cookie);
                    return Err(orange_core::CoreError::AuthFailed(
                        "扫码成功但未获取到登录凭证，请重试".into()
                    ));
                }
                *self.cookie.write().await = Some(cookie.clone());
                self.logged_in.store(true, Ordering::Relaxed);
                tracing::info!("网易云扫码登录成功");
                Ok(QrCodeStatus::Confirmed { cookie })
            }
            // 8821 = 网易云风控拦截（非官方客户端）
            8821 => Err(orange_core::CoreError::AuthFailed(
                "网易云风控拦截：请改用 Cookie 登录（在浏览器登录 music.163.com 后复制 MUSIC_U cookie）".into()
            )),
            // 其他 code（如 400/502）当作等待处理，避免轮询中断
            _ => {
                tracing::debug!("扫码未知状态 code={}", code);
                Ok(QrCodeStatus::Waiting)
            }
        }
    }

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
