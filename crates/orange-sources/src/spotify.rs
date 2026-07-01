//! Spotify 音源 (官方 Web API)

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::Result;

pub struct SpotifySource { id: SourceId }

impl SpotifySource {
    pub fn new() -> Self { Self { id: SourceId(uuid::Uuid::new_v4()) } }
}

#[async_trait]
impl AudioSource for SpotifySource {
    fn id(&self) -> SourceId { self.id }
    fn kind(&self) -> SourceKind { SourceKind::Spotify }
    fn name(&self) -> &str { "Spotify" }
    fn requires_auth(&self) -> bool { true }
    fn is_ready(&self) -> bool { false }

    async fn search(&self, _query: &SearchQuery) -> Result<SearchResult> {
        Ok(SearchResult { tracks: vec![], total: 0, has_more: false })
    }

    async fn resolve_stream(&self, _track: &orange_core::track::Track) -> Result<StreamLocation> {
        Err(orange_core::CoreError::Unsupported("Spotify尚未实现 (v0.3)".into()))
    }
}

impl Default for SpotifySource { fn default() -> Self { Self::new() } }
