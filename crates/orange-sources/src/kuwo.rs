//! 酷我音乐音源（kuwo.cn）
//!
//! 第三方公开接口聚合，曲库庞大（千万级），支持标准/高品音质试听。
//! 无需登录或 API Key。
//!
//! ## 接入流程
//! 1. 搜索：`GET http://search.kuwo.cn/r.s?all={关键词}&ft=music&...` → JSON
//!    （`abslist[]` 含 `SONGNAME`/`ARTIST`/`DC_TARGETID` 即 rid）
//! 2. 取流：`GET https://antiserver.kuwo.cn/anti.s?responseType=url&rid=MUSIC_{rid}&format=mp3`
//!    → 302 重定向到真实 mp3 直链（免 cookie，回退方案）
//!    或 `http://www.kuwo.cn/api/v1/www/music/playUrl?mid={rid}&type=music&br={码率}`
//!    → JSON `{data:{url}}`（需 cookie，主方案）
//!
//! ## 合规说明
//! 仅供学习研究，用户需自行承担使用风险。商业用途请获取正版授权。

use async_trait::async_trait;
use orange_core::audio_format::{AudioFormat, Quality};
use orange_core::source::*;
use orange_core::track::{Artwork, ArtworkSource, Track, TrackMeta};
use orange_core::Result;

/// 酷我音乐音源
pub struct KuwoSource {
    id: SourceId,
    search_base: String,
    play_base: String,
    anti_base: String,
    client: reqwest::Client,
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
            client: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
                .timeout(std::time::Duration::from_secs(15))
                // 取流接口会 302 重定向，需要跟随
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()
                .unwrap_or_default(),
        }
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

    /// 尝试取流：优先 playUrl 接口，失败回退 antiserver 302
    async fn fetch_stream_url(&self, rid: &str) -> Result<String> {
        // 主方案：playUrl JSON 接口（带 Hm cookie 模拟）
        let play_url = format!(
            "{}/api/v1/www/music/playUrl?mid={}&type=music&br=320kmp3",
            self.play_base.trim_end_matches('/'),
            rid
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
        // 回退：antiserver 302 重定向（responseType=url 直接返回直链文本）
        let anti_url = format!(
            "{}/anti.s?responseType=url&rid=MUSIC_{}&format=mp3&type=convert_url3",
            self.anti_base.trim_end_matches('/'),
            rid
        );
        let resp = self
            .client
            .get(&anti_url)
            .header("Referer", "http://www.kuwo.cn/")
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        let url = resp
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .trim()
            .to_string();
        if url.is_empty() || !url.starts_with("http") {
            return Err(orange_core::CoreError::Network(format!(
                "酷我取流失败：rid={} 返回非 URL",
                rid
            )));
        }
        Ok(url)
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
        let resp = self
            .client
            .get(&url)
            .header("Referer", "http://www.kuwo.cn/")
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
                "酷我搜索 HTTP {}: {}",
                status,
                &text[..text.len().min(200)]
            )));
        }
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
        // 酷我飙升榜/热歌榜（newkwf_alad 风格）
        let url = format!(
            "{}/r.s?all=&ft=music&itemset=newkwf_alad&issubtitle=1&pn=1&rn={}&encoding=utf8&rformat=json&ver=mbox&plat=h5&orderBy=hot",
            self.search_base.trim_end_matches('/'),
            limit.clamp(30, 50)
        );
        let resp = self
            .client
            .get(&url)
            .header("Referer", "http://www.kuwo.cn/")
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        let text = resp
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
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
