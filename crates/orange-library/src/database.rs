//! 本地库索引（内存实现）
//!
//! v0.2 使用内存索引，v0.3 将迁移到 SQLite 持久化。

use orange_core::source::SearchQuery;
use orange_core::track::Track;
use parking_lot::RwLock;
use std::sync::Arc;

/// 本地库（线程安全内存索引）
#[derive(Clone)]
pub struct LibraryDb {
    tracks: Arc<RwLock<Vec<Track>>>,
}

impl LibraryDb {
    pub fn new() -> Self {
        Self {
            tracks: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 替换全部曲目（扫描后写入）
    pub fn replace_all(&self, tracks: Vec<Track>) {
        let mut guard = self.tracks.write();
        *guard = tracks;
        tracing::info!("本地库已更新，共 {} 首", guard.len());
    }

    /// 追加曲目
    pub fn add(&self, track: Track) {
        self.tracks.write().push(track);
    }

    /// 全部曲目
    pub fn all(&self) -> Vec<Track> {
        self.tracks.read().clone()
    }

    /// 数量
    pub fn count(&self) -> usize {
        self.tracks.read().len()
    }

    /// 按 ID 查找
    pub fn find(&self, track_id: &orange_core::track::TrackId) -> Option<Track> {
        self.tracks.read().iter().find(|t| t.id == *track_id).cloned()
    }

    /// 按本地路径查找（source_track_id 即路径）
    pub fn find_by_path(&self, path: &str) -> Option<Track> {
        self.tracks
            .read()
            .iter()
            .find(|t| t.source_track_id == path)
            .cloned()
    }

    /// 关键词搜索（标题/艺术家/专辑）
    pub fn search(&self, query: &SearchQuery) -> Vec<Track> {
        let kw = query.keyword.to_lowercase();
        if kw.is_empty() {
            return self.all();
        }
        let guard = self.tracks.read();
        guard
            .iter()
            .filter(|t| {
                t.meta.title.to_lowercase().contains(&kw)
                    || t.meta.artist.to_lowercase().contains(&kw)
                    || t
                        .meta
                        .album
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&kw)
            })
            .skip(((query.page.saturating_sub(1)) as usize) * query.page_size as usize)
            .take(query.page_size as usize)
            .cloned()
            .collect()
    }
}

impl Default for LibraryDb {
    fn default() -> Self {
        Self::new()
    }
}
