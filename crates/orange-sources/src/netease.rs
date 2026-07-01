//! 网易云音乐音源（第三方接口）
//!
//! v0.3 实现：账号登录、搜索、歌单、播客、音源补充。
//! 注意：依赖第三方非官方接口，存在合规与稳定性风险。

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::Result;

pub struct NeteaseSource {
    id: SourceId,
}

impl NeteaseSource {
    pub fn new() -> Self {
        Self { id: SourceId(uuid::Uuid::new_v4()) }
    }
}

#[async_trait]
impl AudioSource for NeteaseSource {
    fn id(&self) -> SourceId { self.id }
    fn kind(&self) -> SourceKind { SourceKind::NeteaseCloudMusic }
    fn name(&self) -> &str { "网易云音乐" }
    fn requires_auth(&self) -> bool { true }
    fn is_ready(&self) -> bool { false }

    async fn search(&self, _query: &SearchQuery) -> Result<SearchResult> {
        Ok(SearchResult { tracks: vec![], total: 0, has_more: false })
    }

    async fn resolve_stream(&self, _track: &orange_core::track::Track) -> Result<StreamLocation> {
        Err(orange_core::CoreError::Unsupported("网易云尚未实现 (v0.3)".into()))
    }
}

impl Default for NeteaseSource {
    fn default() -> Self { Self::new() }
}
