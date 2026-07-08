//! 播客 RSS 音源
//!
//! 播客是标准的 RSS 2.0 + iTunes 扩展。用户输入 RSS 订阅地址，
//! 我们解析 feed 获取所有 episode，每个 episode 转成 Track。
//!
//! 播客内容公开免费，无合规风险。常见播客 RSS 来源：
//! - Apple Podcasts
//! - 小宇宙（部分支持）
//! - 个人/机构自建 RSS

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::{Track, TrackMeta};
use orange_core::Result;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;

pub struct PodcastSource {
    id: SourceId,
    client: reqwest::Client,
}

impl PodcastSource {
    pub fn new() -> Self {
        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            client: reqwest::Client::builder()
                .user_agent("OrangeRadio/0.3 (Podcast)")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
        }
    }

    /// 拉取并解析 RSS feed
    pub async fn fetch_feed(&self, url: &str) -> Result<Vec<Track>> {
        let body = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        parse_rss(&body, self.id)
    }
}

/// 解析 RSS XML，提取 episode 列表
fn parse_rss(xml: &str, source_id: SourceId) -> Result<Vec<Track>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut tracks = Vec::new();

    // 当前 item 的字段
    let mut in_item = false;
    let mut current_tag = String::new();
    let mut item_fields: HashMap<String, String> = HashMap::new();
    // channel 标题（作为 album）
    let mut channel_title = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let local = name.split(':').next_back().unwrap_or(&name).to_string();

                if local == "item" {
                    in_item = true;
                    item_fields.clear();
                }
                if local == "channel" || (in_item && local != "item") {
                    current_tag = local.clone();
                }

                // enclosure 的 url 属性
                if in_item && local == "enclosure" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"url" {
                            item_fields.insert(
                                "url".into(),
                                String::from_utf8_lossy(attr.value.as_ref()).to_string(),
                            );
                        }
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let local = name.split(':').next_back().unwrap_or(&name).to_string();
                if in_item && local == "enclosure" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"url" {
                            item_fields.insert(
                                "url".into(),
                                String::from_utf8_lossy(attr.value.as_ref()).to_string(),
                            );
                        }
                    }
                }
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().map(|s| s.to_string()).unwrap_or_default();
                if !in_item && current_tag == "title" && channel_title.is_empty() {
                    channel_title = text.clone();
                }
                if in_item && !current_tag.is_empty() {
                    let entry = item_fields.entry(current_tag.clone()).or_default();
                    if entry.is_empty() {
                        *entry = text;
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let local = name.split(':').next_back().unwrap_or(&name).to_string();
                if local == "item" && in_item {
                    // 构造 Track
                    if let Some(url) = item_fields.get("url") {
                        let title = item_fields.get("title").cloned().unwrap_or_default();
                        let author = item_fields
                            .get("author")
                            .or_else(|| item_fields.get("creator"))
                            .cloned()
                            .unwrap_or_else(|| channel_title.clone());
                        let duration_secs =
                            item_fields.get("duration").and_then(|d| parse_duration(d));
                        let mut track = Track::new(
                            source_id,
                            url.clone(),
                            TrackMeta {
                                title,
                                artist: author,
                                album: Some(channel_title.clone()),
                                duration_secs,
                                ..Default::default()
                            },
                        );
                        track.format = orange_core::audio_format::AudioFormat::Mp3;
                        track.quality = orange_core::audio_format::Quality::Standard;
                        tracks.push(track);
                    }
                    in_item = false;
                    item_fields.clear();
                }
                current_tag.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(orange_core::CoreError::Internal(format!(
                    "RSS 解析错误: {e}"
                )))
            }
            _ => {}
        }
        buf.clear();
    }

    tracing::info!("播客 RSS 解析完成，共 {} 个 episode", tracks.len());
    Ok(tracks)
}

/// 解析播客时长（可能是 "3600" 秒 或 "1:02:03" 格式）
fn parse_duration(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.contains(':') {
        // HH:MM:SS 或 MM:SS
        let parts: Vec<&str> = s.split(':').collect();
        let nums: Vec<f64> = parts.iter().filter_map(|p| p.parse().ok()).collect();
        match nums.len() {
            3 => Some(nums[0] * 3600.0 + nums[1] * 60.0 + nums[2]),
            2 => Some(nums[0] * 60.0 + nums[1]),
            _ => None,
        }
    } else {
        s.parse().ok()
    }
}

#[async_trait]
impl AudioSource for PodcastSource {
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::Podcast
    }
    fn name(&self) -> &str {
        "播客"
    }

    /// 播客的 search 把 keyword 当作 RSS URL
    async fn search(&self, query: &SearchQuery) -> Result<SearchResult> {
        let url = query.keyword.trim();
        if url.is_empty() || !url.starts_with("http") {
            return Ok(SearchResult {
                tracks: vec![],
                total: 0,
                has_more: false,
            });
        }
        let tracks = self.fetch_feed(url).await?;
        let total = tracks.len() as u32;
        Ok(SearchResult {
            tracks,
            total,
            has_more: false,
        })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        Ok(StreamLocation::Url {
            url: track.source_track_id.clone(),
            headers: vec![],
        })
    }
}

impl Default for PodcastSource {
    fn default() -> Self {
        Self::new()
    }
}
