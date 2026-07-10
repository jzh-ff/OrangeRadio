//! 网络电台音源（RadioBrowser API）
//!
//! RadioBrowser 是全球最大的免费网络电台目录（4 万+ 电台）。
//! API 文档：https://api.radio-browser.info
//! 无需 API Key，公开免费。
//!
//! 流程：搜索电台 → 电台的 url_resolved 直接是可播放流地址（前端 <audio> 可加载）。

use async_trait::async_trait;
use orange_core::audio_format::{AudioFormat, Quality};
use orange_core::source::*;
use orange_core::track::{Artwork, ArtworkSource, Track, TrackMeta};
use orange_core::Result;
use serde::Deserialize;
use std::sync::Arc;

use crate::http_client::HttpClient;

/// RadioBrowser 单个电台（API 返回）
#[derive(Debug, Deserialize)]
struct RadioStation {
    #[allow(dead_code)]
    stationuuid: String,
    name: String,
    url_resolved: String,
    favicon: String,
    country: String,
    #[allow(dead_code)]
    countrycode: String,
    tags: String,
    #[allow(dead_code)]
    votes: i64,
    codec: String,
    bitrate: i32,
}

pub struct WebRadioSource {
    id: SourceId,
    api_base: String,
    client: reqwest::Client,
    shared_client: Option<Arc<HttpClient>>,
}

impl WebRadioSource {
    pub fn new() -> Self {
        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            // RadioBrowser 有多个镜像，默认用 de1
            api_base: "https://de1.api.radio-browser.info".into(),
            client: reqwest::Client::builder()
                .user_agent("OrangeRadio/0.3")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
            shared_client: None,
        }
    }

    pub fn with_client(mut self, client: Arc<HttpClient>) -> Self {
        self.shared_client = Some(client);
        self
    }

    /// 优先使用共享 HttpClient 的 TTL 缓存 GET；未注入时回退到私有 client。
    async fn cached_get(&self, url: &str, headers: &[(&str, &str)]) -> Result<String> {
        if let Some(client) = &self.shared_client {
            client.get_cached(url, headers, 300).await
        } else {
            self.client
                .get(url)
                .headers(header_map(headers))
                .send()
                .await
                .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
                .text()
                .await
                .map_err(|e| orange_core::CoreError::Network(e.to_string()))
        }
    }

    /// 把 RadioBrowser 电台转成 Track
    fn to_track(&self, st: &RadioStation) -> Track {
        let mut track = Track::new(
            self.id,
            st.url_resolved.clone(),
            TrackMeta {
                title: st.name.clone(),
                artist: if st.country.is_empty() {
                    "网络电台".into()
                } else {
                    format!("🇫🇷 {}", st.country) // 国家用国旗占位
                },
                album: Some(
                    st.tags
                        .split(',')
                        .next()
                        .filter(|s| !s.is_empty())
                        .unwrap_or("LIVE")
                        .to_string(),
                ),
                genre: st
                    .tags
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
                duration_secs: None, // 直播流无固定时长
                artwork: if st.favicon.is_empty() {
                    None
                } else {
                    Some(Artwork {
                        source: ArtworkSource::Url {
                            url: st.favicon.clone(),
                        },
                        dominant_color: None,
                        palette: vec![],
                    })
                },
                ..Default::default()
            },
        );
        // 显式标记电台来源（前端靠 source_kind 区分电台/单曲队列；否则 Track::new 默认 Local，会导致隔离失效）
        track.source_kind = SourceKind::WebRadio;
        track.format = match st.codec.to_uppercase().as_str() {
            "MP3" => AudioFormat::Mp3,
            "AAC" => AudioFormat::Aac,
            "OGG" | "OGG/OPUS" => AudioFormat::Ogg,
            _ => AudioFormat::Mp3,
        };
        track.quality = if st.bitrate >= 256 {
            Quality::High
        } else {
            Quality::Standard
        };
        track
    }
}

#[async_trait]
impl AudioSource for WebRadioSource {
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::WebRadio
    }
    fn name(&self) -> &str {
        "网络电台"
    }

    async fn search(&self, query: &SearchQuery) -> Result<SearchResult> {
        let kw = query.keyword.trim();
        let limit = query.page_size.min(100);
        let url = if kw.is_empty() {
            format!(
                "{}/json/stations/topclick/{}?limit={}&order=votes&reverse=true",
                self.api_base, limit, limit
            )
        } else {
            format!(
                "{}/json/stations/byname/{}?limit={}&order=votes&reverse=true",
                self.api_base,
                urlencode(kw),
                limit
            )
        };

        let body = self.cached_get(&url, &[]).await?;
        let stations: Vec<RadioStation> = serde_json::from_str(&body)
            .map_err(|e| orange_core::CoreError::Network(format!("JSON 解析失败: {e}")))?;

        let tracks: Vec<Track> = stations.iter().map(|s| self.to_track(s)).collect();
        let total = tracks.len() as u32;
        Ok(SearchResult {
            tracks,
            total,
            has_more: total >= limit,
        })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        Ok(StreamLocation::Url {
            url: track.source_track_id.clone(),
            headers: vec![],
        })
    }

    async fn recommendations(&self, limit: u32) -> Result<Vec<Track>> {
        let url = format!(
            "{}/json/stations/topclick/{}?limit={}&order=votes&reverse=true",
            self.api_base, limit, limit
        );
        let body = self.cached_get(&url, &[]).await?;
        let stations: Vec<RadioStation> = serde_json::from_str(&body)
            .map_err(|e| orange_core::CoreError::Network(format!("JSON 解析失败: {e}")))?;
        Ok(stations.iter().map(|s| self.to_track(s)).collect())
    }
}

impl Default for WebRadioSource {
    fn default() -> Self {
        Self::new()
    }
}

/// 简易 URL 编码
fn urlencode(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}

fn header_map(headers: &[(&str, &str)]) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let mut map = HeaderMap::new();
    for (k, v) in headers {
        if let Ok(name) = HeaderName::from_bytes(k.as_bytes()) {
            if let Ok(value) = HeaderValue::from_str(v) {
                map.insert(name, value);
            }
        }
    }
    map
}
