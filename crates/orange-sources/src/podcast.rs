//! 播客 RSS 音源
//!
//! v0.3 接入：订阅 RSS、解析 episode、流式播放。

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::Result;

pub struct PodcastSource {
    id: SourceId,
}

impl PodcastSource {
    pub fn new() -> Self {
        Self { id: SourceId(uuid::Uuid::new_v4()) }
    }
}

#[async_trait]
impl AudioSource for PodcastSource {
    fn id(&self) -> SourceId { self.id }
    fn kind(&self) -> SourceKind { SourceKind::Podcast }
    fn name(&self) -> &str { "播客" }

    async fn search(&self, _query: &SearchQuery) -> Result<SearchResult> {
        Ok(SearchResult { tracks: vec![], total: 0, has_more: false })
    }

    async fn resolve_stream(&self, _track: &orange_core::track::Track) -> Result<StreamLocation> {
        Err(orange_core::CoreError::Unsupported("播客尚未实现 (v0.3)".into()))
    }
}

impl Default for PodcastSource {
    fn default() -> Self { Self::new() }
}
