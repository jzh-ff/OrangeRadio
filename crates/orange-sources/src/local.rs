//! 本地音乐库音源

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::Track;
use orange_core::Result;

pub struct LocalSource {
    id: SourceId,
}

impl LocalSource {
    pub fn new() -> Self {
        Self {
            id: SourceId(uuid::Uuid::new_v4()),
        }
    }
}

#[async_trait]
impl AudioSource for LocalSource {
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::Local
    }
    fn name(&self) -> &str {
        "本地音乐"
    }

    async fn search(&self, _query: &SearchQuery) -> Result<SearchResult> {
        Ok(SearchResult {
            tracks: vec![],
            total: 0,
            has_more: false,
        })
    }

    async fn resolve_stream(&self, track: &Track) -> Result<StreamLocation> {
        Ok(StreamLocation::File {
            path: track.source_track_id.clone(),
        })
    }
}

impl Default for LocalSource {
    fn default() -> Self {
        Self::new()
    }
}
