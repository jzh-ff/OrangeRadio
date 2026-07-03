//! QQ 音乐音源（用户账号 + 搜索接口）
//!
//! 搜索：QQ 音乐的 musicu.fcg 接口可免登录搜索（返回元数据）
//! 播放：获取播放 vkey 需要登录态（Cookie 含 uin + qqmusic_key）
//!
//! 设计原则同网易云：用户用自己的账号权益，不破解付费墙

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::{Track, TrackMeta};
use orange_core::Result;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct QqMusicSource {
    id: SourceId,
    client: reqwest::Client,
    cookie: Arc<RwLock<Option<String>>>,
    logged_in: Arc<AtomicBool>,
}

impl QqMusicSource {
    pub fn new() -> Self {
        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            client: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (iPhone; CPU iPhone OS 13_0 like Mac OS X)")
                .build()
                .unwrap_or_default(),
            cookie: Arc::new(RwLock::new(None)),
            logged_in: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// QQ 音乐搜索响应（简化）
#[derive(Debug, Deserialize)]
struct QqSearchResp { data: Option<QqSearchData> }
#[derive(Debug, Deserialize)]
struct QqSearchData { body: Option<QqSearchBody> }
#[derive(Debug, Deserialize)]
struct QqSearchBody { song: Option<QqSongList> }
#[derive(Debug, Deserialize)]
struct QqSongList { list: Vec<QqSong> }
#[derive(Debug, Deserialize)]
struct QqSong {
    songmid: String,
    songname: String,
    singer: Vec<QqSinger>,
    albumname: String,
    interval: i32, // 秒
}
#[derive(Debug, Deserialize)]
struct QqSinger { name: String }

fn qq_song_to_track(s: &QqSong, source_id: SourceId) -> Track {
    let artist = s.singer.iter().map(|x| x.name.as_str()).collect::<Vec<_>>().join("/");
    let mut t = Track::new(
        source_id,
        s.songmid.clone(), // source_track_id 存 songmid
        TrackMeta {
            title: s.songname.clone(),
            artist,
            album: if s.albumname.is_empty() { None } else { Some(s.albumname.clone()) },
            duration_secs: if s.interval > 0 { Some(s.interval as f64) } else { None },
            ..Default::default()
        },
    );
    t.format = orange_core::audio_format::AudioFormat::Mp3;
    t.quality = orange_core::audio_format::Quality::High;
    t
}

#[async_trait]
impl AudioSource for QqMusicSource {
    fn id(&self) -> SourceId { self.id }
    fn kind(&self) -> SourceKind { SourceKind::QqMusic }
    fn name(&self) -> &str { "QQ音乐" }
    fn requires_auth(&self) -> bool { true }
    fn is_ready(&self) -> bool { self.logged_in.load(Ordering::Relaxed) }

    async fn search(&self, query: &SearchQuery) -> Result<SearchResult> {
        // QQ 音乐搜索接口（musicu.fcg）
        let payload = serde_json::json!({
            "req_0": {
                "module": "music.searchCtrl.SearchSearchServer",
                "method": "do_search",
                "param": {
                    "query": query.keyword,
                    "page_num": query.page,
                    "num_per_page": query.page_size
                }
            }
        });
        let resp: QqSearchResp = self.client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .json(&payload)
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let songs = resp.data
            .and_then(|d| d.body)
            .and_then(|b| b.song)
            .map(|s| s.list)
            .unwrap_or_default();
        let tracks: Vec<Track> = songs.iter().map(|s| qq_song_to_track(s, self.id)).collect();
        let total = tracks.len() as u32;
        Ok(SearchResult { tracks, total, has_more: false })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        // 获取播放 vkey（需登录态）
        let cookie = self.cookie.read().await.clone()
            .ok_or_else(|| orange_core::CoreError::AuthFailed("未登录QQ音乐".into()))?;
        let url = format!(
            "https://u.y.qq.com/cgi-bin/musicu.fcg?data={{\"req_0\":{{\"module\":\"music.vkey.GetVkey\",\"method\":\"CgiGetVkey\",\"param\":{{\"songmid\":[\"{}\"],\"guid\":\"10000\",\"uin\":\"{}\"}}}}}}",
            track.source_track_id,
            &cookie
        );
        let resp = self.client.get(&url)
            .header("Cookie", &cookie)
            .header("Referer", "https://y.qq.com/")
            .send().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .text().await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        // 从响应里提取 purl
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&resp) {
            if let Some(purl) = v["req_0"]["data"]["midurlinfo"][0]["purl"].as_str() {
                if !purl.is_empty() {
                    let play_url = format!("https://dl.stream.qqmusic.qq.com/{}", purl);
                    return Ok(StreamLocation::Url { url: play_url, headers: vec![] });
                }
            }
        }
        Err(orange_core::CoreError::Unsupported("无法获取播放地址（可能需VIP）".into()))
    }
}

#[async_trait]
impl AuthSource for QqMusicSource {
    async fn login_with_cookie(&self, cookie: &str) -> Result<()> {
        if !cookie.contains("uin") && !cookie.contains("qqmusic_key") {
            return Err(orange_core::CoreError::AuthFailed(
                "Cookie 缺少 uin 或 qqmusic_key，请从 y.qq.com 复制完整 Cookie".into()
            ));
        }
        *self.cookie.write().await = Some(cookie.to_string());
        self.logged_in.store(true, Ordering::Relaxed);
        tracing::info!("QQ音乐账号已登录（Cookie）");
        Ok(())
    }

    async fn logout(&self) -> Result<()> {
        *self.cookie.write().await = None;
        self.logged_in.store(false, Ordering::Relaxed);
        Ok(())
    }
}

impl Default for QqMusicSource { fn default() -> Self { Self::new() } }
