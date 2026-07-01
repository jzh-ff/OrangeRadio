//! QQ 音乐音源

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::Result;

pub struct QqMusicSource { id: SourceId }

impl QqMusicSource {
    pub fn new() -> Self { Self { id: SourceId(uuid::Uuid::new_v4()) } }
}

#[async_trait]
impl AudioSource for QqMusicSource {
    fn id(&self) -> SourceId { self.id }
    fn kind(&self) -> SourceKind { SourceKind::QqMusic }
    fn name(&self) -> &str { "QQ 音乐" }
    fn requires_auth(&self) -> bool { true }
    fn is_ready(&self) -> bool { false }

    async fn search(&self, _query: &SearchQuery) -> Result<SearchResult> {
        Ok(SearchResult { tracks: vec![], total: 0, has_more: false })
    }

    async fn resolve_stream(&self, _track: &orange_core::track::Track) -> Result<StreamLocation> {
        Err(orange_core::CoreError::Unsupported("QQ音乐尚未实现 (v0.3)".into()))
    }
}

impl Default for QqMusicSource { fn default() -> Self { Self::new() } }
