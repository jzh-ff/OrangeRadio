//! 歌曲宝音源（gequbao.com）
//!
//! 第三方聚合音源，曲库完整、更新迅速，支持高品质/无损音质试听。
//! 无需登录或 API Key，纯 HTML 抓取。
//!
//! ## 接入流程
//! 1. 搜索：`GET /s/{URL编码的关键词}` → HTML，正则/CSS 选择器提取歌曲列表
//! 2. 详情页：`GET /music/{id}` → HTML，提取 `window.appData` 里的 `play_id`（base64）
//! 3. 取流：`POST /member/common-play-url` + `id={play_id}` → JSON `{data:{url}}` 真实 mp3 直链
//!
//! ## 合规说明
//! 本音源为第三方聚合站，实际音频来自酷我等平台。仅供学习研究，
//! 用户需自行承担使用风险。商业用途请获取正版授权。

use async_trait::async_trait;
use orange_core::audio_format::{AudioFormat, Quality};
use orange_core::source::*;
use orange_core::track::{Artwork, ArtworkSource, Track, TrackMeta};
use orange_core::Result;
use scraper::{Html, Selector};

/// 歌曲宝音源
pub struct GequbaoSource {
    id: SourceId,
    base: String,
    client: reqwest::Client,
}

impl GequbaoSource {
    pub fn new() -> Self {
        Self {
            id: SourceId(uuid::Uuid::new_v4()),
            base: "https://www.gequbao.com".into(),
            client: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
        }
    }

    /// 从搜索结果 HTML 提取歌曲列表
    fn parse_search_html(&self, html: &str, keyword: &str) -> Vec<Track> {
        let document = Html::parse_document(html);
        // 每首歌在 .border-top 行里，链接是 a[href^="/music/"]
        let link_sel = Selector::parse("a[href*=\"/music/\"]").unwrap();
        let title_sel = Selector::parse(".text-primary").unwrap();
        let artist_sel = Selector::parse(".text-jade").unwrap();

        let mut tracks: Vec<Track> = Vec::new();
        let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

        for link in document.select(&link_sel) {
            let href = link.value().attr("href").unwrap_or("");
            // 提取 music/{id}，过滤重复（每首歌在 HTML 里出现两次：标题链接 + 播放按钮）
            let song_path = if let Some(p) = href.strip_prefix("/music/") {
                format!("music/{}", p.trim_end_matches('/'))
            } else {
                continue;
            };
            if !song_path.starts_with("music/") || seen_ids.contains(&song_path) {
                continue;
            }

            // 在链接内找标题（.text-primary span）
            let title = link
                .select(&title_sel)
                .next()
                .map(|e| e.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty());
            let Some(title) = title else { continue };

            // 同行找歌手（.text-jade small）
            let artist = link
                .select(&artist_sel)
                .next()
                .map(|e| e.text().collect::<String>().trim().to_string())
                .unwrap_or_else(|| "未知".into());

            seen_ids.insert(song_path.clone());
            let mut track = Track::new(
                self.id,
                song_path,
                TrackMeta {
                    title,
                    artist,
                    album: None,
                    genre: vec![],
                    duration_secs: None,
                    artwork: None,
                    ..Default::default()
                },
            );
            track.source_kind = SourceKind::Gequbao;
            track.format = AudioFormat::Mp3;
            track.quality = Quality::High;
            let _ = keyword; // 关键字仅用于日志
            tracks.push(track);
        }
        tracks
    }

    /// 请求详情页，提取 appData 里的 play_id 和元数据（封面/歌词）
    async fn fetch_detail(&self, song_path: &str) -> Result<DetailInfo> {
        let url = format!("{}/{}", self.base.trim_end_matches('/'), song_path);
        let resp = self
            .client
            .get(&url)
            .header("Referer", &self.base)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        let status = resp.status();
        let html = resp
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(orange_core::CoreError::Network(format!(
                "歌曲宝详情页 HTTP {}: {}",
                status,
                &html[..html.len().min(200)]
            )));
        }
        parse_detail(&html)
    }

    /// 用 play_id 换真实 mp3 直链
    async fn resolve_play_url(&self, play_id: &str, referer: &str) -> Result<String> {
        let url = format!("{}/member/common-play-url", self.base.trim_end_matches('/'));
        let resp = self
            .client
            .post(&url)
            .header("Referer", referer)
            .header("X-Requested-With", "XMLHttpRequest")
            .form(&[("id", play_id)])
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
                "歌曲宝取流 HTTP {}: {}",
                status,
                &text[..text.len().min(200)]
            )));
        }
        let v: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| orange_core::CoreError::AiService(format!("解析歌曲宝取流响应失败: {e}")))?;
        let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        if code != 1 {
            let msg = v
                .get("msg")
                .and_then(|m| m.as_str())
                .unwrap_or("取流失败");
            return Err(orange_core::CoreError::AiService(format!(
                "歌曲宝取流错误 [code={code}]: {msg}"
            )));
        }
        let mp3_url = v
            .get("data")
            .and_then(|d| d.get("url"))
            .and_then(|u| u.as_str())
            .ok_or_else(|| {
                orange_core::CoreError::AiService("歌曲宝取流响应缺少 url".into())
            })?
            .to_string();
        Ok(mp3_url)
    }
}

/// 详情页解析结果
#[derive(Debug, Clone)]
struct DetailInfo {
    play_id: String,
    cover: Option<String>,
    lyrics: Option<String>,
}

/// 从详情页 HTML 提取 play_id 和元数据
///
/// 页面里有 `window.appData = JSON.parse('{...}')`，里面包含 play_id（base64）、
/// mp3_cover、mp3_duration 等。用正则抠出 JSON 再解析。
fn parse_detail(html: &str) -> Result<DetailInfo> {
    // 抠 appData JSON
    let marker = "window.appData = JSON.parse('";
    let Some(start_idx) = html.find(marker) else {
        return Err(orange_core::CoreError::AiService(
            "歌曲宝详情页缺少 appData".into(),
        ));
    };
    let json_start = start_idx + marker.len();
    let json_str = &html[json_start..];
    let Some(end_rel) = json_str.find("');") else {
        return Err(orange_core::CoreError::AiService(
            "歌曲宝 appData 未闭合".into(),
        ));
    };
    let raw = &json_str[..end_rel];
    // 反转义 \uXXXX 和 \/
    let unescaped = unicode_unescape(raw);
    let v: serde_json::Value = serde_json::from_str(&unescaped).map_err(|e| {
        orange_core::CoreError::AiService(format!("解析歌曲宝 appData JSON 失败: {e}"))
    })?;

    let play_id = v
        .get("play_id")
        .and_then(|p| p.as_str())
        .ok_or_else(|| orange_core::CoreError::AiService("appData 缺少 play_id".into()))?
        .to_string();
    let cover = v
        .get("mp3_cover")
        .and_then(|c| c.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let lyrics = v
        .get("mp3_lrc")
        .and_then(|l| l.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    Ok(DetailInfo {
        play_id,
        cover,
        lyrics,
    })
}

/// 反转义 JSON 字符串里的 \uXXXX 和 \/ 序列（appData 用的是 JS 字面量转义）
fn unicode_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('/') => out.push('/'),
                Some('u') => {
                    let mut hex = String::with_capacity(4);
                    for _ in 0..4 {
                        if let Some(h) = chars.next() {
                            hex.push(h);
                        }
                    }
                    if let Ok(code) = u32::from_str_radix(&hex, 16) {
                        if let Some(ch) = char::from_u32(code) {
                            out.push(ch);
                        }
                    }
                }
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\'') => out.push('\''),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[async_trait]
impl AudioSource for GequbaoSource {
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::Gequbao
    }
    fn name(&self) -> &str {
        "歌曲宝"
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
        let url = format!("{}/s/{}", self.base.trim_end_matches('/'), urlencode(kw));
        let resp = self
            .client
            .get(&url)
            .header("Referer", &self.base)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        let status = resp.status();
        let html = resp
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(orange_core::CoreError::Network(format!(
                "歌曲宝搜索 HTTP {}: {}",
                status,
                &html[..html.len().min(200)]
            )));
        }
        let tracks = self.parse_search_html(&html, kw);
        let total = tracks.len() as u32;
        Ok(SearchResult {
            tracks,
            total,
            has_more: total >= query.page_size,
        })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        let song_path = &track.source_track_id;
        let detail = self.fetch_detail(song_path).await?;
        let referer = format!("{}/{}", self.base.trim_end_matches('/'), song_path);
        let mp3_url = self.resolve_play_url(&detail.play_id, &referer).await?;
        Ok(StreamLocation::Url {
            url: mp3_url,
            headers: vec![],
        })
    }

    async fn recommendations(&self, limit: u32) -> Result<Vec<Track>> {
        // 用首页 /hot-music 抓推荐
        let url = format!("{}/hot-music", self.base.trim_end_matches('/'));
        let resp = self
            .client
            .get(&url)
            .header("Referer", &self.base)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        let html = resp
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        let mut tracks = self.parse_search_html(&html, "");
        tracks.truncate(limit as usize);
        Ok(tracks)
    }
}

impl Default for GequbaoSource {
    fn default() -> Self {
        Self::new()
    }
}

/// 简易 URL 编码（与 web_radio 一致）
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

/// 给已构造的 Track 补充详情页元数据（封面 / 歌词），供 IPC 层调用
pub async fn enrich_track_detail(
    source: &GequbaoSource,
    track: &mut Track,
) -> Result<()> {
    let detail = source.fetch_detail(&track.source_track_id).await?;
    if let Some(cover) = detail.cover {
        track.meta.artwork = Some(Artwork {
            source: ArtworkSource::Url { url: cover },
            dominant_color: None,
            palette: vec![],
        });
    }
    if let Some(lrc) = detail.lyrics {
        track.meta.lyrics = Some(lrc);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unicode_unescape() {
        let input = r#"\u56ed\u6e38\u4f1a"#;
        assert_eq!(unicode_unescape(input), "园游会");
    }

    #[test]
    fn test_parse_detail_minimal() {
        let html = r#"<script>window.appData = JSON.parse('{"play_id":"abc123","mp3_cover":"http://x.com/cover.jpg","mp3_lrc":""}');</script>"#;
        let info = parse_detail(html).unwrap();
        assert_eq!(info.play_id, "abc123");
        assert_eq!(info.cover.as_deref(), Some("http://x.com/cover.jpg"));
        assert!(info.lyrics.is_none());
    }
}
