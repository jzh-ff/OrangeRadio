//! 酷我音乐音源（kuwo.cn）
//!
//! 第三方公开接口聚合，曲库庞大（千万级），支持标准/高品/无损音质试听。
//! 无需登录或 API Key。
//!
//! ## 接入流程
//! 1. 搜索：`GET http://search.kuwo.cn/r.s?all={关键词}&ft=music&...` → JSON
//!    （`abslist[]` 含 `SONGNAME`/`ARTIST`/`DC_TARGETID` 即 rid）
//! 2. 取流（三档回退）：
//!    - 主方案 `playUrl` JSON 接口（按音质选 br：320kmp3 / 2000kflac）
//!    - 回退 1 `antiserver` 302 重定向（免 cookie）
//!    - 回退 2 镜像站 `https://flac.music.hi.cn`（带 anti-cc JS 防护，尽力尝试）
//!
//! ## 合规说明
//! 仅供学习研究，用户需自行承担使用风险。商业用途请获取正版授权。

use async_trait::async_trait;
use orange_core::audio_format::{AudioFormat, Quality};
use orange_core::source::*;
use orange_core::track::{Artwork, ArtworkSource, Track, TrackMeta};
use orange_core::Result;
use std::sync::Arc;
use std::sync::RwLock;

use crate::http_client::HttpClient;

/// 酷我音质档位
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum KuwoQuality {
    /// 标准 128k mp3
    Standard,
    /// 高品 320k mp3
    #[default]
    High,
    /// 无损 FLAC
    Lossless,
}

impl KuwoQuality {
    /// playUrl 接口的 br 参数值
    fn br_param(self) -> &'static str {
        match self {
            KuwoQuality::Standard => "128kmp3",
            KuwoQuality::High => "320kmp3",
            KuwoQuality::Lossless => "2000kflac",
        }
    }

    /// antiserver 回退接口的 format 参数（仅 mp3 可用，flac 回退到 320k）
    fn anti_format(self) -> &'static str {
        match self {
            KuwoQuality::Standard => "mp3",
            _ => "mp3",
        }
    }

    /// 对应的 Track quality 字段
    #[allow(dead_code)]
    fn track_quality(self) -> Quality {
        match self {
            KuwoQuality::Standard => Quality::Standard,
            KuwoQuality::High => Quality::High,
            KuwoQuality::Lossless => Quality::Lossless,
        }
    }

    /// 对应的 AudioFormat
    #[allow(dead_code)]
    fn audio_format(self) -> AudioFormat {
        match self {
            KuwoQuality::Lossless => AudioFormat::Flac,
            _ => AudioFormat::Mp3,
        }
    }
}

/// 酷我音乐音源
pub struct KuwoSource {
    id: SourceId,
    search_base: String,
    play_base: String,
    anti_base: String,
    /// 镜像站基址（flac.music.hi.cn，作为取流末档回退）
    mirror_base: String,
    /// 当前音质档位（可通过 set_quality 切换）
    quality: RwLock<KuwoQuality>,
    client: reqwest::Client,
    shared_client: Option<Arc<HttpClient>>,
}

impl Default for KuwoSource {
    fn default() -> Self {
        Self::new()
    }
}

impl KuwoSource {
    pub fn new() -> Self {
        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            search_base: "http://search.kuwo.cn".into(),
            play_base: "http://www.kuwo.cn".into(),
            anti_base: "https://antiserver.kuwo.cn".into(),
            mirror_base: "https://flac.music.hi.cn".into(),
            quality: RwLock::new(KuwoQuality::default()),
            client: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
                .timeout(std::time::Duration::from_secs(15))
                // 取流接口会 302 重定向，需要跟随
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()
                .unwrap_or_default(),
            shared_client: None,
        }
    }

    pub fn with_client(mut self, client: Arc<HttpClient>) -> Self {
        self.shared_client = Some(client);
        self
    }

    /// 设置音质档位（影响后续 resolve_stream 的码率选择）
    pub fn set_quality(&self, q: KuwoQuality) {
        if let Ok(mut guard) = self.quality.write() {
            *guard = q;
        }
    }

    /// 获取当前音质档位
    pub fn quality(&self) -> KuwoQuality {
        self.quality.read().map(|g| *g).unwrap_or_default()
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
            let resp = self
                .client
                .get(url)
                .headers(self.headers_from_slice(headers))
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

    fn headers_from_slice(&self, pairs: &[(&str, &str)]) -> reqwest::header::HeaderMap {
        let mut h = reqwest::header::HeaderMap::new();
        for (k, v) in pairs {
            if let Ok(name) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
                if let Ok(value) = reqwest::header::HeaderValue::from_str(v) {
                    h.insert(name, value);
                }
            }
        }
        h
    }

    /// 酷我搜索接口字段是全大写（SONGNAME/ARTIST/DC_TARGETID），做 HTML 实体反转义
    fn unescape(s: &str) -> String {
        s.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&nbsp;", " ")
            .trim()
            .to_string()
    }

    /// 尝试取流：优先 playUrl 接口（按音质选码率），失败回退 antiserver 302，再失败尝试镜像站
    async fn fetch_stream_url(&self, rid: &str) -> Result<String> {
        let quality = self.quality();
        let br = quality.br_param();

        // 主方案：playUrl JSON 接口（带 Hm cookie 模拟）
        let play_url = format!(
            "{}/api/v1/www/music/playUrl?mid={}&type=music&br={}",
            self.play_base.trim_end_matches('/'),
            rid,
            br
        );
        if let Ok(resp) = self
            .client
            .get(&play_url)
            .header("Referer", "http://www.kuwo.cn/")
            .header("csrf", "0")
            .header("Cookie", "kw_token=0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<serde_json::Value>().await {
                    if let Some(url) = v
                        .get("data")
                        .and_then(|d| d.get("url"))
                        .and_then(|u| u.as_str())
                    {
                        if !url.is_empty() {
                            return Ok(url.to_string());
                        }
                    }
                }
            }
        }

        // 回退 1：antiserver 302 重定向（responseType=url 直接返回直链文本）
        // 注意：antiserver 仅支持 mp3 格式，无损请求回退到 mp3
        let anti_url = format!(
            "{}/anti.s?responseType=url&rid=MUSIC_{}&format={}&type=convert_url3",
            self.anti_base.trim_end_matches('/'),
            rid,
            quality.anti_format()
        );
        if let Ok(resp) = self
            .client
            .get(&anti_url)
            .header("Referer", "http://www.kuwo.cn/")
            .send()
            .await
        {
            if let Ok(text) = resp.text().await {
                let url = text.trim().to_string();
                if url.starts_with("http") {
                    return Ok(url);
                }
            }
        }

        // 回退 2：镜像站 flac.music.hi.cn（对接酷我接口，带 anti-cc JS 防护）
        // 尽力尝试，失败则报错
        if let Ok(url) = self.fetch_from_mirror(rid, quality).await {
            return Ok(url);
        }

        Err(orange_core::CoreError::Network(format!(
            "酷我取流失败：rid={} 所有方案均失败（可能需要 VIP 或曲目不可用）",
            rid
        )))
    }

    /// 通过镜像站 flac.music.hi.cn 取流
    ///
    /// 该站对接酷我接口，带 anti-cc JS 跳转防护。策略：
    /// 1. 先请求播放页，解析 anti-cc JS 中的 token 拼出真实 URL
    /// 2. 带 cookie 重试获取真实播放地址
    ///
    /// 这是"尽力尝试"方案——如果 anti-cc 策略变化导致失败，不影响主流程。
    async fn fetch_from_mirror(&self, rid: &str, quality: KuwoQuality) -> Result<String> {
        let base = self.mirror_base.trim_end_matches('/');
        // 镜像站的播放接口路径（基于酷我接口封装）
        // 尝试直接获取播放 URL
        let play_url = format!(
            "{}/api/music/play?mid={}&type=music&br={}",
            base,
            rid,
            quality.br_param()
        );

        // 先尝试直接请求
        if let Ok(resp) = self
            .client
            .get(&play_url)
            .header("Referer", base)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    // 检查是否是 anti-cc 跳转页
                    if text.contains("anticc_redirect") {
                        // 解析 anti-cc token 并重试
                        if let Some(token_url) = parse_anticc_token(&text, base) {
                            if let Ok(resp2) = self
                                .client
                                .get(&token_url)
                                .header("Referer", base)
                                .header(
                                    "User-Agent",
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                                )
                                .send()
                                .await
                            {
                                if resp2.status().is_success() {
                                    if let Ok(text2) = resp2.text().await {
                                        if let Some(url) = extract_play_url(&text2) {
                                            return Ok(url);
                                        }
                                    }
                                }
                            }
                        }
                    } else if let Some(url) = extract_play_url(&text) {
                        return Ok(url);
                    }
                }
            }
        }

        // 回退：尝试镜像站的下载页接口
        let download_url = format!("{}/api/music/url?rid={}", base, rid);
        if let Ok(resp) = self
            .client
            .get(&download_url)
            .header("Referer", base)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    if !text.contains("anticc_redirect") {
                        if let Some(url) = extract_play_url(&text) {
                            return Ok(url);
                        }
                    }
                }
            }
        }

        Err(orange_core::CoreError::Network(format!(
            "镜像站取流失败：rid={}",
            rid
        )))
    }
}

#[async_trait]
impl AudioSource for KuwoSource {
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::Kuwo
    }
    fn name(&self) -> &str {
        "酷我音乐"
    }

    async fn search(&self, query: &SearchQuery) -> Result<SearchResult> {
        let kw = query.keyword.trim();
        if kw.is_empty() {
            return Ok(SearchResult {
                tracks: vec![],
                total: 0,
                has_more: false,
            });
        }
        let page_size = query.page_size.min(50);
        let url = format!(
            "{}/r.s?all={}&ft=music&itemset=newkwf_alad&issubtitle=1&pn={}&rn={}&encoding=utf8&rformat=json&ver=mbox&plat=h5",
            self.search_base.trim_end_matches('/'),
            urlencode(kw),
            query.page,
            page_size
        );
        let text = self
            .http_get_cached(&url, &[("Referer", "http://www.kuwo.cn/")], 300)
            .await?;
        // 酷我返回的 rformat=json 有时是 JS 对象字面量（单引号），统一替换为合法 JSON
        let json_text = text.replace('\'', "\"");
        let parsed: serde_json::Value = serde_json::from_str(&json_text)
            .map_err(|e| orange_core::CoreError::Network(format!("酷我搜索解析失败: {}", e)))?;
        let abslist = parsed
            .get("abslist")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut tracks = Vec::with_capacity(abslist.len());
        for item in abslist {
            // DC_TARGETID 是 rid（酷我的歌曲唯一 ID），搜索结果里也有直接叫 RID 的
            let rid = item
                .get("DC_TARGETID")
                .or_else(|| item.get("rid"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if rid.is_empty() {
                continue;
            }
            let title = item
                .get("SONGNAME")
                .or_else(|| item.get("name"))
                .and_then(|v| v.as_str())
                .map(Self::unescape)
                .unwrap_or_default();
            let artist = item
                .get("ARTIST")
                .or_else(|| item.get("artist"))
                .and_then(|v| v.as_str())
                .map(Self::unescape)
                .unwrap_or_else(|| "未知".into());
            let album = item
                .get("ALBUM")
                .or_else(|| item.get("album"))
                .and_then(|v| v.as_str())
                .map(Self::unescape);
            let duration_secs = item
                .get("DURATION")
                .or_else(|| item.get("duration"))
                .and_then(|v| {
                    v.as_str()
                        .and_then(|s| s.parse::<f64>().ok())
                        .or_else(|| v.as_f64())
                });
            let artwork = item
                .get("web_albumpic_short")
                .or_else(|| item.get("albumpic"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|u| {
                    let url = if u.starts_with("http") {
                        u.to_string()
                    } else {
                        format!("https://img1.kuwo.cn/star/albumcover/{}", u)
                    };
                    Artwork {
                        source: ArtworkSource::Url { url },
                        dominant_color: None,
                        palette: vec![],
                    }
                });

            let mut track = Track::new(
                self.id,
                rid.clone(),
                TrackMeta {
                    title,
                    artist,
                    album,
                    genre: vec![],
                    duration_secs,
                    artwork,
                    ..Default::default()
                },
            );
            track.source_kind = SourceKind::Kuwo;
            track.format = AudioFormat::Mp3;
            track.quality = Quality::High;
            tracks.push(track);
        }
        let total = parsed
            .get("TOTAL")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(tracks.len() as u32);
        Ok(SearchResult {
            tracks,
            total: total.min(1000), // 酷我返回的 TOTAL 有时虚高
            has_more: total > query.page * page_size,
        })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        let rid = &track.source_track_id;
        let url = self.fetch_stream_url(rid).await?;
        Ok(StreamLocation::Url {
            url,
            headers: vec![("Referer".into(), "http://www.kuwo.cn/".into())],
        })
    }

    async fn recommendations(&self, limit: u32) -> Result<Vec<Track>> {
        // 优先拉取酷我飙升榜；失败则退回热度搜索
        match self.chart_detail("93", limit).await {
            Ok(tracks) if !tracks.is_empty() => Ok(tracks),
            _ => self.hot_search_recommendations(limit).await,
        }
    }
}

impl KuwoSource {
    /// 热度搜索兜底（原 recommendations 实现）
    async fn hot_search_recommendations(&self, limit: u32) -> Result<Vec<Track>> {
        let url = format!(
            "{}/r.s?all=&ft=music&itemset=newkwf_alad&issubtitle=1&pn=1&rn={}&encoding=utf8&rformat=json&ver=mbox&plat=h5&orderBy=hot",
            self.search_base.trim_end_matches('/'),
            limit.clamp(30, 50)
        );
        let text = self
            .http_get_cached(&url, &[("Referer", "http://www.kuwo.cn/")], 300)
            .await?;
        let json_text = text.replace('\'', "\"");
        let parsed: serde_json::Value = serde_json::from_str(&json_text).unwrap_or_default();
        let abslist = parsed
            .get("abslist")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut tracks = Vec::new();
        for item in abslist.into_iter().take(limit as usize) {
            let rid = item
                .get("DC_TARGETID")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if rid.is_empty() {
                continue;
            }
            let title = item
                .get("SONGNAME")
                .and_then(|v| v.as_str())
                .map(Self::unescape)
                .unwrap_or_default();
            let artist = item
                .get("ARTIST")
                .and_then(|v| v.as_str())
                .map(Self::unescape)
                .unwrap_or_else(|| "未知".into());
            let mut track = Track::new(
                self.id,
                rid,
                TrackMeta {
                    title,
                    artist,
                    ..Default::default()
                },
            );
            track.source_kind = SourceKind::Kuwo;
            track.format = AudioFormat::Mp3;
            track.quality = Quality::High;
            tracks.push(track);
        }
        Ok(tracks)
    }

    /// 获取榜单歌曲（bangId 如 93=飙升榜，17=热歌榜，16=新歌榜）
    pub async fn chart_detail(&self, bang_id: &str, limit: u32) -> Result<Vec<Track>> {
        let url = format!(
            "http://www.kuwo.cn/api/www/bang/bang/musicList?bangId={}&pn=1&rn={}",
            bang_id,
            limit.clamp(30, 50)
        );
        let text = self
            .http_get_cached(
                &url,
                &[
                    ("Referer", "http://www.kuwo.cn/"),
                    ("csrf", "0"),
                    ("Cookie", "kw_token=0"),
                ],
                300,
            )
            .await?;
        let parsed: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| orange_core::CoreError::Network(format!("酷我榜单解析失败: {}", e)))?;

        let data = parsed
            .get("data")
            .and_then(|v| v.get("musicList"))
            .and_then(|v| v.as_array());
        let empty: Vec<serde_json::Value> = vec![];
        let list = data.unwrap_or(&empty);

        let mut tracks = Vec::with_capacity(list.len().min(limit as usize));
        for item in list.iter().take(limit as usize) {
            let rid = item["rid"]
                .as_i64()
                .or_else(|| item["id"].as_i64())
                .map(|i| i.to_string())
                .unwrap_or_default();
            if rid.is_empty() {
                continue;
            }
            let title = item["name"]
                .as_str()
                .map(Self::unescape)
                .unwrap_or_default();
            let artist = item["artist"]
                .as_str()
                .map(Self::unescape)
                .unwrap_or_else(|| "未知".into());
            let album = item["album"]
                .as_str()
                .map(Self::unescape)
                .filter(|s| !s.is_empty());
            let duration_secs = item["duration"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
                .or_else(|| item["duration"].as_f64());
            let artwork = item["pic"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(|url| Artwork {
                    source: ArtworkSource::Url {
                        url: url.to_string(),
                    },
                    dominant_color: None,
                    palette: vec![],
                });

            let mut track = Track::new(
                self.id,
                rid,
                TrackMeta {
                    title,
                    artist,
                    album,
                    duration_secs,
                    artwork,
                    ..Default::default()
                },
            );
            track.source_kind = SourceKind::Kuwo;
            track.format = AudioFormat::Mp3;
            track.quality = Quality::High;
            tracks.push(track);
        }
        Ok(tracks)
    }

    /// 获取歌曲歌词（移动端 songinfoandlrc 接口）
    pub async fn song_lyric(&self, rid: &str) -> Result<Option<String>> {
        let url = format!(
            "http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId={}",
            rid
        );
        let text = self
            .http_get_cached(&url, &[("Referer", "http://m.kuwo.cn/")], 300)
            .await?;
        let parsed: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| orange_core::CoreError::Network(format!("酷我歌词解析失败: {}", e)))?;

        // 响应：data.lrclist[] { lineLyric, time }
        let lrc = parsed
            .get("data")
            .and_then(|d| d.get("lrclist"))
            .and_then(|l| l.as_array())
            .map(|lines| {
                lines
                    .iter()
                    .filter_map(|line| {
                        let text = line["lineLyric"].as_str()?;
                        let time = line["time"].as_str().and_then(|s| s.parse::<f64>().ok())?;
                        let min = (time / 60.0) as i64;
                        let sec = time % 60.0;
                        Some(format!("[{:02}:{:05.2}]{}\n", min, sec, text))
                    })
                    .collect::<String>()
            });
        Ok(lrc)
    }
}

/// URL 编码（与 gequbao 共用逻辑）
fn urlencode(s: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(*b as char);
        } else {
            write!(out, "%{:02X}", b).unwrap();
        }
    }
    out
}

/// 解析 anti-cc JS 跳转页中的 token，拼出真实 URL
///
/// anti-cc 页面格式：
/// ```html
/// <html id='anticc_redirect'><body><script>
/// var cbk_var='';
/// cbk_var='31'+cbk_var; cbk_var='240'+cbk_var; ...
/// cbk_var='/?__CBK=39'+cbk_var; ...
/// window.location=cbk_defender_xxx=cbk_var;
/// </script></body></html>
/// ```
/// 需要从右到左拼接所有字符串片段，得到最终的重定向 URL。
fn parse_anticc_token(html: &str, base: &str) -> Option<String> {
    // 提取所有 cbk_var='...' 赋值中的字符串（按出现顺序）
    // 然后从右到左拼接（因为每次赋值都是 prepend）
    let mut fragments: Vec<&str> = Vec::new();
    for line in html.lines() {
        // 匹配 cbk_var='...' 或 cbk_var="..."
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("cbk_var=") {
            // 去掉分号
            let rest = rest.trim_end_matches(';').trim();
            // 提取引号内容
            if (rest.starts_with('\'') && rest.ends_with('\'') && rest.len() >= 2)
                || (rest.starts_with('"') && rest.ends_with('"') && rest.len() >= 2)
            {
                let inner = &rest[1..rest.len() - 1];
                fragments.push(inner);
            }
        }
    }

    if fragments.is_empty() {
        return None;
    }

    // 从右到左拼接（最后赋值的在 cbk_var 最前面，所以倒序拼接）
    let mut url_path = String::new();
    for frag in fragments.iter().rev() {
        url_path = format!("{}{}", frag, url_path);
    }

    // 拼接出完整 URL
    if url_path.starts_with("http") {
        Some(url_path)
    } else if url_path.starts_with('/') {
        Some(format!("{}{}", base, url_path))
    } else {
        Some(format!("{}/{}", base, url_path))
    }
}

/// 从响应文本中提取播放 URL
///
/// 支持两种格式：
/// 1. JSON：`{"data":{"url":"https://..."}}` 或 `{"url":"https://..."}`
/// 2. 纯文本 URL（antiserver 风格）
fn extract_play_url(text: &str) -> Option<String> {
    let trimmed = text.trim();

    // 尝试 JSON 解析
    if trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            // 尝试 data.url
            if let Some(url) = v
                .get("data")
                .and_then(|d| d.get("url"))
                .and_then(|u| u.as_str())
                .filter(|s| s.starts_with("http") && !s.is_empty())
            {
                return Some(url.to_string());
            }
            // 尝试顶层 url
            if let Some(url) = v
                .get("url")
                .and_then(|u| u.as_str())
                .filter(|s| s.starts_with("http") && !s.is_empty())
            {
                return Some(url.to_string());
            }
            // 尝试 data（直接是 URL 字符串）
            if let Some(url) = v
                .get("data")
                .and_then(|d| d.as_str())
                .filter(|s| s.starts_with("http") && !s.is_empty())
            {
                return Some(url.to_string());
            }
        }
    }

    // 纯文本 URL
    if trimmed.starts_with("http") && !trimmed.contains(' ') && !trimmed.contains('<') {
        return Some(trimmed.to_string());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_anticc_token() {
        let html = r#"<html id='anticc_redirect'><body><script language='javascript'>var cbk_var='';cbk_var='31'+cbk_var;cbk_var='240'+cbk_var;cbk_var='84553_'+cbk_var;cbk_var='/test?__CBK=39'+cbk_var;cbk_var='/?__C'+cbk_var;;cbk_defender_1783640168=cbk_var;cbk_var='';window.location=cbk_defender_1783640168;</script></body></html>"#;
        let url = parse_anticc_token(html, "https://flac.music.hi.cn");
        assert!(url.is_some());
        let url = url.unwrap();
        assert!(url.contains("__CBK="));
        assert!(url.starts_with("https://flac.music.hi.cn"));
    }

    #[test]
    fn test_extract_play_url_json() {
        let json = r#"{"data":{"url":"https://example.com/song.mp3"}}"#;
        assert_eq!(
            extract_play_url(json),
            Some("https://example.com/song.mp3".to_string())
        );
    }

    #[test]
    fn test_extract_play_url_text() {
        let text = "https://example.com/song.mp3";
        assert_eq!(
            extract_play_url(text),
            Some("https://example.com/song.mp3".to_string())
        );
    }

    #[test]
    fn test_extract_play_url_invalid() {
        assert_eq!(extract_play_url("not a url"), None);
        assert_eq!(extract_play_url("<html>error</html>"), None);
    }

    #[test]
    fn test_kuwo_quality_br() {
        assert_eq!(KuwoQuality::Standard.br_param(), "128kmp3");
        assert_eq!(KuwoQuality::High.br_param(), "320kmp3");
        assert_eq!(KuwoQuality::Lossless.br_param(), "2000kflac");
    }
}
