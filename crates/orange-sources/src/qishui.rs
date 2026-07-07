//! 汽水音乐音源（实验性，接口待验证）
//!
//! 当前为占位实现，后续将接入汽水音乐/抖音系接口。

use async_trait::async_trait;
use orange_core::source::*;
use orange_core::track::Track;
use orange_core::Result;
use std::sync::Arc;

use crate::auth_store::AuthStore;

pub struct QishuiSource {
    id: SourceId,
}

impl QishuiSource {
    pub fn new(_auth_store: Arc<AuthStore>) -> Self {
        Self {
            id: SourceId(uuid::Uuid::new_v4()),
        }
    }

    pub fn without_event_sink(auth_store: Arc<AuthStore>) -> Self {
        Self::new(auth_store)
    }
}

#[async_trait]
impl AudioSource for QishuiSource {
    fn id(&self) -> SourceId {
        self.id
    }
    fn kind(&self) -> SourceKind {
        SourceKind::Qishui
    }
    fn name(&self) -> &str {
        "汽水音乐"
    }

    async fn search(&self, _query: &SearchQuery) -> Result<SearchResult> {
        Ok(SearchResult {
            tracks: vec![],
            total: 0,
            has_more: false,
        })
    }

    async fn resolve_stream(&self, _track: &Track) -> Result<StreamLocation> {
        Err(orange_core::CoreError::Unsupported(
            "汽水音乐接口尚未接入".into(),
        ))
    }
}

impl Default for QishuiSource {
    fn default() -> Self {
        let tmp = std::env::temp_dir().join("orangeradio-default-auth");
        let store = AuthStore::new(tmp);
        Self::new(store)
    }
}
