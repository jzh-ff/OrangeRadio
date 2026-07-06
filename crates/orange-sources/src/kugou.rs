//! 酷狗音乐音源（实验性）
//!
//! 设计原则：
//! - 用户绑定自己的账号（Cookie）以播放 VIP/高音质内容；未登录时仅播放免费试听/非版权受限曲目。
//! - 接口基于酷狗网页端公开端点，可能因风控变动而失效。
//!
//! 当前实现：
//! - 搜索：complexsearch.kugou.com/v2/search/song（需要 signature）
//! - 播放：wwwapi.kugou.com/yy/index.php?r=play/getdata（通过 hash 取直链）
//! - 登录：优先 Cookie 导入（kg_mid / token 等），未实现二维码。

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::{Artwork, ArtworkSource, Track, TrackMeta};
use orange_core::Result;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::auth_store::AuthStore;

const SEARCH_BASE: &str = "https://complexsearch.kugou.com/v2/search/song";
const PLAY_BASE: &str = "https://wwwapi.kugou.com/yy/index.php?r=play/getdata";
const AUTH_SOURCE_KEY: &str = "kugou";
const SIGN_MAGIC: &str = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";

pub struct KugouSource {
    id: SourceId,
    client: reqwest::Client,
    /// 酷狗设备 mid（可随机生成，用于签名/请求）
    mid: String,
    /// 用户登录 cookie（可选；VIP 内容需要）
    cookie: Arc<RwLock<Option<String>>>,
    /// 是否已登录
    logged_in: Arc<AtomicBool>,
    /// 加密持久化存储
    auth_store: Arc<AuthStore>,
}

impl KugouSource {
    pub fn new(auth_store: Arc<AuthStore>) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();

        // 启动时尝试从 AuthStore 恢复登录态
        let (initial_cookie, already_logged_in) = match auth_store.get_sync(AUTH_SOURCE_KEY) {
            Some(auth) if !auth.cookie.is_empty() => {
                tracing::info!("酷狗从 AuthStore 恢复登录态");
                (Some(auth.cookie), true)
            }
            _ => (None, false),
        };

        let mid = initial_cookie
            .as_ref()
            .and_then(|c| {
                c.split(';')
                    .find(|s| s.trim().starts_with("kg_mid="))
                    .map(|s| s.trim()[7..].to_string())
            })
            .unwrap_or_else(|| generate_mid());

        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            client,
            mid,
            cookie: Arc::new(RwLock::new(initial_cookie)),
            logged_in: Arc::new(AtomicBool::new(already_logged_in)),
            auth_store,
        }
    }

    /// 不带持久化的默认构造（用于 trait 默认 / 测试）
    pub fn without_event_sink(auth_store: Arc<AuthStore>) -> Self {
        Self::new(auth_store)
    }

    async fn cookie_str(&self) -> Option<String> {
        self.cookie.read().await.clone()
    }

    /// 构造酷狗签名（常见网页端签名算法）
    /// 1. 参数放入 BTreeMap 按 key 排序
    /// 2. 拼接成 key=value 字符串
    /// 3. 前后加 SIGN_MAGIC，做 MD5
    fn sign(params: &BTreeMap<&str, String>) -> String {
        let mut s = SIGN_MAGIC.to_string();
        for (k, v) in params {
            s.push_str(k);
            s.push_str(v);
        }
        s.push_str(SIGN_MAGIC);
        format!("{:x}", md5::compute(s))
    }

    /// 搜索歌曲
    ///
    /// 返回 (hash, songname, singername, album_name, album_id, duration)
    async fn search_raw(&self,
        query: &SearchQuery,
    ) -> Result<Vec<KugouSearchItem>> {
        let time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string();
        let keyword = query.keyword.clone();
        let page = query.page.max(1).to_string();
        let pagesize = query.page_size.min(30).max(1).to_string();

        let mut params: BTreeMap<&str, String> = BTreeMap::new();
        params.insert("srcappid", "2919".into());
        params.insert("clientver", "20000".into());
        params.insert("clienttime", time.clone());
        params.insert("mid", self.mid.clone());
        params.insert("uuid", self.mid.clone());
        params.insert("dfid", "".into());
        params.insert("keyword", keyword);
        params.insert("page", page);
        params.insert("pagesize", pagesize);
        params.insert("bitrate", "0".into());
        params.insert("isfuzzy", "0".into());
        params.insert("inputtype", "0".into());
        params.insert("platform", "WebFilter".into());
        params.insert("userid", "-1".into());

        let signature = Self::sign(&params);
        params.insert("signature", signature);

        let url = format!(
            "{}?{}",
            SEARCH_BASE,
            params
                .iter()
                .map(|(k, v)| format!("{}={}", urlencoding(k), urlencoding(v)))
                .collect::<Vec<_>>()
                .join("&")
        );

        let mut req = self.client.get(&url)
            .header("Referer", "https://www.kugou.com/")
            .header("Origin", "https://www.kugou.com");
        if let Some(c) = self.cookie_str().await {
            req = req.header("Cookie", c);
        }

        let text = req
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        // 接口可能返回 JSONP：jQueryxxx({...})
        let json_text = strip_jsonp_callback(&text);
        let resp: KugouSearchResp = serde_json::from_str(json_text)
            .map_err(|e| orange_core::CoreError::Network(format!("酷狗搜索解析失败: {} body={}", e, &text[..text.len().min(200)])))?;

        if resp.err_code != 0 {
            return Err(orange_core::CoreError::Network(format!(
                "酷狗搜索失败: err_code={} ({})",
                resp.err_code,
                resp.error.as_deref().unwrap_or("")
            )));
        }

        Ok(resp.data.as_ref().and_then(|d| d.lists.clone()).unwrap_or_default())
    }

    /// 通过 hash 获取播放 URL
    async fn resolve_by_hash(&self,
        hash: &str,
        album_id: Option<&str>,
    ) -> Result<String> {
        let time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut params: BTreeMap<&str, String> = BTreeMap::new();
        params.insert("r", "play/getdata".into());
        params.insert("hash", hash.into());
        params.insert("dfid", "".into());
        params.insert("mid", self.mid.clone());
        params.insert("platid", "4".into());
        params.insert("_", time.to_string());
        if let Some(aid) = album_id {
            params.insert("album_id", aid.into());
        }

        let url = format!(
            "{}?{}",
            PLAY_BASE,
            params
                .iter()
                .map(|(k, v)| format!("{}={}", urlencoding(k), urlencoding(v)))
                .collect::<Vec<_>>()
                .join("&")
        );

        let mut req = self.client.get(&url)
            .header("Referer", "https://www.kugou.com/")
            .header("Origin", "https://www.kugou.com");
        if let Some(c) = self.cookie_str().await {
            req = req.header("Cookie", c);
        }

        let text = req
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let json_text = strip_jsonp_callback(&text);
        let resp: KugouPlayResp = serde_json::from_str(json_text)
            .map_err(|e| orange_core::CoreError::Network(format!("酷狗播放解析失败: {} body={}", e, &text[..text.len().min(200)])))?;

        if resp.err_code != 0 {
            return Err(orange_core::CoreError::Unsupported(format!(
                "酷狗无法获取播放地址: err_code={}",
                resp.err_code
            )));
        }

        let url = resp
            .data
            .as_ref()
            .and_then(|d| d.play_url.as_deref())
            .filter(|u| !u.is_empty())
            .ok_or_else(|| orange_core::CoreError::Unsupported("酷狗返回空播放地址".into()))?
            .to_string();

        Ok(url)
    }
}

#[async_trait]
impl AudioSource for KugouSource {
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::Kugou
    }
    fn name(&self) -> &str {
        "酷狗音乐"
    }

    async fn search(&self,
        query: &SearchQuery,
    ) -> Result<SearchResult> {
        let items = self.search_raw(query).await?;
        let tracks: Vec<Track> = items
            .iter()
            .map(|item| item_to_track(item, self.id))
            .collect();
        let total = tracks.len() as u32;
        Ok(SearchResult {
            tracks,
            total,
            has_more: false,
        })
    }

    async fn resolve_stream(&self,
        track: &Track,
    ) -> Result<StreamLocation> {
        // source_track_id 格式：hash|album_id（管道符分隔，album_id 可选）
        let parts: Vec<&str> = track.source_track_id.split('|').collect();
        let hash = parts.first().copied().unwrap_or("")
            .trim();
        if hash.is_empty() {
            return Err(orange_core::CoreError::Unsupported("酷狗歌曲缺少 hash".into()));
        }
        let album_id = parts.get(1).copied();
        let url = self.resolve_by_hash(hash, album_id).await?;
        Ok(StreamLocation::Url { url, headers: vec![] })
    }
}

#[async_trait]
impl AuthSource for KugouSource {
    async fn login_with_cookie(&self,
        cookie: &str,
    ) -> Result<()> {
        *self.cookie.write().await = Some(cookie.to_string());
        self.logged_in.store(true, Ordering::Relaxed);
        if let Err(e) = self.auth_store.save(AUTH_SOURCE_KEY, cookie.to_string()).await {
            tracing::warn!("酷狗 cookie 持久化失败: {}", e);
        }
        Ok(())
    }

    async fn logout(&self) -> Result<()> {
        *self.cookie.write().await = None;
        self.logged_in.store(false, Ordering::Relaxed);
        if let Err(e) = self.auth_store.clear(AUTH_SOURCE_KEY).await {
            tracing::warn!("酷狗 cookie 清除失败: {}", e);
        }
        Ok(())
    }

    async fn current_user(&self) -> Result<Option<UserInfo>> {
        if self.logged_in.load(Ordering::Relaxed) {
            Ok(Some(UserInfo {
                uid: "已登录".into(),
                nickname: "酷狗用户".into(),
                avatar_url: None,
                vip: false,
            }))
        } else {
            Ok(None)
        }
    }
}

impl Default for KugouSource {
    fn default() -> Self {
        let tmp = std::env::temp_dir().join("orangeradio-default-auth");
        let store = AuthStore::new(tmp);
        Self::new(store)
    }
}

/// 生成 32 位小写 mid（MD5 风格）
fn generate_mid() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// URL 编码（用于 query string）
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

/// 去掉 JSONP 回调包裹，如 jQuery123({...}) 或 {...}
fn strip_jsonp_callback(text: &str) -> &str {
    let t = text.trim();
    if let Some(start) = t.find('(') {
        if t.ends_with(')') {
            return &t[start + 1..t.len() - 1];
        }
    }
    t
}

#[derive(Debug, Deserialize, Clone)]
struct KugouSearchResp {
    #[serde(rename = "errcode")]
    err_code: i32,
    error: Option<String>,
    data: Option<KugouSearchData>,
}

#[derive(Debug, Deserialize, Clone)]
struct KugouSearchData {
    lists: Option<Vec<KugouSearchItem>>,
}

#[derive(Debug, Deserialize, Clone)]
struct KugouSearchItem {
    #[serde(default, rename = "FileHash")]
    file_hash: Option<String>,
    #[serde(default, rename = "SongName")]
    song_name: Option<String>,
    #[serde(default, rename = "SingerName")]
    singer_name: Option<String>,
    #[serde(default, rename = "AlbumName")]
    album_name: Option<String>,
    #[serde(default, rename = "AlbumID")]
    album_id: Option<String>,
    #[serde(default, rename = "Duration")]
    duration: Option<u64>,
    #[serde(default, rename = "Img")]
    img: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct KugouPlayResp {
    #[serde(rename = "errcode")]
    err_code: i32,
    data: Option<KugouPlayData>,
}

#[derive(Debug, Deserialize, Clone)]
struct KugouPlayData {
    play_url: Option<String>,
}

fn item_to_track(item: &KugouSearchItem, source_id: SourceId) -> Track {
    let hash = item.file_hash.clone().unwrap_or_default();
    let album_id = item.album_id.clone().unwrap_or_default();
    // source_track_id 用 hash|album_id 拼接，便于 resolve_stream 拆分
    let source_track_id = if album_id.is_empty() {
        hash.clone()
    } else {
        format!("{}|{}", hash, album_id)
    };

    let title = item.song_name.clone().unwrap_or("未知歌曲".into());
    let artist = item.singer_name.clone().unwrap_or("未知艺术家".into());
    let album = item.album_name.clone().filter(|s| !s.is_empty());
    let duration_secs = item.duration.map(|d| d as f64);

    let artwork = item.img.clone().filter(|u| !u.is_empty()).map(|url| Artwork {
        source: ArtworkSource::Url { url },
        dominant_color: None,
        palette: vec![],
    });

    let mut t = Track::new(
        source_id,
        source_track_id,
        TrackMeta {
            title,
            artist,
            album,
            duration_secs,
            artwork,
            ..Default::default()
        },
    );
    t.source_kind = SourceKind::Kugou;
    t.format = orange_core::audio_format::AudioFormat::Mp3;
    t.quality = orange_core::audio_format::Quality::High;
    t
}
