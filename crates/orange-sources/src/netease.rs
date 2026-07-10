//! 网易云音乐音源（用户账号 + 第三方接口）
//!
//! 设计原则：
//! - 用户绑定自己的网易云账号（Cookie / 二维码），使用自己的权益
//! - 不破解付费墙，VIP 曲目需用户自己是 VIP 才能播放
//! - 依赖网易云网页接口，标注为"实验性"，可能因风控变动而失效
//!
//! 登录方式：
//! 1. Cookie 导入（用户从 music.163.com 浏览器复制 MUSIC_U cookie）
//! 2. 二维码扫码（推荐，应用内显示二维码，无需打开浏览器）
//!
//! 登录态持久化：通过 [`AuthStore`] 加密存到本地，下次启动自动恢复登录。

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::{Artwork, ArtworkSource, Track, TrackMeta};
use orange_core::Result;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::auth_store::AuthStore;
use crate::http_client::HttpClient;

const BASE: &str = "https://music.163.com";
const AUTH_SOURCE_KEY: &str = "netease";

pub struct NeteaseSource {
    id: SourceId,
    client: reqwest::Client,
    /// 扫码登录专用 client：启用 cookie_store 共享 unikey 种下的游客 cookie，
    /// 同时禁用重定向（803 成功时可能 302，跟随会丢 Set-Cookie 里的 MUSIC_U）。
    /// 用独立 client 而非 self.client，避免把扫码中间 cookie 混入已登录会话。
    qr_client: reqwest::Client,
    /// 登录态 Cookie（MUSIC_U=xxx）
    cookie: Arc<RwLock<Option<String>>>,
    /// 是否已登录（同步可读，配合 is_ready）
    logged_in: Arc<AtomicBool>,
    /// 加密持久化存储
    auth_store: Arc<AuthStore>,
    /// 鉴权过期事件 sink（cookie 失效时调用，emit 到前端）
    event_sink: Option<Arc<dyn orange_core::AuthEventSink>>,
    /// 当前播放音质偏好（映射到网易云 player/url/v1 的 level 参数）
    quality_level: Arc<RwLock<String>>,
    /// 共享 HTTP 客户端（注入时用于幂等 GET 缓存）
    shared_client: Option<Arc<HttpClient>>,
}

impl NeteaseSource {
    pub fn new(
        auth_store: Arc<AuthStore>,
        event_sink: Option<Arc<dyn orange_core::AuthEventSink>>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();

        // 扫码专用 client：cookie_store 共享 unikey/check 的 cookie，禁用重定向保住 803 的 Set-Cookie。
        // 不启用 cookie_store 时 client/login 会因缺 cookie 返回 code=400（参数错误）。
        let qr_client = reqwest::Client::builder()
            .cookie_store(true)
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        // 启动时尝试从 AuthStore 恢复登录态（零 IO，cache 已在 AuthStore::new 时填充）
        let (initial_cookie, already_logged_in) = match auth_store.get_sync(AUTH_SOURCE_KEY) {
            Some(auth) if !auth.cookie.is_empty() && auth.cookie.contains("MUSIC_U") => {
                tracing::info!("网易云从 AuthStore 恢复登录态");
                (Some(auth.cookie), true)
            }
            _ => (None, false),
        };

        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            client,
            qr_client,
            cookie: Arc::new(RwLock::new(initial_cookie)),
            logged_in: Arc::new(AtomicBool::new(already_logged_in)),
            auth_store,
            event_sink,
            quality_level: Arc::new(RwLock::new("standard".into())),
            shared_client: None,
        }
    }

    /// 构造时不带 event_sink（用于测试 / 默认 fallback）
    pub fn without_event_sink(auth_store: Arc<AuthStore>) -> Self {
        Self::new(auth_store, None)
    }

    pub fn with_client(mut self, client: Arc<HttpClient>) -> Self {
        self.shared_client = Some(client);
        self
    }

    /// 优先使用共享 HttpClient 的 TTL 缓存 GET；未注入时回退到私有 client。
    async fn http_get_cached(
        &self,
        url: &str,
        headers: &[(&str, &str)],
        ttl: u64,
    ) -> Result<String> {
        if let Some(c) = self.shared_client.as_ref() {
            c.get_cached(url, headers, ttl).await
        } else {
            let mut req = self.client.get(url);
            for (k, v) in headers {
                req = req.header(*k, *v);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
            let status = resp.status();
            let text = resp
                .text()
                .await
                .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
            if !status.is_success() {
                return Err(orange_core::CoreError::Network(format!(
                    "HTTP {}: {}",
                    status,
                    crate::http_client::safe_truncate(&text, 200)
                )));
            }
            Ok(text)
        }
    }

    /// 设置播放音质（对应网易云 /weapi/song/enhance/player/url/v1 的 level 参数）
    pub async fn set_quality(&self, level: &str) {
        let valid = matches!(
            level,
            "standard"
                | "higher"
                | "exhigh"
                | "lossless"
                | "hires"
                | "jyeffect"
                | "jymaster"
                | "sky"
                | "dolby"
        );
        if valid {
            *self.quality_level.write().await = level.to_string();
            tracing::info!("网易云音质设置为: {}", level);
        } else {
            tracing::warn!("网易云收到无效音质级别: {}，保持原设置", level);
        }
    }

    /// 当前播放音质
    pub async fn quality(&self) -> String {
        self.quality_level.read().await.clone()
    }

    /// 当前播放音质映射为统一的 Quality 枚举
    async fn track_quality(&self) -> orange_core::audio_format::Quality {
        use orange_core::audio_format::Quality;
        match self.quality().await.as_str() {
            "standard" => Quality::Standard,
            "higher" | "exhigh" => Quality::High,
            "lossless" => Quality::Lossless,
            "hires" => Quality::HiRes,
            "jyeffect" | "jymaster" | "sky" | "dolby" => Quality::Master,
            _ => Quality::High,
        }
    }

    /// 后台健康检查循环：每 6 小时调一次 `/weapi/w/nuser/account/get` 验证 cookie
    /// 失败 → 清 cookie + 标记未登录 + emit AuthExpired
    ///
    /// **必须是 async 函数**，由调用方用 `tauri::async_runtime::spawn` 提交到 runtime：
    /// ```ignore
    /// rt::spawn(async move { src.run_health_loop().await; });
    /// ```
    /// 整个函数体在 tokio runtime worker 上跑，sleep/interval/check 都安全。
    pub async fn run_health_loop(self: Arc<Self>) {
        // 首次等 60s 让 UI 起来
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(6 * 3600));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            if self.logged_in.load(Ordering::Relaxed) {
                if let Err(e) = self.check_and_clear_if_expired().await {
                    tracing::warn!("网易云 health check 出错: {}", e);
                }
            }
            interval.tick().await;
        }
    }

    /// Heartbeat：调 `/weapi/w/nuser/account/get` 验证 cookie 是否还有效
    async fn heartbeat_check(&self) -> Result<bool> {
        // 没登录直接返回 false
        if self.cookie_str().await.is_none() {
            return Ok(false);
        }
        // 调 weapi 获取当前账号信息；成功 → 有效；失败或 code != 200 → 失效
        match self
            .weapi_post("/weapi/w/nuser/account/get", r#"{"csrf_token":""}"#)
            .await
        {
            Ok(v) => {
                let valid =
                    v["code"].as_i64() == Some(200) && v["account"]["id"].as_i64().is_some();
                Ok(valid)
            }
            Err(orange_core::CoreError::AuthFailed(_)) => Ok(false),
            Err(e) => {
                tracing::debug!("网易云 heartbeat 网络错误: {}", e);
                // 网络错误保守当作有效（避免误判；下次再测）
                Ok(true)
            }
        }
    }

    /// 完整流程：heartbeat → 失效就清 cookie + emit AuthExpired
    pub async fn check_and_clear_if_expired(&self) -> Result<bool> {
        if !self.heartbeat_check().await? {
            tracing::warn!("网易云 cookie heartbeat 失败，标记未登录");
            *self.cookie.write().await = None;
            self.logged_in.store(false, Ordering::Relaxed);
            let _ = self.auth_store.clear(AUTH_SOURCE_KEY).await;
            if let Some(sink) = &self.event_sink {
                sink.on_auth_expired(orange_core::AuthExpiredPayload {
                    source: "netease".into(),
                    source_name: "网易云音乐".into(),
                    reason: Some("cookie 已失效".into()),
                });
            }
            return Ok(false);
        }
        Ok(true)
    }

    /// 当前 cookie（克隆）
    async fn cookie_str(&self) -> Option<String> {
        self.cookie.read().await.clone()
    }

    /// weapi 加密 POST 请求（带登录 cookie）
    async fn weapi_post(&self, path: &str, payload: &str) -> Result<serde_json::Value> {
        let user_cookie = self
            .cookie_str()
            .await
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录网易云".into()))?;
        let cookie = format!("{}; os=pc; appver=2.10.14", user_cookie);
        let (params, enc_sec_key) = crate::weapi::encrypt(payload);

        let resp = self
            .client
            .post(format!("{}{}?csrf_token=", BASE, path))
            .header("Cookie", &cookie)
            .header("Referer", BASE)
            .header("Origin", "https://music.163.com")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "params={}&encSecKey={}",
                urlencoding(&params),
                urlencoding(&enc_sec_key)
            ))
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let text = resp
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        serde_json::from_str(&text).map_err(|e| {
            orange_core::CoreError::Network(format!(
                "JSON解析失败: {} body={}",
                e,
                crate::http_client::safe_truncate(&text, 200)
            ))
        })
    }

    /// 获取用户歌单
    ///
    /// 返回 (id, name, 歌曲数, 封面URL, 播放数)
    pub async fn user_playlists(&self) -> Result<Vec<(String, String, u32, String, u64)>> {
        // 先获取用户 uid（从 MUSIC_U 解析复杂，这里用 /weapi/w/nuser/account/get）
        let account = self
            .weapi_post("/weapi/w/nuser/account/get", r#"{"csrf_token":""}"#)
            .await?;
        let uid = account["account"]["id"]
            .as_i64()
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
                // 封面图：网易云返回的 coverImgUrl 是高清原图，加 ?param=300x300 缩略
                let cover = p["coverImgUrl"]
                    .as_str()
                    .map(|u| {
                        if u.contains('?') {
                            format!("{}&param=300y300", u)
                        } else {
                            format!("{}?param=300y300", u)
                        }
                    })
                    .unwrap_or_default();
                let play_count = p["playCount"].as_i64().unwrap_or(0) as u64;
                playlists.push((id, name, count, cover, play_count));
            }
        }
        Ok(playlists)
    }

    /// 获取每日推荐歌曲
    pub async fn daily_songs(&self) -> Result<Vec<Track>> {
        let resp = self
            .weapi_post(
                "/weapi/v3/discovery/recommend/songs",
                r#"{"limit":30,"offset":0,"total":true,"csrf_token":""}"#,
            )
            .await?;

        let mut tracks = Vec::new();
        if let Some(list) = resp["data"]["dailySongs"].as_array() {
            let q = self.track_quality().await;
            for s in list {
                let mut t = parse_netease_song(s, self.id);
                t.format = orange_core::audio_format::AudioFormat::Mp3;
                t.quality = q;
                tracks.push(t);
            }
        }
        Ok(tracks)
    }

    /// 获取官方排行榜列表
    ///
    /// 返回 (id, name, cover, play_count)
    pub async fn toplists(&self) -> Result<Vec<(String, String, String, u64)>> {
        let resp = self
            .weapi_post("/weapi/toplist", r#"{"csrf_token":""}"#)
            .await?;

        let mut lists = Vec::new();
        if let Some(arr) = resp["list"].as_array() {
            for item in arr {
                let id = item["id"].as_i64().unwrap_or(0).to_string();
                let name = item["name"].as_str().unwrap_or("未知榜单").to_string();
                let cover = item["coverImgUrl"]
                    .as_str()
                    .map(|u| {
                        if u.contains('?') {
                            format!("{}&param=300y300", u)
                        } else {
                            format!("{}?param=300y300", u)
                        }
                    })
                    .unwrap_or_default();
                let play_count = item["playCount"].as_i64().unwrap_or(0) as u64;
                lists.push((id, name, cover, play_count));
            }
        }
        Ok(lists)
    }

    /// 获取排行榜详情（歌曲列表）
    ///
    /// 网易云官方排行榜在数据模型里就是顶层 playlist，ID 与 playlist ID 互通。
    /// /weapi/toplist/detail 端点返回的是 `{first, second}` 摘要（不是完整 Track），
    /// 必须改用 /weapi/v6/playlist/detail（同 playlist_detail 端点）才能拿到完整歌曲。
    pub async fn toplist_detail(&self, toplist_id: &str) -> Result<Vec<Track>> {
        let payload = format!(r#"{{"id":{},"n":100,"s":0,"csrf_token":""}}"#, toplist_id);
        let resp = self
            .weapi_post("/weapi/v6/playlist/detail", &payload)
            .await?;

        let mut tracks = Vec::new();
        if let Some(list) = resp["playlist"]["tracks"].as_array() {
            let q = self.track_quality().await;
            for s in list {
                let mut t = parse_netease_song(s, self.id);
                t.format = orange_core::audio_format::AudioFormat::Mp3;
                t.quality = q;
                tracks.push(t);
            }
        }
        Ok(tracks)
    }

    /// 获取歌单详情（歌曲列表）
    pub async fn playlist_detail(&self, playlist_id: &str) -> Result<Vec<Track>> {
        let payload = format!(r#"{{"id":{},"n":100,"s":0,"csrf_token":""}}"#, playlist_id);
        let resp = self
            .weapi_post("/weapi/v6/playlist/detail", &payload)
            .await?;

        let mut tracks = Vec::new();
        if let Some(list) = resp["playlist"]["tracks"].as_array() {
            let q = self.track_quality().await;
            for s in list {
                let mut t = parse_netease_song(s, self.id);
                t.format = orange_core::audio_format::AudioFormat::Mp3;
                t.quality = q;
                tracks.push(t);
            }
        }
        Ok(tracks)
    }

    /// 获取歌曲歌词（原文 + 翻译）
    ///
    /// 端点 POST /weapi/song/lyric
    /// 参数 {id, lv:-1, tv:-1, csrf_token:""}
    /// 返回 {lrc:{lyric:"[mm:ss.xx]..."}, tlyric:{lyric:"...翻译"}}
    pub async fn song_lyric(&self, song_id: &str) -> Result<(String, Option<String>)> {
        // 校验 song_id 是纯数字（网易云歌曲 ID）
        if song_id.trim().is_empty() || !song_id.trim().chars().all(|c| c.is_ascii_digit()) {
            return Err(orange_core::CoreError::Unsupported("歌曲 ID 无效".into()));
        }
        let payload = format!(
            r#"{{"id":{},"lv":-1,"tv":-1,"csrf_token":""}}"#,
            song_id.trim()
        );
        let resp = self.weapi_post("/weapi/song/lyric", &payload).await?;

        // 原文歌词
        let raw_lrc = resp["lrc"]["lyric"].as_str().unwrap_or("").to_string();
        // 翻译歌词（罗马音/外文翻译，可选）
        let translated_lrc = resp["tlyric"]["lyric"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(String::from);

        if raw_lrc.is_empty() {
            tracing::debug!("网易云歌词为空 song_id={}", song_id);
        }
        Ok((raw_lrc, translated_lrc))
    }

    /// 获取歌曲热门评论
    ///
    /// 端点 POST /weapi/v1/resource/comments/R_SO_4_{歌曲ID}
    /// 资源标识 R_SO_4_ 表示歌曲（Song），后接歌曲数字 ID。
    /// payload 参数：{limit, offset, csrf_token}
    /// 返回 {hotComments:[{content,user:{nickname,avatarUrl},likedCount}], comments:[...], total}
    pub async fn song_comments(&self, song_id: &str, limit: u32) -> Result<CommentData> {
        if song_id.trim().is_empty() || !song_id.trim().chars().all(|c| c.is_ascii_digit()) {
            return Err(orange_core::CoreError::Unsupported("歌曲 ID 无效".into()));
        }
        let sid = song_id.trim();
        // 资源标识符拼进 URL 路径（R_SO_4_ = 歌曲）
        let path = format!("/weapi/v1/resource/comments/R_SO_4_{}", sid);
        let payload = format!(r#"{{"limit":{},"offset":0,"csrf_token":""}}"#, limit);
        let resp = self.weapi_post(&path, &payload).await?;

        let total = resp["total"].as_i64().unwrap_or(0) as u64;
        let mut hot_comments = Vec::new();
        // 优先取 hotComments；若无则降级取 comments（最新评论）
        let lists: Vec<&serde_json::Value> = resp
            .get("hotComments")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().collect())
            .unwrap_or_default();
        let fallback: Vec<&serde_json::Value> = if lists.is_empty() {
            resp.get("comments")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().collect())
                .unwrap_or_default()
        } else {
            vec![]
        };

        for c in lists.iter().chain(fallback.iter()) {
            let content = c["content"].as_str().unwrap_or("").to_string();
            if content.is_empty() {
                continue;
            }
            let nickname = c["user"]["nickname"]
                .as_str()
                .unwrap_or("匿名用户")
                .to_string();
            let avatar_url = c["user"]["avatarUrl"].as_str().map(String::from);
            let liked_count = c["likedCount"].as_i64().unwrap_or(0) as u64;
            hot_comments.push(HotComment {
                content,
                nickname,
                avatar_url,
                liked_count,
            });
        }
        Ok(CommentData {
            total,
            hot_comments,
        })
    }

    /// 收藏歌曲到网易云「我喜欢的音乐」歌单
    ///
    /// 流程：
    /// 1. 调 /weapi/w/nuser/account/get 获取 uid
    /// 2. 「我喜欢的音乐」歌单 ID = 用户歌单列表中第一个（网易云约定：用户的第一个歌单是"我喜欢的音乐"）
    /// 3. 调 /weapi/playlist/manipulate/tracks 添加歌曲
    ///
    /// 端点参数：{op:"add", pid:歌单ID, tracks:"歌曲ID", trackIds:[{id:歌曲ID}], csrf_token:""}
    /// 返回 body.code=200 成功，512=已在歌单中
    pub async fn like_track(&self, song_id: &str) -> Result<bool> {
        if song_id.trim().is_empty() || !song_id.trim().chars().all(|c| c.is_ascii_digit()) {
            return Err(orange_core::CoreError::Unsupported("歌曲 ID 无效".into()));
        }
        let sid = song_id.trim();

        // 1+2. 获取「我喜欢的音乐」歌单 ID
        let pid = self.fetch_liked_playlist_id().await?;

        // 3. 添加歌曲到歌单
        self.manipulate_track(pid, sid, "add").await
    }

    /// 添加网易云歌曲到任意指定歌单（用户自建/收藏的远端歌单）
    ///
    /// playlist_id 来自 `user_playlists()` 返回的第一个之后的项；
    /// like_track 已封装为「我喜欢的音乐」这个特殊 PID 的快捷方式。
    pub async fn add_track_to_playlist(&self, playlist_id: i64, song_id: &str) -> Result<bool> {
        if playlist_id <= 0 {
            return Err(orange_core::CoreError::Unsupported("歌单 ID 无效".into()));
        }
        if song_id.trim().is_empty() || !song_id.trim().chars().all(|c| c.is_ascii_digit()) {
            return Err(orange_core::CoreError::Unsupported("歌曲 ID 无效".into()));
        }
        self.manipulate_track(playlist_id, song_id.trim(), "add")
            .await
    }

    /// 调 /weapi/w/nuser/account/get + /weapi/user/playlist 获取「我喜欢的音乐」歌单 ID
    /// （网易云约定：用户的第一个歌单永远是「我喜欢的音乐」）
    async fn fetch_liked_playlist_id(&self) -> Result<i64> {
        let account = self
            .weapi_post("/weapi/w/nuser/account/get", r#"{"csrf_token":""}"#)
            .await?;
        let uid = account["account"]["id"]
            .as_i64()
            .ok_or_else(|| orange_core::CoreError::AuthFailed("无法获取用户ID".into()))?;
        let payload = format!(r#"{{"uid":{},"limit":1,"offset":0,"csrf_token":""}}"#, uid);
        let resp = self.weapi_post("/weapi/user/playlist", &payload).await?;
        resp["playlist"]
            .get(0)
            .and_then(|p| p["id"].as_i64())
            .ok_or_else(|| {
                orange_core::CoreError::AuthFailed("无法获取「我喜欢的音乐」歌单ID".into())
            })
    }

    /// 通用添加/移除歌曲到歌单的底层调用
    /// op: "add" | "del"
    async fn manipulate_track(&self, pid: i64, song_id: &str, op: &str) -> Result<bool> {
        let add_payload = format!(
            r#"{{"op":"{}","pid":{},"tracks":"{}","trackIds":"[{{\"id\":{}}}]","csrf_token":""}}"#,
            op, pid, song_id, song_id
        );
        let result = self
            .weapi_post("/weapi/playlist/manipulate/tracks", &add_payload)
            .await?;
        let code = result["body"]["code"].as_i64().unwrap_or(0);
        tracing::info!(
            "网易云歌单操作 op={} pid={} song_id={} code={}",
            op,
            pid,
            song_id,
            code
        );
        // 200=成功，512=已在歌单中（add 时算成功）
        Ok(code == 200 || code == 512)
    }
}

/// 网易云热门评论数据
pub struct CommentData {
    pub total: u64,
    pub hot_comments: Vec<HotComment>,
}

/// 单条热门评论
pub struct HotComment {
    pub content: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub liked_count: u64,
}

/// URL 编码（用于 form-urlencoded body）
fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
                (b as char).to_string()
            } else {
                format!("%{:02X}", b)
            }
        })
        .collect()
}

/// 网易云搜索结果（歌曲）
#[derive(Debug, Deserialize)]
struct NeteaseSearchResp {
    result: Option<NeteaseSearchResult>,
}
#[derive(Debug, Deserialize, Default)]
#[allow(non_snake_case)]
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
struct NeteaseArtist {
    name: String,
}
#[derive(Debug, Deserialize)]
struct NeteaseAlbum {
    name: String,
    /// 专辑封面原图（搜索接口也返回，与 playlist/daily 一致）
    #[serde(default)]
    pic_url: Option<String>,
}

/// 播放 URL 响应
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct SongUrlResp {
    data: Vec<SongUrlData>,
}
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct SongUrlData {
    url: Option<String>,
    size: Option<u64>,
}

/// 把 picUrl 套上 300x300 缩略参数；空 picUrl 返回 None
fn build_netease_artwork(pic: Option<String>) -> Option<orange_core::track::Artwork> {
    let raw = pic?;
    let url = if raw.contains('?') {
        format!("{raw}&param=300y300")
    } else {
        format!("{raw}?param=300y300")
    };
    Some(orange_core::track::Artwork {
        source: orange_core::track::ArtworkSource::Url { url },
        dominant_color: None,
        palette: vec![],
    })
}

fn song_to_track(song: &NeteaseSong, source_id: SourceId) -> Track {
    let artist = song
        .artists
        .iter()
        .map(|a| a.name.as_str())
        .collect::<Vec<_>>()
        .join("/");
    let album = song.album.as_ref().map(|a| a.name.clone());
    let artwork = build_netease_artwork(song.album.as_ref().and_then(|a| a.pic_url.clone()));
    let mut t = Track::new(
        source_id,
        song.id.to_string(), // source_track_id 存网易云歌曲 ID
        TrackMeta {
            title: song.name.clone(),
            artist,
            album,
            duration_secs: song.duration.map(|d| d as f64 / 1000.0),
            artwork,
            ..Default::default()
        },
    );
    t.source_kind = SourceKind::NeteaseCloudMusic;
    t.format = orange_core::audio_format::AudioFormat::Mp3;
    t.quality = orange_core::audio_format::Quality::High;
    t
}

/// 从 weapi JSON 响应解析歌曲（daily_songs / playlist_detail 共用）
///
/// 字段说明：al.picUrl=专辑封面，al.name=专辑名，ar[]=艺术家，dt=时长(ms)
fn parse_netease_song(s: &serde_json::Value, source_id: SourceId) -> Track {
    let id = s["id"].as_i64().unwrap_or(0);
    let name = s["name"].as_str().unwrap_or("").to_string();
    let artists: Vec<String> = s["ar"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let artist = artists.join("/");
    let album = s["al"]["name"].as_str().map(String::from);
    let dt = s["dt"].as_i64().map(|d| d as f64 / 1000.0);
    // 封面图：网易云 al.picUrl 是高清原图，加 ?param=300x300 缩略
    let pic_url = s["al"]["picUrl"].as_str().map(|u| {
        if u.contains('?') {
            format!("{}&param=300y300", u)
        } else {
            format!("{}?param=300y300", u)
        }
    });
    let artwork = pic_url.map(|url| Artwork {
        source: ArtworkSource::Url { url },
        dominant_color: None,
        palette: vec![],
    });

    let mut t = Track::new(
        source_id,
        id.to_string(),
        TrackMeta {
            title: name,
            artist,
            album,
            duration_secs: dt,
            artwork,
            ..Default::default()
        },
    );
    t.source_kind = SourceKind::NeteaseCloudMusic;
    t
}

#[async_trait]
impl AudioSource for NeteaseSource {
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::NeteaseCloudMusic
    }
    fn name(&self) -> &str {
        "网易云音乐"
    }
    fn requires_auth(&self) -> bool {
        true
    }

    fn is_ready(&self) -> bool {
        self.logged_in.load(Ordering::Relaxed)
    }

    async fn search(&self, query: &SearchQuery) -> Result<SearchResult> {
        let cookie = self.cookie_str().await;
        let limit = query.page_size.min(50);
        let offset = ((query.page.saturating_sub(1)) as usize) * limit as usize;
        let url = format!(
            "{}/api/search/get/web?csrf_token=&type=1&offset={}&limit={}&s={}",
            BASE,
            ((query.page.saturating_sub(1)) as usize) * limit as usize,
            limit,
            &query.keyword
        );

        let mut headers: Vec<(&str, &str)> = vec![("Referer", BASE)];
        if let Some(c) = &cookie {
            headers.push(("Cookie", c));
        }
        let body = self.http_get_cached(&url, &headers, 300).await?;
        let resp: NeteaseSearchResp = serde_json::from_str(&body)
            .map_err(|e| orange_core::CoreError::Network(format!("JSON 解析失败: {e}")))?;

        let result = resp.result.unwrap_or_default();
        let songs = result.songs.unwrap_or_default();
        let total = result.songCount.unwrap_or(0);
        let q = self.track_quality().await;
        let tracks = songs
            .iter()
            .map(|s| {
                let mut t = song_to_track(s, self.id);
                t.quality = q;
                t
            })
            .collect();
        Ok(SearchResult {
            tracks,
            total,
            has_more: total > (offset as u32 + limit),
        })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        let user_cookie = self
            .cookie_str()
            .await
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录网易云".into()))?;

        // 补充 weapi 必需的 cookie 参数（网易云服务端要求 os=pc 等）
        let cookie = format!("{}; os=pc; appver=2.10.14", user_cookie);
        let level = self.quality().await;

        // weapi 加密 POST 获取播放地址
        let payload = format!(
            r#"{{"ids":"[{}]","level":"{}","encodeType":"aac","csrf_token":""}}"#,
            track.source_track_id, level
        );
        let (params, enc_sec_key) = crate::weapi::encrypt(&payload);

        let resp = self
            .client
            .post(format!(
                "{}/weapi/song/enhance/player/url/v1?csrf_token=",
                BASE
            ))
            .header("Cookie", &cookie)
            .header("Referer", BASE)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .header("Origin", "https://music.163.com")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "params={}&encSecKey={}",
                urlencoding(&params),
                urlencoding(&enc_sec_key)
            ))
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let body_text = resp
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        tracing::debug!(
            "网易云播放地址响应: {}",
            &body_text[..body_text.len().min(300)]
        );

        let v: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let play_url = v["data"]
            .get(0)
            .and_then(|d| d["url"].as_str())
            .filter(|u| !u.is_empty())
            .ok_or_else(|| {
                orange_core::CoreError::Unsupported(
                    "无法获取播放地址（可能需VIP或版权限制）".into(),
                )
            })?
            .to_string();

        Ok(StreamLocation::Url {
            url: play_url,
            headers: vec![],
        })
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
        struct UnikeyResp {
            code: i32,
            unikey: String,
        }
        let resp: UnikeyResp = self
            .qr_client
            .get(format!("{}/api/login/qrcode/unikey?type=1", BASE))
            .header("Referer", BASE)
            .header("User-Agent", "Mozilla/5.0")
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        if resp.code != 200 {
            return Err(orange_core::CoreError::AuthFailed(format!(
                "获取二维码 key 失败: code={}",
                resp.code
            )));
        }

        // 二维码内容：网易云 APP 扫码后会自动打开此 URL 完成登录
        let qr_image = format!("{}/login?codekey={}", BASE, resp.unikey);
        tracing::info!(
            "网易云生成扫码 unikey={}（cookie 已种入 qr_client）",
            resp.unikey
        );
        Ok(QrCodeLogin {
            key: resp.unikey,
            qr_image,
        })
    }

    /// 轮询二维码扫码状态
    ///
    /// GET /api/login/qrcode/client/login?key={key}
    /// 返回码：800=过期 801=等待扫码 802=已扫码待确认 803=成功(返回cookie)
    ///
    /// 关键：用不跟随重定向的 client，确保 803 时的 Set-Cookie 不丢失。
    async fn qrcode_check(&self, key: &str) -> Result<QrCodeStatus> {
        let url = format!("{}/api/login/qrcode/client/login?key={}&type=1", BASE, key);

        // 复用 self.qr_client（cookie_store + no_redirect）：自动带上 unikey 种下的游客 cookie，
        // 否则接口返回 code=400（参数错误）；同时禁用重定向以保住 803 的 Set-Cookie。
        let resp = self
            .qr_client
            .get(&url)
            .header("Referer", BASE)
            .send()
            .await
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
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        tracing::info!(
            "扫码 check 响应: code={} body={}",
            serde_json::from_str::<serde_json::Value>(&body_text)
                .ok()
                .and_then(|v| v["code"].as_i64())
                .unwrap_or(-1),
            &body_text[..body_text.len().min(160)]
        );

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
                // 加密持久化，下次启动自动恢复登录
                if let Err(e) = self.auth_store.save(AUTH_SOURCE_KEY, cookie.clone()).await {
                    tracing::warn!("网易云 cookie 持久化失败: {}", e);
                }
                tracing::info!("网易云扫码登录成功");
                Ok(QrCodeStatus::Confirmed { cookie })
            }
            // 8821 = 网易云易盾风控：非官方客户端被识别为"安全环境异常"。
            // 服务端行为，无法在客户端绕过；引导用户改用 Cookie 登录（浏览器已通过风控）。
            // 走 Blocked 状态（而非 Err）让前端能展示明确提示，否则会被轮询 catch 吞掉、UI 卡死。
            8821 => Ok(QrCodeStatus::Blocked {
                message: "扫码被网易云安全风控拦截(8821，非官方客户端)。请在浏览器登录 music.163.com 后，复制含 MUSIC_U 的 cookie，改用 Cookie 登录".into(),
            }),
            // 其他 code（如 400 参数错误 / 502）记告警便于排查，按等待处理避免轮询中断
            _ => {
                tracing::warn!(
                    "扫码未知状态 code={} 响应: {}",
                    code,
                    crate::http_client::safe_truncate(&body_text, 200)
                );
                Ok(QrCodeStatus::Waiting)
            }
        }
    }

    /// Cookie 登录：用户从浏览器复制 MUSIC_U=xxx
    async fn login_with_cookie(&self, cookie: &str) -> Result<()> {
        // 简单校验：网易云登录态核心是 MUSIC_U
        if !cookie.contains("MUSIC_U") && !cookie.contains("music_u") {
            return Err(orange_core::CoreError::AuthFailed(
                "Cookie 缺少 MUSIC_U，请确认从 music.163.com 复制完整 Cookie".into(),
            ));
        }
        *self.cookie.write().await = Some(cookie.to_string());
        self.logged_in.store(true, Ordering::Relaxed);
        // 加密持久化
        if let Err(e) = self
            .auth_store
            .save(AUTH_SOURCE_KEY, cookie.to_string())
            .await
        {
            tracing::warn!("网易云 cookie 持久化失败: {}", e);
        }
        tracing::info!("网易云账号已登录（Cookie）");
        Ok(())
    }

    async fn logout(&self) -> Result<()> {
        *self.cookie.write().await = None;
        self.logged_in.store(false, Ordering::Relaxed);
        if let Err(e) = self.auth_store.clear(AUTH_SOURCE_KEY).await {
            tracing::warn!("网易云 cookie 清除失败: {}", e);
        }
        Ok(())
    }

    async fn current_user(&self) -> Result<Option<UserInfo>> {
        if self.cookie_str().await.is_none() {
            return Ok(None);
        }

        // 调网易云账号信息接口获取真实昵称/头像/VIP 状态
        match self
            .weapi_post("/weapi/w/nuser/account/get", r#"{"csrf_token":""}"#)
            .await
        {
            Ok(v) if v["code"].as_i64() == Some(200) => {
                let account = &v["account"];
                let profile = &v["profile"];
                let uid = account["id"]
                    .as_i64()
                    .map(|id| id.to_string())
                    .or_else(|| profile["userId"].as_i64().map(|id| id.to_string()))
                    .unwrap_or_default();
                let nickname = profile["nickname"]
                    .as_str()
                    .unwrap_or("网易云用户")
                    .to_string();
                let avatar_url = profile["avatarUrl"].as_str().map(String::from);
                // vipType: 0=普通, 1=黑胶 VIP(月), 2=黑胶 VIP(年), 4=黑胶 SVIP, 11=Musician?
                let vip_type = profile["vipType"]
                    .as_i64()
                    .or_else(|| account["vipType"].as_i64())
                    .unwrap_or(0);
                let vip = vip_type > 0;
                Ok(Some(UserInfo {
                    uid,
                    nickname,
                    avatar_url,
                    vip,
                }))
            }
            Ok(v) => {
                tracing::warn!("网易云获取账号信息失败: code={:?}", v["code"]);
                Ok(None)
            }
            Err(e) => {
                tracing::warn!("网易云获取账号信息请求失败: {}", e);
                Ok(None)
            }
        }
    }
}

impl Default for NeteaseSource {
    /// 仅用于 trait/object 默认构造 —— 不含持久化，请通过 [`NeteaseSource::new`] 注入 AuthStore。
    fn default() -> Self {
        let tmp = std::env::temp_dir().join("orangeradio-default-auth");
        let store = AuthStore::new(tmp);
        Self::without_event_sink(store)
    }
}
