//! 网络电台音源 (RadioBrowser / Icecast / Shoutcast)
//!
//! v0.3 接入 RadioBrowser API (全球 4 万+电台)。

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::Result;

pub struct WebRadioSource {
    id: SourceId,
}

impl WebRadioSource {
    pub fn new() -> Self {
        Self { id: SourceId(uuid::Uuid::new_v4()) }
    }
}

#[async_trait]
impl AudioSource for WebRadioSource {
    fn id(&self) -> SourceId { self.id }
    fn kind(&self) -> SourceKind { SourceKind::WebRadio }
    fn name(&self) -> &str { "网络电台" }

    async fn search(&self, _query: &SearchQuery) -> Result<SearchResult> {
        Ok(SearchResult { tracks: vec![], total: 0, has_more: false })
    }

    async fn resolve_stream(&self, _track: &orange_core::track::Track) -> Result<StreamLocation> {
        Err(orange_core::CoreError::Unsupported("网络电台尚未实现 (v0.3)".into()))
    }
}

impl Default for WebRadioSource {
    fn default() -> Self { Self::new() }
}
