//! 本地库索引(内存 + SQLite 持久化)
//!
//! 双层设计：
//! - 内存层 `Arc<RwLock<Vec<Track>>>`：快速搜索/读取
//! - SQLite 层：持久化，启动时加载到内存(秒开，无需重扫)
//!
//! 数据库位置：`<工作目录>/.orangeradio/library.sqlite`

use orange_core::source::SearchQuery;
use orange_core::track::{ArtworkSource, Track};
use parking_lot::{Mutex, RwLock};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// 默认"我的收藏"歌单固定 ID(应用级默认歌单，不可删除)
pub const FAVORITES_PLAYLIST_ID: &str = "__favorites__";

/// 本地库(线程安全，内存索引 + SQLite 持久化)
#[derive(Clone)]
pub struct LibraryDb {
    tracks: Arc<RwLock<Vec<Track>>>,
    /// 库文件路径(保留用于诊断/日志；DB 操作走 conn 长连接，不再每次 open)
    #[allow(dead_code)]
    db_path: Option<Arc<PathBuf>>,
    /// 长连接(复用 prepared statement 缓存，替代原先每次操作重开 + 重复建表)。
    /// rusqlite Connection 非 Sync，用 parking_lot::Mutex 包裹。配合调用方 spawn_blocking，锁竞争极低。
    conn: Option<Arc<Mutex<Connection>>>,
    /// 播放历史记录计数器：每记 N 条清理一次(替代原先 `now % 50` 的概率触发)
    play_history_counter: Arc<AtomicU64>,
}

impl LibraryDb {
    /// 创建纯内存库(无持久化，用于测试)
    pub fn new() -> Self {
        Self {
            tracks: Arc::new(RwLock::new(Vec::new())),
            db_path: None,
            conn: None,
            play_history_counter: Arc::new(AtomicU64::new(0)),
        }
    }

    /// 打开 SQLite 持久化库，加载已保存曲目到内存
    pub fn open(path: impl AsRef<Path>) -> orange_core::Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path).map_err(sqlite_err)?;
        // 开启 WAL + NORMAL 同步，提升并发读写性能(单进程场景足够)
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(sqlite_err)?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(sqlite_err)?;
        init_schema(&conn)?;
        let tracks = load_tracks(&conn)?;
        ensure_favorites_playlist(&conn)?;
        migrate_liked_to_favorites(&conn, &tracks)?;
        tracing::info!("已加载本地库缓存 {} 首(SQLite)", tracks.len());
        Ok(Self {
            tracks: Arc::new(RwLock::new(tracks)),
            db_path: Some(Arc::new(path)),
            conn: Some(Arc::new(Mutex::new(conn))),
            play_history_counter: Arc::new(AtomicU64::new(0)),
        })
    }

    /// 取共享长连接的锁(无持久化时返回错误)。所有 DB 操作改走这里，不再每次 open。
    fn conn(&self) -> orange_core::Result<std::sync::Arc<Mutex<Connection>>> {
        self.conn
            .clone()
            .ok_or_else(|| orange_core::CoreError::Internal("无持久化(纯内存模式)".into()))
    }

    /// 替换全部本地曲目(扫描后写入内存 + SQLite)
    ///
    /// 注意：只替换 source_kind=Local 的曲目，保留跨源收藏(网易云/QQ)的歌曲。
    pub fn replace_all(&self, tracks: Vec<Track>) {
        if let Err(e) = self.persist_local(&tracks) {
            tracing::warn!("写入 SQLite 失败: {}", e);
        }
        let mut guard = self.tracks.write();
        // 移除旧的本地曲目，保留跨源收藏曲目，再加入新扫描的
        guard.retain(|t| t.source_kind != orange_core::source::SourceKind::Local);
        guard.extend(tracks);
        tracing::info!("本地库已更新，共 {} 首", guard.len());
    }

    /// 追加单首曲目(跨源收藏：网易云/QQ 歌曲加入本地库)
    pub fn add(&self, track: Track) {
        if let Err(e) = self.persist_one(&track) {
            tracing::warn!("追加写入 SQLite 失败: {}", e);
        }
        let mut guard = self.tracks.write();
        // 去重：同 source_track_id + source_kind 视为同一首
        guard.retain(|t| {
            !(t.source_track_id == track.source_track_id && t.source_kind == track.source_kind)
        });
        guard.push(track);
    }

    /// 按 track_id 查找(跨源收藏的歌曲也能查到)
    pub fn find_by_source_id(&self, source_track_id: &str) -> Option<Track> {
        self.tracks
            .read()
            .iter()
            .find(|t| t.source_track_id == source_track_id)
            .cloned()
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

    /// 按 ID 字符串查找(避免调用方为查一首歌而 clone 整库再 find)
    pub fn find_by_id_str(&self, track_id: &str) -> Option<Track> {
        self.tracks
            .read()
            .iter()
            .find(|t| t.id.0.to_string() == track_id)
            .cloned()
    }

    /// 关键词搜索(标题/艺术家/专辑)
    pub fn search(&self, query: &SearchQuery) -> Vec<Track> {
        let conn_arc = match self.conn() {
            Ok(c) => c,
            Err(_) => {
                // 内存模式：按老逻辑过滤
                let kw = query.keyword.to_lowercase();
                let guard = self.tracks.read();
                return guard
                    .iter()
                    .filter(|t| {
                        if kw.is_empty() {
                            return true;
                        }
                        t.meta.title.to_lowercase().contains(&kw)
                            || t.meta.artist.to_lowercase().contains(&kw)
                            || t.meta
                                .album
                                .as_deref()
                                .unwrap_or("")
                                .to_lowercase()
                                .contains(&kw)
                    })
                    .skip(((query.page.saturating_sub(1)) as usize) * query.page_size as usize)
                    .take(query.page_size as usize)
                    .cloned()
                    .collect();
            }
        };
        let conn = conn_arc.lock();
        let kw = query.keyword.to_lowercase();
        let offset = ((query.page.saturating_sub(1)) as usize) * query.page_size as usize;
        let limit = query.page_size as usize;
        let sql = if kw.is_empty() {
            "SELECT data FROM tracks ORDER BY rowid LIMIT ?1 OFFSET ?2"
        } else {
            "SELECT data FROM tracks WHERE lower(json_extract(data, '$.meta.title')) LIKE ?1 \
             OR lower(json_extract(data, '$.meta.artist')) LIKE ?1 \
             OR lower(json_extract(data, '$.meta.album')) LIKE ?1 \
             ORDER BY rowid LIMIT ?2 OFFSET ?3"
        };
        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let like = format!("%{}%", kw);
        let mapper = |r: &rusqlite::Row| -> rusqlite::Result<String> { r.get::<_, String>(0) };
        let rows = if kw.is_empty() {
            stmt.query_map(params![limit as i64, offset as i64], mapper)
        } else {
            stmt.query_map(params![like, limit as i64, offset as i64], mapper)
        };
        match rows {
            Ok(rs) => rs
                .filter_map(|r| r.ok())
                .filter_map(|json| serde_json::from_str::<Track>(&json).ok())
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    /// 分页查询曲目(优先走 SQLite，避免全内存克隆)
    pub fn query_paged(&self, offset: usize, limit: usize, filter: Option<&str>) -> Vec<Track> {
        let conn_arc = match self.conn() {
            Ok(c) => c,
            Err(_) => {
                let guard = self.tracks.read();
                let mut tracks = guard.iter().cloned().collect::<Vec<_>>();
                match filter {
                    Some("liked") => tracks.retain(|t| t.liked),
                    Some("local") => {
                        tracks.retain(|t| t.source_kind == orange_core::source::SourceKind::Local)
                    }
                    _ => {}
                }
                return tracks.into_iter().skip(offset).take(limit).collect();
            }
        };
        let conn = conn_arc.lock();
        let sql = match filter {
            Some("liked") => "SELECT data FROM tracks WHERE json_extract(data, '$.liked') = 1 ORDER BY rowid LIMIT ?1 OFFSET ?2",
            Some("local") => "SELECT data FROM tracks WHERE json_extract(data, '$.source_kind') = 'local' ORDER BY rowid LIMIT ?1 OFFSET ?2",
            _ => "SELECT data FROM tracks ORDER BY rowid LIMIT ?1 OFFSET ?2",
        };
        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map(params![limit as i64, offset as i64], |r| {
            r.get::<_, String>(0)
        });
        match rows {
            Ok(rs) => rs
                .filter_map(|r| r.ok())
                .filter_map(|json| serde_json::from_str::<Track>(&json).ok())
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    /// 写入本地曲目到 SQLite(增量：先删本地曲目再插，保留跨源收藏)
    fn persist_local(&self, tracks: &[Track]) -> orange_core::Result<()> {
        let conn_arc = self.conn()?;
        let mut conn = conn_arc.lock();
        let tx = conn.transaction().map_err(sqlite_err)?;
        // 只删除本地扫描的曲目(path 以盘符/斜杠开头的)，保留跨源收藏
        tx.execute(
            "DELETE FROM tracks WHERE path LIKE '%/%' OR path LIKE '%\\%'",
            [],
        )
        .map_err(sqlite_err)?;
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

    /// 追加单首曲目到 SQLite(跨源收藏用)
    fn persist_one(&self, track: &Track) -> orange_core::Result<()> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        let json = serde_json::to_string(track)?;
        conn.execute(
            "INSERT OR REPLACE INTO tracks (id, path, data) VALUES (?1, ?2, ?3)",
            params![track.id.0.to_string(), &track.source_track_id, json],
        )
        .map_err(sqlite_err)?;
        Ok(())
    }

    // ===== 用户歌单系统 =====

    /// 创建歌单，返回歌单 ID
    pub fn create_playlist(&self, name: &str) -> orange_core::Result<String> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO user_playlists (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, name, now],
        )
        .map_err(sqlite_err)?;
        Ok(id)
    }

    /// 重命名歌单
    pub fn rename_playlist(&self, id: &str, name: &str) -> orange_core::Result<()> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE user_playlists SET name=?1, updated_at=?2 WHERE id=?3",
            params![name, now, id],
        )
        .map_err(sqlite_err)?;
        Ok(())
    }

    /// 删除歌单(连带关联)
    /// 默认"我的收藏"歌单不可删除。
    pub fn delete_playlist(&self, id: &str) -> orange_core::Result<()> {
        if id == FAVORITES_PLAYLIST_ID {
            return Err(orange_core::CoreError::Internal(
                "默认收藏歌单不可删除".into(),
            ));
        }
        let conn_arc = self.conn()?;
        let mut conn = conn_arc.lock();
        let tx = conn.transaction().map_err(sqlite_err)?;
        tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id=?1",
            params![id],
        )
        .map_err(sqlite_err)?;
        tx.execute("DELETE FROM user_playlists WHERE id=?1", params![id])
            .map_err(sqlite_err)?;
        tx.commit().map_err(sqlite_err)?;
        Ok(())
    }

    /// 添加歌曲到歌单(跨源歌曲先存入 tracks 表，再建关联)
    pub fn add_to_playlist(&self, playlist_id: &str, track: &Track) -> orange_core::Result<()> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        // 先确保曲目在 tracks 表(跨源收藏的关键：网易云歌曲也存进来)
        let json = serde_json::to_string(track)?;
        conn.execute(
            "INSERT OR REPLACE INTO tracks (id, path, data) VALUES (?1, ?2, ?3)",
            params![track.id.0.to_string(), &track.source_track_id, json],
        )
        .map_err(sqlite_err)?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, added_at) VALUES (?1, ?2, ?3)",
            params![playlist_id, track.id.0.to_string(), now],
        )
        .map_err(sqlite_err)?;
        Ok(())
    }

    /// 从歌单移除歌曲
    pub fn remove_from_playlist(
        &self,
        playlist_id: &str,
        track_id: &str,
    ) -> orange_core::Result<()> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id=?1 AND track_id=?2",
            params![playlist_id, track_id],
        )
        .map_err(sqlite_err)?;
        Ok(())
    }

    /// 获取歌单内歌曲(支持分页)
    pub fn playlist_tracks(
        &self,
        playlist_id: &str,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> orange_core::Result<Vec<Track>> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        let sql = match (offset, limit) {
            (Some(_), Some(_)) => {
                "SELECT t.data FROM playlist_tracks pt JOIN tracks t ON pt.track_id=t.id \
                 WHERE pt.playlist_id=?1 ORDER BY pt.added_at LIMIT ?2 OFFSET ?3"
            }
            _ => {
                "SELECT t.data FROM playlist_tracks pt JOIN tracks t ON pt.track_id=t.id \
                 WHERE pt.playlist_id=?1 ORDER BY pt.added_at"
            }
        };
        let mut stmt = conn.prepare(sql).map_err(sqlite_err)?;
        let mapper = |r: &rusqlite::Row| -> rusqlite::Result<String> { r.get::<_, String>(0) };
        let rows = match (offset, limit) {
            (Some(o), Some(l)) => stmt.query_map(params![playlist_id, l as i64, o as i64], mapper),
            _ => stmt.query_map(params![playlist_id], mapper),
        }
        .map_err(sqlite_err)?;
        let mut tracks = Vec::new();
        for row in rows {
            let json = row.map_err(sqlite_err)?;
            if let Ok(t) = serde_json::from_str::<Track>(&json) {
                tracks.push(t);
            }
        }
        Ok(tracks)
    }

    /// 全部用户自建歌单(不含默认"我的收藏"歌单)
    pub fn all_playlists(&self) -> orange_core::Result<Vec<UserPlaylist>> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        let mut stmt = conn
            .prepare("SELECT p.id, p.name, p.created_at, COUNT(pt.track_id) as cnt FROM user_playlists p LEFT JOIN playlist_tracks pt ON p.id=pt.playlist_id WHERE p.id != ?1 GROUP BY p.id ORDER BY p.created_at DESC")
            .map_err(sqlite_err)?;
        let rows = stmt
            .query_map(params![FAVORITES_PLAYLIST_ID], |r| {
                let cnt: i64 = r.get(3)?;
                Ok(UserPlaylist {
                    id: r.get::<_, String>(0)?,
                    name: r.get::<_, String>(1)?,
                    created_at: r.get::<_, String>(2)?,
                    track_count: cnt as u32,
                    cover: None,
                })
            })
            .map_err(sqlite_err)?;
        let mut result = Vec::new();
        for row in rows {
            let mut pl = row.map_err(sqlite_err)?;
            // 取该歌单第一首有 artwork 的曲目，提取封面 URL/路径
            let mut cover_stmt = conn
                .prepare("SELECT t.data FROM playlist_tracks pt JOIN tracks t ON pt.track_id=t.id WHERE pt.playlist_id=?1 ORDER BY pt.added_at")
                .map_err(sqlite_err)?;
            let data_rows: Vec<String> = cover_stmt
                .query_map(params![pl.id], |r| r.get::<_, String>(0))
                .map_err(sqlite_err)?
                .filter_map(|r| r.ok())
                .collect();
            for json in data_rows {
                if let Ok(t) = serde_json::from_str::<Track>(&json) {
                    if let Some(art) = &t.meta.artwork {
                        if let Some(url) = extract_cover_url(&art.source) {
                            pl.cover = Some(url.to_string());
                            break;
                        }
                    }
                }
            }
            result.push(pl);
        }
        Ok(result)
    }

    /// 获取默认"我的收藏"歌单信息
    pub fn favorites_playlist(&self) -> orange_core::Result<Option<UserPlaylist>> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        let mut stmt = conn
            .prepare("SELECT p.id, p.name, p.created_at, COUNT(pt.track_id) as cnt FROM user_playlists p LEFT JOIN playlist_tracks pt ON p.id=pt.playlist_id WHERE p.id = ?1 GROUP BY p.id")
            .map_err(sqlite_err)?;
        let mut rows = stmt
            .query_map(params![FAVORITES_PLAYLIST_ID], |r| {
                let cnt: i64 = r.get(3)?;
                Ok(UserPlaylist {
                    id: r.get::<_, String>(0)?,
                    name: r.get::<_, String>(1)?,
                    created_at: r.get::<_, String>(2)?,
                    track_count: cnt as u32,
                    cover: None,
                })
            })
            .map_err(sqlite_err)?;
        if let Some(row) = rows.next() {
            let mut pl = row.map_err(sqlite_err)?;
            // 取该歌单第一首有 artwork 的曲目，提取封面 URL/路径
            let mut cover_stmt = conn
                .prepare("SELECT t.data FROM playlist_tracks pt JOIN tracks t ON pt.track_id=t.id WHERE pt.playlist_id=?1 ORDER BY pt.added_at")
                .map_err(sqlite_err)?;
            let data_rows: Vec<String> = cover_stmt
                .query_map(params![pl.id], |r| r.get::<_, String>(0))
                .map_err(sqlite_err)?
                .filter_map(|r| r.ok())
                .collect();
            for json in data_rows {
                if let Ok(t) = serde_json::from_str::<Track>(&json) {
                    if let Some(art) = &t.meta.artwork {
                        if let Some(url) = extract_cover_url(&art.source) {
                            pl.cover = Some(url.to_string());
                            break;
                        }
                    }
                }
            }
            return Ok(Some(pl));
        }
        Ok(None)
    }

    /// 设置喜欢状态，并同步到默认"我的收藏"歌单
    ///
    /// liked=true 时：加入 FAVORITES_PLAYLIST_ID
    /// liked=false 时：从 FAVORITES_PLAYLIST_ID 移除
    ///
    /// 注意：此方法在持锁期间直接执行 SQL 同步歌单关联，
    /// 不能调用 add_to_playlist / remove_from_playlist(它们会再次 lock 同一个 Mutex，导致死锁)。
    pub fn set_liked(&self, track: &Track, liked: bool) -> orange_core::Result<()> {
        let track_id = track.id.0.to_string();
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        // 更新 tracks 表中对应记录的 liked 字段(需读取 JSON→改→写回)
        let row: Option<(String,)> = conn
            .query_row(
                "SELECT data FROM tracks WHERE id=?1",
                params![track_id],
                |r| Ok((r.get::<_, String>(0)?,)),
            )
            .ok();
        if let Some((json,)) = row {
            if let Ok(mut t) = serde_json::from_str::<Track>(&json) {
                t.liked = liked;
                let new_json = serde_json::to_string(&t)?;
                conn.execute(
                    "UPDATE tracks SET data=?1 WHERE id=?2",
                    params![new_json, track_id],
                )
                .map_err(sqlite_err)?;
            }
        }
        // 同步默认"我的收藏"歌单(直接执行 SQL，不调 add_to_playlist 以避免递归锁死锁)
        if liked {
            // 确保曲目在 tracks 表(跨源收藏的关键)
            // 注意：用 track 的副本并强制设置 liked=true，避免前端传来的旧 track.liked=false 覆盖
            let mut track_copy = track.clone();
            track_copy.liked = true;
            let json = serde_json::to_string(&track_copy)?;
            conn.execute(
                "INSERT OR REPLACE INTO tracks (id, path, data) VALUES (?1, ?2, ?3)",
                params![track_id, &track.source_track_id, json],
            )
            .map_err(sqlite_err)?;
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, added_at) VALUES (?1, ?2, ?3)",
                params![FAVORITES_PLAYLIST_ID, track_id, now],
            )
            .map_err(sqlite_err)?;
        } else {
            conn.execute(
                "DELETE FROM playlist_tracks WHERE playlist_id=?1 AND track_id=?2",
                params![FAVORITES_PLAYLIST_ID, track_id],
            )
            .map_err(sqlite_err)?;
        }
        // 同步内存
        {
            let mut guard = self.tracks.write();
            if let Some(t) = guard.iter_mut().find(|t| t.id.0.to_string() == track_id) {
                t.liked = liked;
            }
        }
        Ok(())
    }

    /// 更新曲目的 BPM(音频分析兜底后写回，DB + 内存同步)
    pub fn update_track_bpm(&self, track_id: &str, bpm: f32) -> orange_core::Result<()> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        let row: Option<(String,)> = conn
            .query_row(
                "SELECT data FROM tracks WHERE id=?1",
                params![track_id],
                |r| Ok((r.get::<_, String>(0)?,)),
            )
            .ok();
        if let Some((json,)) = row {
            if let Ok(mut t) = serde_json::from_str::<Track>(&json) {
                t.meta.bpm = Some(bpm);
                let new_json = serde_json::to_string(&t)?;
                conn.execute(
                    "UPDATE tracks SET data=?1 WHERE id=?2",
                    params![new_json, track_id],
                )
                .map_err(sqlite_err)?;
            }
        }
        // 同步内存
        let mut guard = self.tracks.write();
        if let Some(t) = guard.iter_mut().find(|t| t.id.0.to_string() == track_id) {
            t.meta.bpm = Some(bpm);
        }
        Ok(())
    }

    /// 清理播放历史：保留最近 keep_days 天且最多 max_rows 条
    fn prune_play_history(
        conn: &Connection,
        keep_days: i64,
        max_rows: usize,
    ) -> orange_core::Result<()> {
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64 - keep_days * 24 * 60 * 60)
            .unwrap_or(0);
        conn.execute(
            "DELETE FROM play_history WHERE played_at < ?1",
            params![cutoff],
        )
        .map_err(sqlite_err)?;
        // 若仍超过 max_rows，删除最旧的
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM play_history", [], |r| r.get(0))
            .map_err(sqlite_err)?;
        if count > max_rows as i64 {
            let to_delete = count - max_rows as i64;
            conn.execute(
                "DELETE FROM play_history WHERE id IN (SELECT id FROM play_history ORDER BY played_at ASC LIMIT ?1)",
                params![to_delete],
            )
            .map_err(sqlite_err)?;
        }
        Ok(())
    }

    /// 月度 VACUUM(可选，由调用方控制频次)
    pub fn vacuum_play_history(&self) -> orange_core::Result<()> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        conn.execute("VACUUM", []).map_err(sqlite_err)?;
        Ok(())
    }

    /// 喜欢的歌曲
    pub fn liked_tracks(&self) -> Vec<Track> {
        self.tracks
            .read()
            .iter()
            .filter(|t| t.liked)
            .cloned()
            .collect()
    }

    /// 记录一次播放行为(completed=完整听完，skipped=用户主动切走；二者可同时为 false)
    pub fn record_play_history(
        &self,
        track_id: &str,
        played_secs: f64,
        total_secs: f64,
        completed: bool,
        skipped: bool,
    ) -> orange_core::Result<()> {
        let conn_arc = self.conn()?;
        let conn = conn_arc.lock();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0) as i64;
        conn.execute(
            "INSERT INTO play_history (track_id, played_at, played_secs, total_secs, completed, skipped) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![track_id, now, played_secs, total_secs, completed as i32, skipped as i32],
        )
        .map_err(sqlite_err)?;
        // 每 64 条记录清理一次，避免历史表无限增长(原 `now % 50` 是 Unix 秒取模，几乎永不命中)
        let count = self.play_history_counter.fetch_add(1, Ordering::Relaxed) + 1;
        if count.is_multiple_of(64) {
            if let Err(e) = Self::prune_play_history(&conn, 90, 5000) {
                tracing::warn!("清理播放历史失败: {}", e);
            }
        }
        Ok(())
    }

    /// 最近播放过的 track_id(去重，用于推荐时排除刚听过的)
    pub fn recent_track_ids(&self, limit: usize) -> Vec<String> {
        let conn_arc = match self.conn() {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let conn = conn_arc.lock();
        let Ok(mut stmt) = conn
            .prepare("SELECT DISTINCT track_id FROM play_history ORDER BY played_at DESC LIMIT ?1")
        else {
            return Vec::new();
        };
        let rows = stmt.query_map(params![limit as i64], |r| r.get::<_, String>(0));
        match rows {
            Ok(rs) => rs.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    /// 最近的播放反馈(skipped/liked/completed 的 track_id)，驱动懂你模式实时调整
    pub fn recent_feedback(&self, limit: usize) -> orange_core::recommendation::ListenFeedback {
        let mut fb = orange_core::recommendation::ListenFeedback::default();
        let conn_arc = match self.conn() {
            Ok(c) => c,
            Err(_) => return fb,
        };
        let conn = conn_arc.lock();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT DISTINCT track_id FROM play_history WHERE skipped=1 ORDER BY played_at DESC LIMIT ?1",
        ) {
            if let Ok(rows) = stmt.query_map(params![limit as i64], |r| r.get::<_, String>(0)) {
                fb.skipped = rows.filter_map(|r| r.ok()).collect();
            }
        }
        if let Ok(mut stmt) = conn.prepare(
            "SELECT DISTINCT track_id FROM play_history WHERE completed=1 ORDER BY played_at DESC LIMIT ?1",
        ) {
            if let Ok(rows) = stmt.query_map(params![limit as i64], |r| r.get::<_, String>(0)) {
                fb.completed = rows.filter_map(|r| r.ok()).collect();
            }
        }
        fb.liked = self
            .tracks
            .read()
            .iter()
            .filter(|t| t.liked)
            .take(limit)
            .map(|t| t.id.0.to_string())
            .collect();
        fb
    }

    /// 聚合用户画像：从 play_history + 内存 tracks 统计 top artists/genres、
    /// skip/complete 模式、时段分布、总听歌时长
    pub fn aggregate_user_profile(
        &self,
    ) -> orange_core::Result<orange_core::recommendation::UserProfile> {
        use orange_core::recommendation::{BpmPreference, UserProfile};
        let mut profile = UserProfile {
            bpm_preference: BpmPreference::default(),
            ..Default::default()
        };
        let conn_arc = match self.conn() {
            Ok(c) => c,
            Err(_) => return Ok(profile),
        };
        let conn = conn_arc.lock();
        let mut stmt = conn
            .prepare(
                "SELECT track_id, played_at, played_secs, completed, skipped FROM play_history ORDER BY played_at DESC LIMIT 2000",
            )
            .map_err(sqlite_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, i32>(3)? != 0,
                    r.get::<_, i32>(4)? != 0,
                ))
            })
            .map_err(sqlite_err)?;
        let entries: Vec<(String, i64, f64, bool, bool)> = rows.filter_map(|r| r.ok()).collect();

        // 内存 tracks 索引(只存画像计算所需的 artist/genre/bpm，不 clone 整个 Track)
        struct TrackFeatures {
            artist: String,
            genre: Vec<String>,
            bpm: Option<f32>,
        }
        let tracks_map: HashMap<String, TrackFeatures> = {
            let guard = self.tracks.read();
            guard
                .iter()
                .map(|t| {
                    (
                        t.id.0.to_string(),
                        TrackFeatures {
                            artist: t.meta.artist.clone(),
                            genre: t.meta.genre.clone(),
                            bpm: t.meta.bpm,
                        },
                    )
                })
                .collect()
        };

        let mut artist_stat: HashMap<String, (f32, u32, u32)> = HashMap::new(); // (权重, complete, skip)
        let mut genre_stat: HashMap<String, (f32, u32, u32)> = HashMap::new();
        let mut total_listen = 0f64;
        let mut hourly = [0f32; 24];
        // BPM 分桶统计(<90=slow / 90-120=medium / 120-140=fast / >140=very_fast)
        let mut bpm_buckets = [0f32; 4];

        for (track_id, played_at, played_secs, completed, skipped) in &entries {
            total_listen += *played_secs;
            let hour = (((*played_at) / 3600) % 24) as usize;
            hourly[hour] += *played_secs as f32;
            // 权重：完整听完=1.0，中途未结束=0.5，跳过=0.2
            let weight = if *completed {
                1.0
            } else if *skipped {
                0.2
            } else {
                0.5
            };
            if let Some(t) = tracks_map.get(track_id) {
                let artist = t.artist.trim();
                if !artist.is_empty() {
                    let s = artist_stat.entry(artist.to_string()).or_insert((0.0, 0, 0));
                    s.0 += weight;
                    if *completed {
                        s.1 += 1;
                    }
                    if *skipped {
                        s.2 += 1;
                    }
                }
                for g in &t.genre {
                    let g = g.trim();
                    if g.is_empty() {
                        continue;
                    }
                    let s = genre_stat.entry(g.to_string()).or_insert((0.0, 0, 0));
                    s.0 += weight;
                    if *completed {
                        s.1 += 1;
                    }
                    if *skipped {
                        s.2 += 1;
                    }
                }
                // BPM 分桶(仅当曲目有 bpm 元数据时)
                if let Some(bpm) = t.bpm {
                    let idx = if bpm < 90.0 {
                        0
                    } else if bpm < 120.0 {
                        1
                    } else if bpm < 140.0 {
                        2
                    } else {
                        3
                    };
                    bpm_buckets[idx] += weight;
                }
            }
        }

        profile.total_listen_secs = total_listen as u64;
        profile.hourly_activity = hourly;
        profile.top_artists = normalize_top(&artist_stat, 20);
        profile.top_genres = normalize_top(&genre_stat, 20);
        profile.skip_patterns = collect_patterns(&artist_stat, &genre_stat, true);
        profile.complete_patterns = collect_patterns(&artist_stat, &genre_stat, false);
        profile.recent_likes = self
            .tracks
            .read()
            .iter()
            .filter(|t| t.liked)
            .take(50)
            .map(|t| t.id.0.to_string())
            .collect();

        // BPM 偏好归一化(无数据时保留默认分布)
        let bpm_total: f32 = bpm_buckets.iter().sum();
        if bpm_total > 0.0 {
            let dist = [
                bpm_buckets[0] / bpm_total,
                bpm_buckets[1] / bpm_total,
                bpm_buckets[2] / bpm_total,
                bpm_buckets[3] / bpm_total,
            ];
            // 桶中点：slow=75 / medium=105 / fast=130 / very_fast=160
            let weighted_center =
                dist[0] * 75.0 + dist[1] * 105.0 + dist[2] * 130.0 + dist[3] * 160.0;
            // 根据有数据的桶估计 min/max
            let thresholds = [
                (dist[0], 60.0, 90.0),
                (dist[1], 90.0, 120.0),
                (dist[2], 120.0, 140.0),
                (dist[3], 140.0, 180.0),
            ];
            let min_bpm = thresholds
                .iter()
                .find(|(w, _, _)| *w > 0.001)
                .map(|(_, lo, _)| *lo)
                .unwrap_or(60.0);
            let max_bpm = thresholds
                .iter()
                .rev()
                .find(|(w, _, _)| *w > 0.001)
                .map(|(_, _, hi)| *hi)
                .unwrap_or(180.0);
            profile.bpm_preference = BpmPreference {
                slow: dist[0],
                medium: dist[1],
                fast: dist[2],
                very_fast: dist[3],
                min: min_bpm,
                max: max_bpm,
                center: weighted_center,
                distribution: dist.to_vec(),
            };
        }

        Ok(profile)
    }
}

/// 取权重 top N 并归一化到 [0,1]
fn normalize_top(stat: &HashMap<String, (f32, u32, u32)>, n: usize) -> Vec<(String, f32)> {
    let mut v: Vec<(String, f32)> = stat.iter().map(|(k, v)| (k.clone(), v.0)).collect();
    v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    v.truncate(n);
    let max = v
        .first()
        .map(|(_, w)| *w)
        .filter(|w| *w > 0.0)
        .unwrap_or(1.0);
    v.into_iter().map(|(k, w)| (k, w / max)).collect()
}

/// 收集 skip 率或 complete 率 > 0.5 且样本 >= 2 的 artist/genre(正负反馈特征)
fn collect_patterns(
    artist: &HashMap<String, (f32, u32, u32)>,
    genre: &HashMap<String, (f32, u32, u32)>,
    skip: bool,
) -> Vec<String> {
    let mut out = Vec::new();
    for stat in [artist, genre] {
        for (k, (_, c, sk)) in stat {
            let total = c + sk;
            if total < 2 {
                continue;
            }
            let rate = if skip {
                *sk as f32 / total as f32
            } else {
                *c as f32 / total as f32
            };
            if rate > 0.5 {
                out.push(k.clone());
            }
        }
    }
    out.truncate(50);
    out
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
        );
        CREATE TABLE IF NOT EXISTS user_playlists (
            id         TEXT PRIMARY KEY NOT NULL,
            name       TEXT NOT NULL,
            cover      TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id TEXT NOT NULL,
            track_id    TEXT NOT NULL,
            added_at    TEXT NOT NULL,
            PRIMARY KEY (playlist_id, track_id)
        );
        CREATE TABLE IF NOT EXISTS play_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id    TEXT NOT NULL,
            played_at   INTEGER NOT NULL,
            played_secs REAL NOT NULL,
            total_secs  REAL NOT NULL,
            completed   INTEGER NOT NULL,
            skipped     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_history_track ON play_history(track_id);
        CREATE INDEX IF NOT EXISTS idx_history_time ON play_history(played_at);",
    )
    .map_err(sqlite_err)?;
    Ok(())
}

/// 用户自建歌单(摘要信息)
#[derive(Debug, Clone, serde::Serialize)]
pub struct UserPlaylist {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub track_count: u32,
    /// 歌单封面(取第一首有 artwork 的曲目，前端用于 3D 歌单架展示)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
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

/// 确保默认"我的收藏"歌单存在
fn ensure_favorites_playlist(conn: &Connection) -> orange_core::Result<()> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM user_playlists WHERE id=?1",
            params![FAVORITES_PLAYLIST_ID],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !exists {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO user_playlists (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![FAVORITES_PLAYLIST_ID, "我的收藏", now],
        )
        .map_err(sqlite_err)?;
        tracing::info!("已创建默认收藏歌单");
    }
    Ok(())
}

/// 将历史 liked 曲目迁移到默认"我的收藏"歌单(幂等)
fn migrate_liked_to_favorites(conn: &Connection, tracks: &[Track]) -> orange_core::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn
        .prepare("INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, added_at) VALUES (?1, ?2, ?3)")
        .map_err(sqlite_err)?;
    for t in tracks.iter().filter(|t| t.liked) {
        stmt.execute(params![FAVORITES_PLAYLIST_ID, t.id.0.to_string(), now])
            .map_err(sqlite_err)?;
    }
    Ok(())
}

fn sqlite_err(e: rusqlite::Error) -> orange_core::CoreError {
    orange_core::CoreError::Internal(format!("SQLite: {e}"))
}

/// 从 ArtworkSource 提取 3D 歌单架可用的封面 URL：
/// - Url → 返回 url(网络封面，前端 Canvas 可直接加载)
/// - Local → None(本地文件封面在 3D Canvas 加载需 asset 协议，且可能 CORS 受限，保持黑胶占位)
/// - Embedded → None
fn extract_cover_url(a: &ArtworkSource) -> Option<&str> {
    match a {
        ArtworkSource::Url { url } => Some(url.as_str()),
        ArtworkSource::Local { .. } => None,
        ArtworkSource::Embedded { .. } => None,
    }
}
