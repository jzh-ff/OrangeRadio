//! QQ 音乐音源（用户账号 + 搜索接口）
//!
//! 搜索：QQ 音乐的 musicu.fcg 接口可免登录搜索（返回元数据）
//! 播放：获取播放 vkey 需要登录态（Cookie 含 uin + qqmusic_key）
//!
//! 设计原则同网易云：用户用自己的账号权益，不破解付费墙
//!
//! 登录态持久化：通过 [`AuthStore`] 加密存到本地，下次启动自动恢复登录。
//! 自动续期：后台 tokio interval 任务定期调 QQ 续期接口刷新 musickey，避免 cookie 过期要重新扫码。

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::{Track, TrackMeta};
use orange_core::Result;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::auth_store::AuthStore;
use crate::http_client::HttpClient;

const AUTH_SOURCE_KEY: &str = "qqmusic";

pub struct QqMusicSource {
    id: SourceId,
    client: reqwest::Client,
    cookie: Arc<RwLock<Option<String>>>,
    logged_in: Arc<AtomicBool>,
    /// 加密持久化存储
    auth_store: Arc<AuthStore>,
    /// 鉴权过期事件 sink（cookie 失效时调用，emit 到前端）
    event_sink: Option<Arc<dyn orange_core::AuthEventSink>>,
    shared_client: Option<Arc<HttpClient>>,
}

impl QqMusicSource {
    pub fn new(
        auth_store: Arc<AuthStore>,
        event_sink: Option<Arc<dyn orange_core::AuthEventSink>>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (iPhone; CPU iPhone OS 13_0 like Mac OS X)")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();

        // 启动时尝试从 AuthStore 恢复登录态
        let (initial_cookie, already_logged_in) = match auth_store.get_sync(AUTH_SOURCE_KEY) {
            Some(auth) if !auth.cookie.is_empty() && auth.cookie.contains("uin") => {
                tracing::info!("QQ音乐从 AuthStore 恢复登录态");
                (Some(auth.cookie), true)
            }
            _ => (None, false),
        };

        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            client,
            cookie: Arc::new(RwLock::new(initial_cookie)),
            logged_in: Arc::new(AtomicBool::new(already_logged_in)),
            auth_store,
            event_sink,
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
    ///
    /// 当前 QQ 搜索/歌词均为 POST，helper 暂未使用；保留以备未来 GET 端点复用。
    #[allow(dead_code)]
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

    /// 当前 cookie（克隆）
    async fn cookie_str(&self) -> Option<String> {
        self.cookie.read().await.clone()
    }

    /// 从 Set-Cookie 提取 QQ 音乐登录态（uin + qqmusic_key 等）
    #[allow(dead_code)]
    async fn extract_qq_cookie(
        &self,
        set_cookies: Vec<String>,
    ) -> Result<orange_core::QrCodeStatus> {
        let wanted = [
            "uin=",
            "qqmusic_key=",
            "skey=",
            "p_skey=",
            "pt2gguin=",
            "psrt=",
            "ptcz=",
            "p_uin=",
        ];
        let cookie_parts: Vec<String> = set_cookies
            .iter()
            .filter_map(|c| {
                let kv = c.split(';').next().unwrap_or("");
                if wanted.iter().any(|w| kv.starts_with(w)) {
                    Some(kv.to_string())
                } else {
                    None
                }
            })
            .collect();
        // 去重
        let mut seen = std::collections::HashSet::new();
        let cookie_parts: Vec<String> = cookie_parts
            .into_iter()
            .filter(|c| {
                let key = c.split('=').next().unwrap_or("");
                seen.insert(key.to_string())
            })
            .collect();
        let cookie = cookie_parts.join("; ");
        tracing::info!(
            "QQ音乐提取cookie 字段数={} cookie={}",
            cookie_parts.len(),
            &cookie[..cookie.len().min(100)]
        );

        if cookie.contains("uin=") {
            *self.cookie.write().await = Some(cookie.clone());
            self.logged_in.store(true, Ordering::Relaxed);
            tracing::info!("QQ音乐扫码登录成功");
            Ok(orange_core::QrCodeStatus::Confirmed { cookie })
        } else {
            Err(orange_core::CoreError::AuthFailed(
                "扫码成功但未获取到 uin cookie，请改用 Cookie 登录".into(),
            ))
        }
    }

    /// QQ 音乐统一 JSON POST（musicu.fcg），带登录 cookie
    async fn qq_post(&self, payload: &serde_json::Value) -> Result<serde_json::Value> {
        let cookie = self
            .cookie_str()
            .await
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录QQ音乐".into()))?;
        let resp = self
            .client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Cookie", &cookie)
            .header("Referer", "https://y.qq.com/")
            .json(payload)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))
    }

    /// 获取歌词（原文 + 翻译）
    /// 对照 qqmusic-api-python: music.musichallSong.PlayLyricInfo.GetPlayLyricInfo
    pub async fn song_lyric(&self, song_mid: &str) -> Result<(String, Option<String>)> {
        let cookie = self.cookie_str().await.unwrap_or_default();
        let payload = serde_json::json!({
            "comm": { "ct": "19", "cv": "0" },
            "req": {
                "module": "music.musichallSong.PlayLyricInfo",
                "method": "GetPlayLyricInfo",
                "param": {
                    "crypt": 1,
                    "lrc_t": 0,
                    "qrc": 0,
                    "qrc_t": 0,
                    "roma": 0,
                    "roma_t": 0,
                    "trans": 1,
                    "trans_t": 0,
                    "type": 1,
                    "songMid": song_mid,
                    "ct": 19,
                    "cv": 0
                }
            }
        });
        let resp = self
            .client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Referer", "https://y.qq.com/")
            .header("Cookie", &cookie)
            .json(&payload)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        use base64::Engine;
        let raw_lrc = resp["req"]["data"]["lyric"]
            .as_str()
            .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
            .and_then(|b| String::from_utf8(b).ok())
            .unwrap_or_default();

        let translated_lrc = resp["req"]["data"]["trans"]
            .as_str()
            .filter(|s| !s.is_empty())
            .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
            .and_then(|b| String::from_utf8(b).ok());

        Ok((raw_lrc, translated_lrc))
    }

    /// 获取热门评论
    pub async fn song_comments(
        &self,
        song_mid: &str,
        limit: u32,
    ) -> Result<(u64, Vec<(String, String, Option<String>, u64)>)> {
        let payload = serde_json::json!({
            "comm": { "cv": 4747474, "ct": 24, "format": "json", "inCharset": "utf-8", "outCharset": "utf-8" },
            "req": {
                "module": "music.globalComment.CommentCommand",
                "method": "GetCommentList",
                "param": {
                    "bizType": 1,
                    "bizId": song_mid,
                    "pageSize": limit,
                    "pageNo": 1,
                    "hotType": 1
                }
            }
        });
        let resp = self.qq_post(&payload).await?;
        let total = resp["req"]["data"]["total"].as_i64().unwrap_or(0) as u64;
        let mut comments = Vec::new();
        if let Some(arr) = resp["req"]["data"]["hotCommentList"].as_array() {
            for c in arr {
                let content = c["content"].as_str().unwrap_or("").to_string();
                if content.is_empty() {
                    continue;
                }
                let nickname = c["userInfo"]["nick"]
                    .as_str()
                    .or_else(|| c["u"]["name"].as_str())
                    .unwrap_or("匿名")
                    .to_string();
                let avatar = c["userInfo"]["head"]
                    .as_str()
                    .or_else(|| c["u"]["headurl"].as_str())
                    .map(String::from);
                let liked = c["praiseNum"].as_i64().unwrap_or(0) as u64;
                comments.push((content, nickname, avatar, liked));
            }
        }
        Ok((total, comments))
    }

    /// 获取用户歌单（需登录）
    /// 对照 qqmusic-api-python: music.srfDissInfo.DissInfo.GetSonglist
    pub async fn user_playlists(&self) -> Result<Vec<(String, String, u32, String)>> {
        let cookie = self
            .cookie_str()
            .await
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录QQ音乐".into()))?;
        // 从 cookie 提取 musicid
        let musicid = cookie
            .split(';')
            .find_map(|kv| {
                let kv = kv.trim();
                kv.strip_prefix("musicid=").map(String::from)
            })
            .unwrap_or_else(|| "0".into());
        let payload = serde_json::json!({
            "comm": { "ct": "24", "cv": "0", "uin": musicid },
            "req": {
                "module": "music.musicasset.PlaylistBaseRead",
                "method": "GetPlaylistByUin",
                "param": {
                    "hostUin": musicid,
                    "ctx": 0,
                    "size": 30,
                    "from": 0,
                    "sin": 0,
                    "ein": 30
                }
            }
        });
        let resp = self
            .client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Referer", "https://y.qq.com/")
            .header("Cookie", &cookie)
            .json(&payload)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let mut playlists = Vec::new();
        if let Some(arr) = resp["req"]["data"]["v_playlist"].as_array() {
            for p in arr {
                // 调试：打印第一个歌单的全部 key
                if playlists.is_empty() {
                    tracing::info!(
                        "QQ歌单字段 keys={:?}",
                        p.as_object().map(|o| o.keys().collect::<Vec<_>>())
                    );
                }
                let id = p["tid"]
                    .as_str()
                    .map(String::from)
                    .or_else(|| p["tid"].as_i64().map(|n| n.to_string()))
                    .or_else(|| p["dirId"].as_str().map(String::from))
                    .or_else(|| p["dirId"].as_i64().map(|n| n.to_string()))
                    .unwrap_or_default();
                let name = p["title"]
                    .as_str()
                    .or_else(|| p["diss_name"].as_str())
                    .or_else(|| p["name"].as_str())
                    .unwrap_or("未知歌单")
                    .to_string();
                let count = p["song_num"]
                    .as_i64()
                    .or_else(|| p["songnum"].as_i64())
                    .or_else(|| p["total_song_num"].as_i64())
                    .unwrap_or(0) as u32;
                let cover = p["picurl"]
                    .as_str()
                    .or_else(|| p["picUrl"].as_str())
                    .or_else(|| p["picurl2"].as_str())
                    .unwrap_or("")
                    .to_string();
                playlists.push((id, name, count, cover));
            }
        }
        tracing::info!(
            "QQ音乐获取用户歌单 {} 个: {:?}",
            playlists.len(),
            playlists
                .iter()
                .map(|(id, n, c, _)| format!("{}({}首,id={})", n, c, id))
                .collect::<Vec<_>>()
        );
        Ok(playlists)
    }

    /// 获取歌单详情（歌曲列表）
    /// 对照 qqmusic-api-python: music.srfDissInfo.DissInfo.GetSonglist
    pub async fn playlist_detail(&self, playlist_id: &str) -> Result<Vec<Track>> {
        let cookie = self.cookie_str().await.unwrap_or_default();
        // 对照 qqmusic-api-python: music.srfDissInfo.DissInfo.CgiGetDiss
        let payload = serde_json::json!({
            "comm": { "ct": "24", "cv": "0" },
            "req": {
                "module": "music.srfDissInfo.DissInfo",
                "method": "CgiGetDiss",
                "param": {
                    "disstid": playlist_id.parse::<i64>().unwrap_or(0),
                    "song_num": 100,
                    "song_begin": 0,
                    "userinfo": 1,
                    "tag": 1,
                    "is_pull_album_song": 0
                }
            }
        });
        let resp = self
            .client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Referer", "https://y.qq.com/")
            .header("Cookie", &cookie)
            .json(&payload)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let mut tracks = Vec::new();
        // 歌曲列表路径：dirinfo.songlist
        if let Some(list) = resp["req"]["data"]["dirinfo"]["songlist"].as_array() {
            for s in list {
                let mid = s["mid"].as_str().unwrap_or("").to_string();
                if mid.is_empty() {
                    continue;
                }
                let name = s["name"].as_str().unwrap_or("").to_string();
                let singer: Vec<String> = s["singer"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|a| a["name"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let artist = singer.join("/");
                let album = s["album"]["name"]
                    .as_str()
                    .filter(|x| !x.is_empty())
                    .map(String::from);
                let dt = s["interval"].as_i64().map(|d| d as f64);
                let album_mid = s["album"]["mid"].as_str().unwrap_or("");
                let artwork = if !album_mid.is_empty() {
                    Some(orange_core::track::Artwork {
                        source: orange_core::track::ArtworkSource::Url {
                            url: format!(
                                "https://y.gtimg.cn/music/photo_new/T002R300x300M000{}.jpg",
                                album_mid
                            ),
                        },
                        dominant_color: None,
                        palette: vec![],
                    })
                } else {
                    None
                };

                let mut t = Track::new(
                    self.id,
                    mid,
                    orange_core::track::TrackMeta {
                        title: name,
                        artist,
                        album,
                        duration_secs: dt,
                        artwork,
                        ..Default::default()
                    },
                );
                t.source_kind = SourceKind::QqMusic;
                t.format = orange_core::audio_format::AudioFormat::Mp3;
                t.quality = orange_core::audio_format::Quality::High;
                tracks.push(t);
            }
        }
        tracing::info!("QQ音乐歌单详情 {} 返回 {} 首", playlist_id, tracks.len());
        Ok(tracks)
    }

    /// 解析播放地址，返回 `orangeradio://` 自定义协议 URL
    ///
    /// 实际拉流逻辑在 Tauri 端 URI scheme handler（`apps/desktop/src-tauri/src/lib.rs`），
    /// 这里只负责把上游 CDN URL 编码到 query 里。前端 `<audio>` 直接吃 `orangeradio://...`，
    /// 不需要任何本地 HTTP 代理 / 端口。
    pub async fn resolve_to_file(&self, songmid: &str) -> Result<String> {
        let track = Track::new(
            self.id,
            songmid.to_string(),
            orange_core::track::TrackMeta::default(),
        );
        let loc = orange_core::source::AudioSource::resolve_stream(self, &track).await?;
        let url = match loc {
            orange_core::StreamLocation::Url { url, .. } => url,
            _ => return Err(orange_core::CoreError::Unsupported("不支持的流类型".into())),
        };
        // 自定义协议 URL —— handler 在 Rust runtime 拉流并回填正确的 Referer / UA
        let stream_url = format!(
            "orangeradio://localhost/qqstream?url={}&referer={}",
            urlencode(&url),
            urlencode("https://y.qq.com/"),
        );
        tracing::info!("QQ音乐取流→orangeradio:// songmid={}", songmid);
        Ok(stream_url)
    }

    /// QQ 扫码登录的三步换证流程
    pub async fn qq_qr_authorize(&self, uin: &str, ptsigx: &str) -> Result<String> {
        // 用带 cookie_store 的 session（自动管理 cookie，和 Python session 一致）
        let session = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .cookie_store(true)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        // Step 1: check_sig（session 自动存储返回的 cookies）
        let check_sig_url = format!(
            "https://ssl.ptlogin2.graph.qq.com/check_sig?uin={}&pttype=1&service=ptqrlogin&nodirect=0&ptsigx={}&s_url=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump&ptlang=2052&ptredirect=100&aid=716027609&daid=383&j_later=0&low_login_hour=0&regmaster=0&pt_login_type=3&pt_aid=0&pt_aaid=16&pt_light=0&pt_3rd_aid=100497308",
            uin, ptsigx,
        );
        let resp1 = session
            .get(&check_sig_url)
            .header("Referer", "https://xui.ptlogin2.qq.com/")
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        // p_skey 在 Set-Cookie 里，同时被 session 自动存储
        let p_skey = resp1
            .headers()
            .get_all("set-cookie")
            .iter()
            .find_map(|v| {
                let s = v.to_str().ok()?;
                if s.starts_with("p_skey=") {
                    s.split(';')
                        .next()
                        .map(|kv| kv.trim_start_matches("p_skey=").to_string())
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                tracing::error!("QQ扫码 check_sig 未返回 p_skey");
                orange_core::CoreError::AuthFailed("check_sig 未返回 p_skey".into())
            })?;
        tracing::info!("QQ扫码 check_sig 成功 p_skey={}字符", p_skey.len());

        // Step 2: oauth2.0/authorize（session 自动带 check_sig 的 cookies）
        let g_tk = hash33(&p_skey, 5381);
        let auth_time = chrono::Utc::now().timestamp() * 1000;
        let resp2 = session
            .post("https://graph.qq.com/oauth2.0/authorize")
            .header("Referer", "https://xui.ptlogin2.qq.com/")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "response_type=code&client_id=100497308&redirect_uri=https%3A%2F%2Fy.qq.com%2Fportal%2Fwx_redirect.html%3Flogin_type%3D1%26surl%3Dhttps%3A%2F%2Fy.qq.com%2F&scope=get_user_info%2Cget_app_friends&state=state&switch=&from_ptlogin=1&src=1&update_auth=1&openapi=1010_1030&g_tk={}&auth_time={}&ui={}",
                g_tk, auth_time, uuid::Uuid::new_v4(),
            ))
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        let location = resp2
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        tracing::info!(
            "QQ扫码 authorize status={} location={}",
            resp2.status(),
            &location[..location.len().min(80)]
        );
        let oauth_code = extract_param(&location, "code=", "&").ok_or_else(|| {
            orange_core::CoreError::AuthFailed("oauth authorize 未返回 code".to_string())
        })?;
        tracing::info!(
            "QQ扫码 oauth code={}",
            &oauth_code[..oauth_code.len().min(20)]
        );

        // Step 3: QQConnectLogin.LoginServer.QQLogin（直接 POST，不走 qq_post 因为还没登录）
        let payload = serde_json::json!({
            "comm": { "tmeLoginType": 2 },
            "req": {
                "module": "QQConnectLogin.LoginServer",
                "method": "QQLogin",
                "param": { "code": oauth_code }
            }
        });
        let resp3 = self
            .client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Referer", "https://y.qq.com/")
            .header(
                "User-Agent",
                "Mozilla/5.0 (iPhone; CPU iPhone OS 13_0 like Mac OS X)",
            )
            .json(&payload)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        let resp3_str = resp3.to_string();
        tracing::info!(
            "QQ扫码 QQLogin resp={}",
            crate::http_client::safe_truncate(&resp3_str, 200)
        );
        let musicid = resp3["req"]["data"]["str_musicid"]
            .as_str()
            .map(String::from)
            .or_else(|| {
                resp3["req"]["data"]["musicid"]
                    .as_i64()
                    .map(|n| n.to_string())
            })
            .unwrap_or_default();
        let musickey = resp3["req"]["data"]["musickey"].as_str().unwrap_or("");
        if musickey.is_empty() {
            return Err(orange_core::CoreError::AuthFailed(format!(
                "QQLogin 未返回 musickey, resp={}",
                crate::http_client::safe_truncate(&resp3_str, 200)
            )));
        }
        tracing::info!("QQ扫码登录成功 musicid={}", musicid);
        Ok(format!(
            "uin=o{}; qqmusic_key={}; musicid={}",
            uin, musickey, musicid
        ))
    }

    /// 解析 cookie 字符串，提取 (uin, musickey)
    fn parse_cookie_pair(cookie: &str) -> Option<(String, String)> {
        let mut uin = None;
        let mut musickey = None;
        for kv in cookie.split(';') {
            let kv = kv.trim();
            let mut parts = kv.splitn(2, '=');
            let k = parts.next().unwrap_or("").trim();
            let v = parts.next().unwrap_or("").trim();
            if k == "uin" || k == "wxuin" {
                // uin 可能是 "o123456789" 或纯数字，统一取数字部分
                let digits: String = v.chars().filter(|c| c.is_ascii_digit()).collect();
                if !digits.is_empty() {
                    uin = Some(digits);
                }
            } else if k == "qqmusic_key" || k == "qm_keyst" {
                musickey = Some(v.to_string());
            }
        }
        match (uin, musickey) {
            (Some(u), Some(m)) => Some((u, m)),
            _ => None,
        }
    }

    /// 用当前 cookie 调 QQ 续期接口换新 musickey
    ///
    /// Endpoint: `https://u6.y.qq.com/cgi-bin/musics.fcg`
    /// sign = MD5(JSON.stringify(payload))
    /// 成功 → 返回新 musickey，调用方负责把它替换回 cookie 串
    async fn refresh_musickey_inner(&self, uin: &str, musickey: &str) -> Result<String> {
        let payload = serde_json::json!({
            "req1": {
                "module": "QQConnectLogin.LoginServer",
                "method": "QQLogin",
                "param": {
                    "expired_in": 7776000,
                    "musicid": uin,
                    "musickey": musickey,
                }
            }
        });
        let payload_str = serde_json::to_string(&payload)
            .map_err(|e| orange_core::CoreError::Network(format!("payload serialize: {}", e)))?;

        // sign = MD5(payload_str)，跟 jsososo/QQMusicApi 保持一致
        let digest = md5::compute(payload_str.as_bytes());
        let sign = format!("{:x}", digest);

        let url = format!(
            "https://u6.y.qq.com/cgi-bin/musics.fcg?sign={}&format=json&inCharset=utf8&outCharset=utf-8&data={}",
            sign,
            url_encode(&payload_str)
        );

        let resp = self
            .client
            .get(&url)
            .header("Referer", "https://y.qq.com/")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(format!("refresh request: {}", e)))?;

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| orange_core::CoreError::Network(format!("refresh parse: {}", e)))?;

        let new_key = body["req1"]["data"]["musickey"]
            .as_str()
            .ok_or_else(|| {
                orange_core::CoreError::AuthFailed(format!(
                    "QQ续期未返回 musickey, body={}",
                    body.to_string().chars().take(200).collect::<String>()
                ))
            })?
            .to_string();

        Ok(new_key)
    }

    /// 完整刷新流程：取当前 cookie → 换新 musickey → 替换回 cookie → 写 AuthStore
    /// 失败返回 Err，不修改任何状态
    pub async fn refresh_and_persist(&self) -> Result<()> {
        let cur = self
            .cookie_str()
            .await
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录，无法续期".into()))?;
        let (uin, old_key) = Self::parse_cookie_pair(&cur).ok_or_else(|| {
            orange_core::CoreError::AuthFailed("cookie 缺少 uin 或 qqmusic_key".into())
        })?;

        let new_key = self.refresh_musickey_inner(&uin, &old_key).await?;

        // 替换 cookie 里的 qqmusic_key 和 qm_keyst
        let new_cookie = cur
            .split(';')
            .map(|kv| {
                let kv = kv.trim();
                let mut parts = kv.splitn(2, '=');
                let k = parts.next().unwrap_or("").trim();
                if k == "qqmusic_key" {
                    format!("qqmusic_key={}", new_key)
                } else if k == "qm_keyst" {
                    format!("qm_keyst={}", new_key)
                } else {
                    kv.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("; ");

        *self.cookie.write().await = Some(new_cookie.clone());
        // 写盘 + 更新内存缓存
        self.auth_store
            .save(AUTH_SOURCE_KEY, new_cookie.clone())
            .await?;
        tracing::info!("QQ音乐 musickey 已自动续期（uin={}）", uin);
        Ok(())
    }

    /// 后台自动续期循环：每 12 小时调一次 refresh_and_persist
    /// 失败 → 清 cookie + 标记未登录 + emit AuthExpired
    ///
    /// **必须是 async 函数**，由调用方用 `tauri::async_runtime::spawn` 提交到 runtime：
    /// ```ignore
    /// rt::spawn(async move { src.run_refresh_loop().await; });
    /// ```
    pub async fn run_refresh_loop(self: Arc<Self>) {
        // 首次等 30s 让应用先起来；之后每 12h 续期一次
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(12 * 3600));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            if self.logged_in.load(Ordering::Relaxed) {
                match self.refresh_and_persist().await {
                    Ok(()) => tracing::info!("QQ音乐 musickey 自动续期成功"),
                    Err(e) => {
                        tracing::warn!("QQ音乐 musickey 续期失败，标记未登录: {}", e);
                        *self.cookie.write().await = None;
                        self.logged_in.store(false, Ordering::Relaxed);
                        let _ = self.auth_store.clear(AUTH_SOURCE_KEY).await;
                        // emit AuthExpired 事件给前端弹 toast
                        if let Some(sink) = &self.event_sink {
                            sink.on_auth_expired(orange_core::AuthExpiredPayload {
                                source: "qqmusic".into(),
                                source_name: "QQ 音乐".into(),
                                reason: Some(format!("续期失败: {}", e)),
                            });
                        }
                    }
                }
            }
            interval.tick().await;
        }
    }
}

/// 简单 URL 编码（用于续期接口 data 参数）
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// QQ 音乐搜索响应（简化）
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct QqSearchResp {
    data: Option<QqSearchData>,
}
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct QqSearchData {
    body: Option<QqSearchBody>,
}
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct QqSearchBody {
    song: Option<QqSongList>,
}
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct QqSongList {
    list: Vec<QqSong>,
}
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct QqSong {
    songmid: String,
    songname: String,
    singer: Vec<QqSinger>,
    albumname: String,
    interval: i32, // 秒
}
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct QqSinger {
    name: String,
}

#[allow(dead_code)]
fn qq_song_to_track(s: &QqSong, source_id: SourceId) -> Track {
    let artist = s
        .singer
        .iter()
        .map(|x| x.name.as_str())
        .collect::<Vec<_>>()
        .join("/");
    let mut t = Track::new(
        source_id,
        s.songmid.clone(), // source_track_id 存 songmid
        TrackMeta {
            title: s.songname.clone(),
            artist,
            album: if s.albumname.is_empty() {
                None
            } else {
                Some(s.albumname.clone())
            },
            duration_secs: if s.interval > 0 {
                Some(s.interval as f64)
            } else {
                None
            },
            ..Default::default()
        },
    );
    t.source_kind = SourceKind::QqMusic;
    t.format = orange_core::audio_format::AudioFormat::Mp3;
    t.quality = orange_core::audio_format::Quality::High;
    t
}

#[async_trait]
impl AudioSource for QqMusicSource {
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::QqMusic
    }
    fn name(&self) -> &str {
        "QQ音乐"
    }
    fn requires_auth(&self) -> bool {
        true
    }
    fn is_ready(&self) -> bool {
        self.logged_in.load(Ordering::Relaxed)
    }

    async fn search(&self, query: &SearchQuery) -> Result<SearchResult> {
        // 正确接口：music.search.SearchCgiService.DoSearchForQQMusicMobile（对照 qqmusic-api-python）
        let searchid = format!(
            "{}{}{}",
            (chrono::Utc::now().timestamp_millis() as u64),
            rand::random::<u32>(),
            rand::random::<u32>()
        );
        let payload = serde_json::json!({
            "comm": { "ct": "19", "cv": "0", "uin": "0" },
            "req": {
                "module": "music.search.SearchCgiService",
                "method": "DoSearchForQQMusicMobile",
                "param": {
                    "searchid": searchid,
                    "query": query.keyword,
                    "search_type": 0,
                    "num_per_page": query.page_size,
                    "page_num": query.page,
                    "highlight": 1,
                    "grp": 1
                }
            }
        });
        let resp = self
            .client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Referer", "https://y.qq.com/")
            .json(&payload)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let mut tracks = Vec::new();
        // item_song 直接是数组（不是 body.song.list）
        if let Some(list) = resp["req"]["data"]["body"]["item_song"].as_array() {
            for s in list {
                let mid = s["mid"].as_str().unwrap_or("").to_string();
                if mid.is_empty() {
                    continue;
                }
                let name = s["name"].as_str().unwrap_or("").to_string();
                let singer: Vec<String> = s["singer"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|a| a["name"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let artist = singer.join("/");
                let album = s["album"]["name"]
                    .as_str()
                    .filter(|x| !x.is_empty())
                    .map(String::from);
                let interval = s["interval"].as_i64().unwrap_or(0);
                let dt = if interval > 0 {
                    Some(interval as f64)
                } else {
                    None
                };
                // 封面
                let album_mid = s["album"]["mid"].as_str().unwrap_or("");
                let artwork = if !album_mid.is_empty() {
                    Some(orange_core::track::Artwork {
                        source: orange_core::track::ArtworkSource::Url {
                            url: format!(
                                "https://y.gtimg.cn/music/photo_new/T002R300x300M000{}.jpg",
                                album_mid
                            ),
                        },
                        dominant_color: None,
                        palette: vec![],
                    })
                } else {
                    None
                };

                let mut t = Track::new(
                    self.id,
                    mid,
                    orange_core::track::TrackMeta {
                        title: name,
                        artist,
                        album,
                        duration_secs: dt,
                        artwork,
                        ..Default::default()
                    },
                );
                t.source_kind = SourceKind::QqMusic;
                t.format = orange_core::audio_format::AudioFormat::Mp3;
                t.quality = orange_core::audio_format::Quality::High;
                tracks.push(t);
            }
        }
        let total = tracks.len() as u32;
        tracing::info!("QQ音乐搜索 '{}' 返回 {} 首", query.keyword, tracks.len());
        Ok(SearchResult {
            tracks,
            total,
            has_more: false,
        })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        // 对照 qqmusic-api-python: music.vkey.GetVkey.UrlGetVkey
        let cookie = self
            .cookie
            .read()
            .await
            .clone()
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录QQ音乐".into()))?;
        // 从 cookie 提取 musicid
        let musicid = cookie
            .split(';')
            .find_map(|kv| {
                let kv = kv.trim();
                kv.strip_prefix("musicid=")
                    .map(String::from)
                    .or_else(|| kv.strip_prefix("uin=o").map(String::from))
            })
            .unwrap_or_else(|| "0".into());
        let songmid = &track.source_track_id;
        // filename 格式：M500{songmid}{songmid}.mp3（128kbps MP3）
        let filename = format!("M500{}.mp3", songmid);

        let payload = serde_json::json!({
            "comm": { "uin": musicid, "format": "json", "ct": 24, "cv": 0 },
            "req": {
                "module": "music.vkey.GetVkey",
                "method": "UrlGetVkey",
                "param": {
                    "uin": musicid,
                    "guid": "10000",
                    "songmid": [songmid],
                    "songtype": [0],
                    "filename": [filename],
                    "ctx": 0
                }
            }
        });
        let resp = self
            .client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Cookie", &cookie)
            .header("Referer", "https://y.qq.com/")
            .json(&payload)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        // 提取 purl + sip（CDN 域名）
        let info = &resp["req"]["data"]["midurlinfo"][0];
        let purl = info["purl"].as_str().unwrap_or("");
        if !purl.is_empty() {
            // CDN 域名从 sip 字段取
            let sip = resp["req"]["data"]["sip"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("https://dl.stream.qqmusic.qq.com/");
            let play_url = format!("{}{}", sip, purl);
            tracing::info!(
                "QQ音乐取流成功 songmid={} purl={} url={}",
                songmid,
                &purl[..purl.len().min(40)],
                &play_url[..play_url.len().min(80)]
            );
            return Ok(StreamLocation::Url {
                url: play_url,
                headers: vec![],
            });
        }
        tracing::warn!(
            "QQ音乐取流失败 songmid={} result={}",
            songmid,
            info["result"]
        );
        Err(orange_core::CoreError::Unsupported(
            "无法获取播放地址（可能需VIP）".into(),
        ))
    }
}

#[async_trait]
impl AuthSource for QqMusicSource {
    async fn login_with_cookie(&self, cookie: &str) -> Result<()> {
        if !cookie.contains("uin") && !cookie.contains("qqmusic_key") {
            return Err(orange_core::CoreError::AuthFailed(
                "Cookie 缺少 uin 或 qqmusic_key，请从 y.qq.com 复制完整 Cookie".into(),
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
            tracing::warn!("QQ音乐 cookie 持久化失败: {}", e);
        }
        tracing::info!("QQ音乐账号已登录（Cookie）");
        Ok(())
    }

    /// 生成 QQ 音乐扫码登录二维码
    ///
    /// 流程：GET ssl.ptlogin2.qq.com/ptqrshow → 返回二维码 PNG 图片 + Set-Cookie 里的 qrsig + pt_login_sig
    /// key 格式："qrsig|pt_login_sig"（用 | 分隔，qrcode_check 时拆开用）
    async fn qrcode_create(&self) -> Result<orange_core::QrCodeLogin> {
        // QQ音乐 QQ 扫码：appid=716027609 daid=383 pt_3rd_aid=100497308
        // （来自 qqmusic-api-python 的 _get_qq_qr 方法）
        let resp = self.client
            .get("https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&daid=383&pt_3rd_aid=100497308")
            .header("Referer", "https://xui.ptlogin2.qq.com/")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        // 从 Set-Cookie 提取 qrsig
        let set_cookies: Vec<String> = resp
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok().map(String::from))
            .collect();
        let qrsig = set_cookies
            .iter()
            .find_map(|c| {
                c.split(';')
                    .next()
                    .filter(|s| s.starts_with("qrsig="))
                    .map(|s| s.trim_start_matches("qrsig=").to_string())
            })
            .ok_or_else(|| orange_core::CoreError::AuthFailed("无法获取二维码 qrsig".into()))?;

        // 读取图片字节，转成 base64 data URI
        let img_bytes = resp
            .bytes()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&img_bytes);
        let qr_image = format!("data:image/png;base64,{}", b64);

        tracing::info!(
            "QQ音乐二维码生成成功 qrsig={} 图片{}字节",
            &qrsig[..qrsig.len().min(10)],
            img_bytes.len()
        );
        Ok(orange_core::QrCodeLogin {
            key: qrsig,
            qr_image,
        })
    }

    /// 轮询 QQ 音乐扫码状态
    ///
    /// GET ssl.ptlogin2.qq.com/ptqrLogin?...&ptqrtoken={hash33(qrsig)}&login_sig={pt_login_sig}
    /// 返回 ptuiCB('code',...) 回调：
    ///   '66' = 等待扫码, '67' = 已扫码待确认, '0' = 登录成功, '65' = 过期
    async fn qrcode_check(&self, qrsig: &str) -> Result<orange_core::QrCodeStatus> {
        let ptqrtoken = hash33(qrsig, 0);
        let ts = chrono::Utc::now().timestamp_millis();
        // 参数来自 qqmusic-api-python 的 _check_qq_qr 方法
        let url = format!(
            "https://ssl.ptlogin2.qq.com/ptqrlogin?u1=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump&ptqrtoken={}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-{}&js_ver=20102616&js_type=1&pt_uistyle=40&aid=716027609&daid=383&pt_3rd_aid=100497308&has_onekey=1",
            ptqrtoken, ts,
        );

        let resp = self
            .client
            .get(&url)
            .header("Cookie", format!("qrsig={}", qrsig))
            .header("Referer", "https://xui.ptlogin2.qq.com/")
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let body = resp
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        // 解析 ptuiCB('code', 'status', 'redirect_url', flag, 'msg', 'nickname')
        // ptuiCB 的参数用单引号包裹
        let args: Vec<&str> = body.split('\'').collect();
        if args.len() < 4 {
            tracing::info!(
                "QQ音乐扫码 body 无 ptuiCB: {}",
                &body[..body.len().min(100)]
            );
            return Ok(orange_core::QrCodeStatus::Waiting);
        }
        let code = args[1]; // 第一个引号内是 code

        tracing::info!(
            "QQ音乐扫码 code={} body={}",
            code,
            &body[..body.len().min(120)]
        );

        match code {
            "66" => Ok(orange_core::QrCodeStatus::Waiting),
            "67" => Ok(orange_core::QrCodeStatus::Scanned),
            "65" => Ok(orange_core::QrCodeStatus::Expired),
            "0" => {
                // 登录成功！ptuiCB('0','0','redirect_url','0','msg','nickname')
                // split('\'') 后：[0]prefix [1]code [2]comma [3]status [4]comma [5]redirect_url ...
                let redirect_url = args.get(5).unwrap_or(&"");
                tracing::info!(
                    "QQ音乐扫码成功 redirect={}",
                    &redirect_url[..redirect_url.len().min(100)]
                );
                // 提取 ptsigx=xxx（到下一个 & 或字符串结尾）
                let ptsigx = extract_param(redirect_url, "ptsigx=", "&")
                    .ok_or_else(|| orange_core::CoreError::AuthFailed("无法提取 ptsigx".into()))?;
                // 提取 uin=xxx
                let uin = extract_param(redirect_url, "uin=", "&")
                    .ok_or_else(|| orange_core::CoreError::AuthFailed("无法提取 uin".into()))?;
                tracing::info!("QQ音乐扫码成功 uin={} ptsigx={}字符", uin, ptsigx.len());

                // 三步换证：check_sig → oauth authorize → QQLogin
                let cookie = self.qq_qr_authorize(&uin, &ptsigx).await?;
                *self.cookie.write().await = Some(cookie.clone());
                self.logged_in.store(true, Ordering::Relaxed);
                // 加密持久化，下次启动自动恢复登录
                if let Err(e) = self.auth_store.save(AUTH_SOURCE_KEY, cookie.clone()).await {
                    tracing::warn!("QQ音乐 cookie 持久化失败: {}", e);
                }
                tracing::info!("QQ音乐扫码登录成功（三步换证完成）");
                Ok(orange_core::QrCodeStatus::Confirmed { cookie })
            }
            _ => {
                tracing::info!("QQ音乐扫码未知 code={}", code);
                Ok(orange_core::QrCodeStatus::Waiting)
            }
        }
    }

    async fn logout(&self) -> Result<()> {
        *self.cookie.write().await = None;
        self.logged_in.store(false, Ordering::Relaxed);
        if let Err(e) = self.auth_store.clear(AUTH_SOURCE_KEY).await {
            tracing::warn!("QQ音乐 cookie 清除失败: {}", e);
        }
        Ok(())
    }
}

/// URL 编码（用于代理 URL 的参数编码）
fn urlencode(s: &str) -> String {
    let mut result = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(b as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", b));
            }
        }
    }
    result
}

/// 从字符串中提取参数值：url 中 start..end 之间的内容
fn extract_param(s: &str, start: &str, end: &str) -> Option<String> {
    let si = s.find(start)?;
    let after = &s[si + start.len()..];
    let ei = after.find(end).unwrap_or(after.len());
    Some(after[..ei].to_string())
}

/// QQ 统一登录的 ptqrtoken 哈希算法（hash33）
///
/// Python 原版: e = 0; for c in s: e += (e << 5) + ord(c); return 2147483647 & e
/// 注意：Python 整数无限精度，Rust 需用 wrapping 防溢出 panic，最后取低 31 位。
fn hash33(s: &str, init: u32) -> u32 {
    let mut hash: u32 = init;
    for c in s.chars() {
        hash = hash
            .wrapping_shl(5)
            .wrapping_add(hash)
            .wrapping_add(c as u32);
    }
    hash & 0x7FFFFFFF
}

impl Default for QqMusicSource {
    /// 仅用于 trait/object 默认构造 —— 不含持久化，请通过 [`QqMusicSource::new`] 注入 AuthStore。
    fn default() -> Self {
        let tmp = std::env::temp_dir().join("orangeradio-default-auth");
        let store = AuthStore::new(tmp);
        Self::without_event_sink(store)
    }
}
