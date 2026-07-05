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
use std::collections::HashMap;
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

    /// 替换全部本地曲目（扫描后写入内存 + SQLite）
    ///
    /// 注意：只替换 source_kind=Local 的曲目，保留跨源收藏（网易云/QQ）的歌曲。
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

    /// 追加单首曲目（跨源收藏：网易云/QQ 歌曲加入本地库）
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

    /// 按 track_id 查找（跨源收藏的歌曲也能查到）
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
            .collect()
    }

    /// 写入本地曲目到 SQLite（增量：先删本地曲目再插，保留跨源收藏）
    fn persist_local(&self, tracks: &[Track]) -> orange_core::Result<()> {
        let path = match &self.db_path {
            Some(p) => p,
            None => return Ok(()),
        };
        let mut conn = Connection::open(path.as_ref()).map_err(sqlite_err)?;
        init_schema(&conn)?;
        let tx = conn.transaction().map_err(sqlite_err)?;
        // 只删除本地扫描的曲目（path 以盘符/斜杠开头的），保留跨源收藏
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

    /// 追加单首曲目到 SQLite（跨源收藏用）
    fn persist_one(&self, track: &Track) -> orange_core::Result<()> {
        let path = match &self.db_path {
            Some(p) => p,
            None => return Ok(()),
        };
        let conn = Connection::open(path.as_ref()).map_err(sqlite_err)?;
        init_schema(&conn)?;
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
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Err(orange_core::CoreError::Internal("无持久化".into())),
        };
        let conn = Connection::open(path).map_err(sqlite_err)?;
        init_schema(&conn)?;
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
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Ok(()),
        };
        let conn = Connection::open(path).map_err(sqlite_err)?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE user_playlists SET name=?1, updated_at=?2 WHERE id=?3",
            params![name, now, id],
        )
        .map_err(sqlite_err)?;
        Ok(())
    }

    /// 删除歌单（连带关联）
    pub fn delete_playlist(&self, id: &str) -> orange_core::Result<()> {
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Ok(()),
        };
        let mut conn = Connection::open(path).map_err(sqlite_err)?;
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

    /// 添加歌曲到歌单（跨源歌曲先存入 tracks 表，再建关联）
    pub fn add_to_playlist(&self, playlist_id: &str, track: &Track) -> orange_core::Result<()> {
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Ok(()),
        };
        let conn = Connection::open(path).map_err(sqlite_err)?;
        init_schema(&conn)?;
        // 先确保曲目在 tracks 表（跨源收藏的关键：网易云歌曲也存进来）
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
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Ok(()),
        };
        let conn = Connection::open(path).map_err(sqlite_err)?;
        conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id=?1 AND track_id=?2",
            params![playlist_id, track_id],
        )
        .map_err(sqlite_err)?;
        Ok(())
    }

    /// 获取歌单内全部歌曲
    pub fn playlist_tracks(&self, playlist_id: &str) -> orange_core::Result<Vec<Track>> {
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Ok(vec![]),
        };
        let conn = Connection::open(path).map_err(sqlite_err)?;
        let mut stmt = conn
            .prepare("SELECT t.data FROM playlist_tracks pt JOIN tracks t ON pt.track_id=t.id WHERE pt.playlist_id=?1 ORDER BY pt.added_at")
            .map_err(sqlite_err)?;
        let rows = stmt
            .query_map(params![playlist_id], |r| r.get::<_, String>(0))
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

    /// 全部用户歌单
    pub fn all_playlists(&self) -> orange_core::Result<Vec<UserPlaylist>> {
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Ok(vec![]),
        };
        let conn = Connection::open(path).map_err(sqlite_err)?;
        let mut stmt = conn
            .prepare("SELECT p.id, p.name, p.created_at, COUNT(pt.track_id) as cnt FROM user_playlists p LEFT JOIN playlist_tracks pt ON p.id=pt.playlist_id GROUP BY p.id ORDER BY p.created_at DESC")
            .map_err(sqlite_err)?;
        let rows = stmt
            .query_map([], |r| {
                let cnt: i64 = r.get(3)?;
                Ok(UserPlaylist {
                    id: r.get::<_, String>(0)?,
                    name: r.get::<_, String>(1)?,
                    created_at: r.get::<_, String>(2)?,
                    track_count: cnt as u32,
                })
            })
            .map_err(sqlite_err)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(sqlite_err)?);
        }
        Ok(result)
    }

    /// 设置喜欢状态
    pub fn set_liked(&self, track_id: &str, liked: bool) -> orange_core::Result<()> {
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Ok(()),
        };
        let conn = Connection::open(path).map_err(sqlite_err)?;
        // 更新 tracks 表中对应记录的 liked 字段（需读取 JSON→改→写回）
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
        // 同步内存
        let mut guard = self.tracks.write();
        if let Some(t) = guard.iter_mut().find(|t| t.id.0.to_string() == track_id) {
            t.liked = liked;
        }
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

    /// 记录一次播放行为（completed=完整听完，skipped=用户主动切走；二者可同时为 false）
    pub fn record_play_history(
        &self,
        track_id: &str,
        played_secs: f64,
        total_secs: f64,
        completed: bool,
        skipped: bool,
    ) -> orange_core::Result<()> {
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Ok(()),
        };
        let conn = Connection::open(path).map_err(sqlite_err)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0) as i64;
        conn.execute(
            "INSERT INTO play_history (track_id, played_at, played_secs, total_secs, completed, skipped) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![track_id, now, played_secs, total_secs, completed as i32, skipped as i32],
        )
        .map_err(sqlite_err)?;
        Ok(())
    }

    /// 最近播放过的 track_id（去重，用于推荐时排除刚听过的）
    pub fn recent_track_ids(&self, limit: usize) -> Vec<String> {
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Vec::new(),
        };
        let Ok(conn) = Connection::open(path) else {
            return Vec::new();
        };
        let Ok(mut stmt) = conn.prepare(
            "SELECT DISTINCT track_id FROM play_history ORDER BY played_at DESC LIMIT ?1",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map(params![limit as i64], |r| r.get::<_, String>(0));
        match rows {
            Ok(rs) => rs.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    /// 最近的播放反馈（skipped/liked/completed 的 track_id），驱动懂你模式实时调整
    pub fn recent_feedback(
        &self,
        limit: usize,
    ) -> orange_core::recommendation::ListenFeedback {
        let mut fb = orange_core::recommendation::ListenFeedback::default();
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return fb,
        };
        let Ok(conn) = Connection::open(path) else {
            return fb;
        };
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
        let path = match &self.db_path {
            Some(p) => p.as_ref(),
            None => return Ok(profile),
        };
        let conn = Connection::open(path).map_err(sqlite_err)?;
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

        // 内存 tracks 索引（拿 artist/genre）
        let tracks_map: HashMap<String, Track> = {
            let guard = self.tracks.read();
            guard
                .iter()
                .map(|t| (t.id.0.to_string(), t.clone()))
                .collect()
        };

        let mut artist_stat: HashMap<String, (f32, u32, u32)> = HashMap::new(); // (权重, complete, skip)
        let mut genre_stat: HashMap<String, (f32, u32, u32)> = HashMap::new();
        let mut total_listen = 0f64;
        let mut hourly = [0f32; 24];

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
                let artist = t.meta.artist.trim();
                if !artist.is_empty() {
                    let s = artist_stat
                        .entry(artist.to_string())
                        .or_insert((0.0, 0, 0));
                    s.0 += weight;
                    if *completed { s.1 += 1; }
                    if *skipped { s.2 += 1; }
                }
                for g in &t.meta.genre {
                    let g = g.trim();
                    if g.is_empty() { continue; }
                    let s = genre_stat.entry(g.to_string()).or_insert((0.0, 0, 0));
                    s.0 += weight;
                    if *completed { s.1 += 1; }
                    if *skipped { s.2 += 1; }
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

/// 收集 skip 率或 complete 率 > 0.5 且样本 >= 2 的 artist/genre（正负反馈特征）
fn collect_patterns(
    artist: &HashMap<String, (f32, u32, u32)>,
    genre: &HashMap<String, (f32, u32, u32)>,
    skip: bool,
) -> Vec<String> {
    let mut out = Vec::new();
    for stat in [artist, genre] {
        for (k, (_, c, sk)) in stat {
            let total = c + sk;
            if total < 2 { continue; }
            let rate = if skip {
                *sk as f32 / total as f32
            } else {
                *c as f32 / total as f32
            };
            if rate > 0.5 { out.push(k.clone()); }
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

/// 用户自建歌单（摘要信息）
#[derive(Debug, Clone, serde::Serialize)]
pub struct UserPlaylist {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub track_count: u32,
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
