//! 本地库索引（内存 + SQLite 持久化）
//!
//! 双层设计：
//! - 内存层 `Arc<RwLock<Vec<Track>>>`：快速搜索/读取
//! - SQLite 层：持久化，启动时加载到内存（秒开，无需重扫）
//!
//! 数据库位置：`<工作目录>/.orangeradio/library.sqlite`

use orange_core::source::SearchQuery;
use orange_core::track::Track;
use parking_lot::RwLock;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 本地库（线程安全，内存索引 + SQLite 持久化）
#[derive(Clone)]
pub struct LibraryDb {
    tracks: Arc<RwLock<Vec<Track>>>,
    db_path: Option<Arc<PathBuf>>,
}

impl LibraryDb {
    /// 创建纯内存库（无持久化，用于测试）
    pub fn new() -> Self {
        Self {
            tracks: Arc::new(RwLock::new(Vec::new())),
            db_path: None,
        }
    }

    /// 打开 SQLite 持久化库，加载已保存曲目到内存
    pub fn open(path: impl AsRef<Path>) -> orange_core::Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path).map_err(sqlite_err)?;
        init_schema(&conn)?;
        let tracks = load_tracks(&conn)?;
        tracing::info!("已加载本地库缓存 {} 首（SQLite）", tracks.len());
        Ok(Self {
            tracks: Arc::new(RwLock::new(tracks)),
            db_path: Some(Arc::new(path)),
        })
    }

    /// 替换全部曲目（扫描后写入内存 + SQLite）
    pub fn replace_all(&self, tracks: Vec<Track>) {
        if let Err(e) = self.persist(&tracks) {
            tracing::warn!("写入 SQLite 失败: {}", e);
        }
        let mut guard = self.tracks.write();
        *guard = tracks;
        tracing::info!("本地库已更新，共 {} 首", guard.len());
    }

    /// 追加曲目
    pub fn add(&self, track: Track) {
        let mut all = self.all();
        all.push(track.clone());
        if let Err(e) = self.persist(&all) {
            tracing::warn!("追加写入 SQLite 失败: {}", e);
        }
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
        self.tracks
            .read()
            .iter()
            .find(|t| t.id == *track_id)
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

    /// 写入 SQLite（Track 序列化为 JSON，避免列爆炸）
    fn persist(&self, tracks: &[Track]) -> orange_core::Result<()> {
        let path = match &self.db_path {
            Some(p) => p,
            None => return Ok(()), // 纯内存模式不持久化
        };
        let mut conn = Connection::open(path.as_ref()).map_err(sqlite_err)?;
        init_schema(&conn)?;
        let tx = conn.transaction().map_err(sqlite_err)?;
        tx.execute("DELETE FROM tracks", []).map_err(sqlite_err)?;
        for t in tracks {
            let json = serde_json::to_string(t)?;
            tx.execute(
                "INSERT OR REPLACE INTO tracks (id, path, data) VALUES (?1, ?2, ?3)",
                params![t.id.0.to_string(), &t.source_track_id, json],
            )
            .map_err(sqlite_err)?;
        }
        tx.commit().map_err(sqlite_err)?;
        Ok(())
    }
}

impl Default for LibraryDb {
    fn default() -> Self {
        Self::new()
    }
}

/// 建表
fn init_schema(conn: &Connection) -> orange_core::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tracks (
            id   TEXT PRIMARY KEY NOT NULL,
            path TEXT NOT NULL UNIQUE,
            data TEXT NOT NULL
        );",
    )
    .map_err(sqlite_err)?;
    Ok(())
}

/// 从 SQLite 加载全部曲目到内存
fn load_tracks(conn: &Connection) -> orange_core::Result<Vec<Track>> {
    let mut stmt = conn
        .prepare("SELECT data FROM tracks ORDER BY rowid")
        .map_err(sqlite_err)?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(sqlite_err)?;
    let mut tracks = Vec::new();
    for row in rows {
        let json = row.map_err(sqlite_err)?;
        match serde_json::from_str::<Track>(&json) {
            Ok(t) => tracks.push(t),
            Err(e) => tracing::warn!("跳过损坏的曲目记录: {}", e),
        }
    }
    Ok(tracks)
}

fn sqlite_err(e: rusqlite::Error) -> orange_core::CoreError {
    orange_core::CoreError::Internal(format!("SQLite: {e}"))
}
