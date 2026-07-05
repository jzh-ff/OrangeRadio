//! Tauri 命令（暴露给前端）

use crate::AppState;
use orange_core::source::{AudioSource, SearchQuery};
use orange_core::track::Track;
use orange_library::{LibraryScanner, ScanOptions};
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// 健康检查
#[tauri::command]
pub fn ping() -> String {
    format!("OrangeRadio v{} 运行中", orange_core::VERSION)
}

/// 获取应用信息
#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "OrangeRadio".into(),
        version: orange_core::VERSION.into(),
        stage: "v0.2 播放器内核".into(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub stage: String,
}

// ===== 本地库命令 =====

/// 扫描本地音乐库
#[tauri::command]
pub async fn library_scan(
    state: tauri::State<'_, AppState>,
    root_dirs: Vec<String>,
) -> Result<ScanReport, String> {
    let options = ScanOptions {
        root_dirs,
        ..Default::default()
    };
    let scanner = LibraryScanner::new();
    let tracks = scanner.scan(&options).await.map_err(|e| e.to_string())?;
    let count = tracks.len() as u32;
    state.library.replace_all(tracks);
    Ok(ScanReport { count })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodeInfo {
    pub key: String,
    pub qr_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrStatusInfo {
    pub code: i32,
    pub message: String,
}

/// 获取本地库全部曲目
#[tauri::command]
pub async fn library_tracks(state: tauri::State<'_, AppState>) -> Result<Vec<Track>, String> {
    Ok(state.library.all())
}

/// 本地库数量
#[tauri::command]
pub async fn library_count(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    Ok(state.library.count())
}

/// 搜索（本地库）
#[tauri::command]
pub async fn search(
    state: tauri::State<'_, AppState>,
    keyword: String,
) -> Result<Vec<Track>, String> {
    let query = SearchQuery {
        keyword,
        page: 1,
        page_size: 100,
        ..Default::default()
    };
    Ok(state.library.search(&query))
}

// ===== 播放器命令（v0.2 由前端 Web Audio 实际播放，这里返回流地址）=====

/// 解析曲目的可播放流地址（本地文件 → asset 协议 URL）
#[tauri::command]
pub async fn resolve_stream(_track_path: String) -> Result<String, String> {
    Ok(_track_path)
}

/// 获取日志文件目录路径（供前端显示/打开日志）
#[tauri::command]
pub fn log_path() -> String {
    let dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(".orangeradio")
        .join("logs");
    dir.to_string_lossy().to_string()
}

// ===== 网络电台命令 =====

/// 搜索网络电台（RadioBrowser）
#[tauri::command]
pub async fn radio_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
) -> Result<Vec<Track>, String> {
    let query = SearchQuery {
        keyword,
        page: 1,
        page_size: 50,
        ..Default::default()
    };
    let result = state
        .web_radio
        .search(&query)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

/// 获取热门电台推荐
#[tauri::command]
pub async fn radio_popular(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<Track>, String> {
    state
        .web_radio
        .recommendations(limit.unwrap_or(30))
        .await
        .map_err(|e| e.to_string())
}

// ===== 网易云音乐命令 =====

/// 网易云 Cookie 登录
#[tauri::command]
pub async fn netease_login(
    state: tauri::State<'_, AppState>,
    cookie: String,
) -> Result<(), String> {
    use orange_core::AuthSource;
    state
        .netease
        .login_with_cookie(&cookie)
        .await
        .map_err(|e| e.to_string())
}

/// 网易云登出
#[tauri::command]
pub async fn netease_logout(state: tauri::State<'_, AppState>) -> Result<(), String> {
    use orange_core::AuthSource;
    state.netease.logout().await.map_err(|e| e.to_string())
}

/// 网易云是否已登录
#[tauri::command]
pub async fn netease_status(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    Ok(state.netease.is_ready())
}

/// 网易云搜索
#[tauri::command]
pub async fn netease_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
) -> Result<Vec<Track>, String> {
    use orange_core::AudioSource;
    let query = SearchQuery {
        keyword,
        page: 1,
        page_size: 30,
        ..Default::default()
    };
    let result = state
        .netease
        .search(&query)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

/// 网易云获取播放地址
#[tauri::command]
pub async fn netease_stream(
    state: tauri::State<'_, AppState>,
    track_id: String,
) -> Result<String, String> {
    use orange_core::AudioSource;
    let track = Track::new(
        state.netease.id(),
        track_id,
        orange_core::track::TrackMeta::default(),
    );
    let loc = state
        .netease
        .resolve_stream(&track)
        .await
        .map_err(|e| e.to_string())?;
    match loc {
        orange_core::StreamLocation::Url { url, .. } => Ok(url),
        _ => Err("不支持的流类型".into()),
    }
}

/// 网易云获取用户歌单
#[tauri::command]
pub async fn netease_playlists(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let list = state
        .netease
        .user_playlists()
        .await
        .map_err(|e| e.to_string())?;
    Ok(list
        .into_iter()
        .map(|(id, name, count, cover, play_count)| {
            serde_json::json!({
                "id": id, "name": name, "count": count, "cover": cover, "playCount": play_count
            })
        })
        .collect())
}

/// 网易云每日推荐
#[tauri::command]
pub async fn netease_daily(state: tauri::State<'_, AppState>) -> Result<Vec<Track>, String> {
    state.netease.daily_songs().await.map_err(|e| e.to_string())
}

/// 网易云歌单详情
#[tauri::command]
pub async fn netease_playlist_detail(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
) -> Result<Vec<Track>, String> {
    state
        .netease
        .playlist_detail(&playlist_id)
        .await
        .map_err(|e| e.to_string())
}

/// 网易云获取歌词（原文 + 翻译）
#[tauri::command]
pub async fn netease_lyric(
    state: tauri::State<'_, AppState>,
    song_id: String,
) -> Result<serde_json::Value, String> {
    let (raw_lrc, translated_lrc) = state
        .netease
        .song_lyric(&song_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "raw_lrc": raw_lrc, "translated_lrc": translated_lrc }))
}

/// 网易云获取热门评论
#[tauri::command]
pub async fn netease_comments(
    state: tauri::State<'_, AppState>,
    song_id: String,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let data = state
        .netease
        .song_comments(&song_id, limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())?;
    let hot: Vec<serde_json::Value> = data
        .hot_comments
        .iter()
        .map(|c| {
            serde_json::json!({
                "content": c.content,
                "nickname": c.nickname,
                "avatar_url": c.avatar_url,
                "liked_count": c.liked_count,
            })
        })
        .collect();
    Ok(serde_json::json!({ "total": data.total, "hot_comments": hot }))
}

/// 网易云收藏歌曲到「我喜欢的音乐」远端歌单
#[tauri::command]
pub async fn netease_like_track(
    state: tauri::State<'_, AppState>,
    song_id: String,
) -> Result<bool, String> {
    state
        .netease
        .like_track(&song_id)
        .await
        .map_err(|e| e.to_string())
}

// ===== 本地收藏 + 歌单系统 =====

/// 切换喜欢状态
#[tauri::command]
pub async fn toggle_liked(
    state: tauri::State<'_, AppState>,
    track_id: String,
    liked: bool,
) -> Result<(), String> {
    state
        .library
        .set_liked(&track_id, liked)
        .map_err(|e| e.to_string())
}

/// 喜欢的歌曲列表
#[tauri::command]
pub async fn liked_tracks(state: tauri::State<'_, AppState>) -> Result<Vec<Track>, String> {
    Ok(state.library.liked_tracks())
}

/// 创建歌单
#[tauri::command]
pub async fn create_playlist(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<String, String> {
    state
        .library
        .create_playlist(&name)
        .map_err(|e| e.to_string())
}

/// 重命名歌单
#[tauri::command]
pub async fn rename_playlist(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
    name: String,
) -> Result<(), String> {
    state
        .library
        .rename_playlist(&playlist_id, &name)
        .map_err(|e| e.to_string())
}

/// 删除歌单
#[tauri::command]
pub async fn delete_playlist(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
) -> Result<(), String> {
    state
        .library
        .delete_playlist(&playlist_id)
        .map_err(|e| e.to_string())
}

/// 添加歌曲到歌单（支持跨源：网易云歌曲也能加入）
#[tauri::command]
pub async fn add_to_playlist(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
    track: Track,
) -> Result<(), String> {
    state
        .library
        .add_to_playlist(&playlist_id, &track)
        .map_err(|e| e.to_string())
}

/// 从歌单移除歌曲
#[tauri::command]
pub async fn remove_from_playlist(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
    track_id: String,
) -> Result<(), String> {
    state
        .library
        .remove_from_playlist(&playlist_id, &track_id)
        .map_err(|e| e.to_string())
}

/// 歌单曲目列表
#[tauri::command]
pub async fn playlist_tracks(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
) -> Result<Vec<Track>, String> {
    state
        .library
        .playlist_tracks(&playlist_id)
        .map_err(|e| e.to_string())
}

/// 全部用户歌单
#[tauri::command]
pub async fn all_playlists(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<orange_library::UserPlaylist>, String> {
    state.library.all_playlists().map_err(|e| e.to_string())
}

/// 网易云生成二维码登录
#[tauri::command]
pub async fn netease_qrcode_create(
    state: tauri::State<'_, AppState>,
) -> Result<QrCodeInfo, String> {
    use orange_core::AuthSource;
    let qr = state
        .netease
        .qrcode_create()
        .await
        .map_err(|e| e.to_string())?;
    Ok(QrCodeInfo {
        key: qr.key,
        qr_url: qr.qr_image,
    })
}

/// 网易云查询二维码状态
#[tauri::command]
pub async fn netease_qrcode_check(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<QrStatusInfo, String> {
    use orange_core::AuthSource;
    let status = state
        .netease
        .qrcode_check(&key)
        .await
        .map_err(|e| e.to_string())?;
    let (code, msg) = match &status {
        orange_core::QrCodeStatus::Waiting => (801, "等待扫码".into()),
        orange_core::QrCodeStatus::Scanned => (802, "已扫码，请在手机确认".into()),
        orange_core::QrCodeStatus::Expired => (800, "二维码已过期".into()),
        orange_core::QrCodeStatus::Confirmed { .. } => (803, "登录成功".into()),
        orange_core::QrCodeStatus::Blocked { message } => (8821, message.clone()),
    };
    Ok(QrStatusInfo { code, message: msg })
}

// ===== 播客 RSS 命令 =====

/// 订阅播客 RSS（输入 URL，返回 episode 列表）
#[tauri::command]
pub async fn podcast_fetch(
    state: tauri::State<'_, AppState>,
    rss_url: String,
) -> Result<Vec<Track>, String> {
    use orange_core::AudioSource;
    let query = SearchQuery {
        keyword: rss_url,
        ..Default::default()
    };
    let result = state
        .podcast
        .search(&query)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

// ===== QQ 音乐命令 =====

#[tauri::command]
pub async fn qqmusic_login(
    state: tauri::State<'_, AppState>,
    cookie: String,
) -> Result<(), String> {
    use orange_core::AuthSource;
    state
        .qqmusic
        .login_with_cookie(&cookie)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn qqmusic_status(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    Ok(state.qqmusic.is_ready())
}

#[tauri::command]
pub async fn qqmusic_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
) -> Result<Vec<Track>, String> {
    use orange_core::AudioSource;
    let query = SearchQuery {
        keyword,
        page: 1,
        page_size: 30,
        ..Default::default()
    };
    let result = state
        .qqmusic
        .search(&query)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

#[tauri::command]
pub async fn qqmusic_stream(
    state: tauri::State<'_, AppState>,
    track_id: String,
) -> Result<String, String> {
    // 返回 `orangeradio://qqstream?url=...` 自定义协议 URL
    // 实际拉流在 Tauri 端 URI scheme handler 完成，绕开 WebView CORS
    state
        .qqmusic
        .resolve_to_file(&track_id)
        .await
        .map_err(|e| e.to_string())
}

/// QQ音乐退出登录
#[tauri::command]
pub async fn qqmusic_logout(state: tauri::State<'_, AppState>) -> Result<(), String> {
    use orange_core::AuthSource;
    state.qqmusic.logout().await.map_err(|e| e.to_string())
}

/// QQ音乐歌词
#[tauri::command]
pub async fn qqmusic_lyric(
    state: tauri::State<'_, AppState>,
    song_id: String,
) -> Result<serde_json::Value, String> {
    let (raw_lrc, translated_lrc) = state
        .qqmusic
        .song_lyric(&song_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "raw_lrc": raw_lrc, "translated_lrc": translated_lrc }))
}

/// QQ音乐热门评论
#[tauri::command]
pub async fn qqmusic_comments(
    state: tauri::State<'_, AppState>,
    song_id: String,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let (total, comments) = state
        .qqmusic
        .song_comments(&song_id, limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())?;
    let hot: Vec<serde_json::Value> = comments
        .iter()
        .map(|(c, n, a, l)| {
            serde_json::json!({
                "content": c, "nickname": n, "avatar_url": a, "liked_count": l
            })
        })
        .collect();
    Ok(serde_json::json!({ "total": total, "hot_comments": hot }))
}

/// QQ音乐用户歌单
#[tauri::command]
pub async fn qqmusic_playlists(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let list = state
        .qqmusic
        .user_playlists()
        .await
        .map_err(|e| e.to_string())?;
    Ok(list
        .into_iter()
        .map(|(id, name, count, cover)| {
            serde_json::json!({
                "id": id, "name": name, "count": count, "cover": cover
            })
        })
        .collect())
}

/// QQ音乐歌单详情
#[tauri::command]
pub async fn qqmusic_playlist_detail(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
) -> Result<Vec<Track>, String> {
    state
        .qqmusic
        .playlist_detail(&playlist_id)
        .await
        .map_err(|e| e.to_string())
}

/// QQ音乐生成扫码登录二维码
#[tauri::command]
pub async fn qqmusic_qrcode_create(
    state: tauri::State<'_, AppState>,
) -> Result<QrCodeInfo, String> {
    use orange_core::AuthSource;
    let qr = state
        .qqmusic
        .qrcode_create()
        .await
        .map_err(|e| e.to_string())?;
    Ok(QrCodeInfo {
        key: qr.key,
        qr_url: qr.qr_image,
    })
}

/// QQ音乐查询扫码状态
#[tauri::command]
pub async fn qqmusic_qrcode_check(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<QrStatusInfo, String> {
    use orange_core::AuthSource;
    let status = state
        .qqmusic
        .qrcode_check(&key)
        .await
        .map_err(|e| e.to_string())?;
    let (code, msg) = match &status {
        orange_core::QrCodeStatus::Waiting => (66, "等待扫码".into()),
        orange_core::QrCodeStatus::Scanned => (67, "已扫码，请在手机确认".into()),
        orange_core::QrCodeStatus::Expired => (65, "二维码已过期".into()),
        orange_core::QrCodeStatus::Confirmed { .. } => (0, "登录成功".into()),
        orange_core::QrCodeStatus::Blocked { message } => (8821, message.clone()),
    };
    Ok(QrStatusInfo { code, message: msg })
}

// ===== 聚合搜索 =====

/// 多源聚合搜索（并发查询所有已就绪音源）
#[tauri::command]
pub async fn search_all(
    state: tauri::State<'_, AppState>,
    keyword: String,
) -> Result<Vec<Track>, String> {
    use orange_core::{source::SearchQuery, AudioSource};
    let query = SearchQuery {
        keyword: keyword.clone(),
        kind: None,
        page: 1,
        page_size: 30,
    };

    // 本地库（同步，放 spawn_blocking）
    let lib = state.library.clone();
    let q2 = query.clone();
    let local_task = tokio::task::spawn_blocking(move || {
        lib.search(&q2).into_iter().take(50).collect::<Vec<_>>()
    });

    // QQ音乐搜索（免登录）
    let qq = state.qqmusic.clone();
    let qq_query = query.clone();
    let qq_task = tokio::time::timeout(std::time::Duration::from_secs(5), async move {
        qq.search(&qq_query).await
    });

    // 网易云（需登录）
    let netease_ready = state.netease.is_ready();
    let ne = state.netease.clone();
    let ne_query = query.clone();
    let ne_task = if netease_ready {
        Some(tokio::time::timeout(
            std::time::Duration::from_secs(5),
            async move { ne.search(&ne_query).await },
        ))
    } else {
        None
    };

    // Spotify（需配置）
    let sp_ready = state.spotify.is_ready();
    let sp = state.spotify.clone();
    let sp_query = query.clone();
    let sp_task = if sp_ready {
        Some(tokio::time::timeout(
            std::time::Duration::from_secs(5),
            async move { sp.search(&sp_query).await },
        ))
    } else {
        None
    };

    // 电台
    let radio = state.web_radio.clone();
    let radio_query = query.clone();
    let radio_task = tokio::time::timeout(std::time::Duration::from_secs(5), async move {
        radio.search(&radio_query).await
    });

    // 并发执行
    let (local_res, qq_res, ne_res, sp_res, radio_res) = tokio::join!(
        async { local_task.await.unwrap_or_default() },
        async {
            match qq_task.await {
                Ok(Ok(r)) => r.tracks,
                _ => vec![],
            }
        },
        async {
            match ne_task {
                Some(t) => match t.await {
                    Ok(Ok(r)) => r.tracks,
                    _ => vec![],
                },
                None => vec![],
            }
        },
        async {
            match sp_task {
                Some(t) => match t.await {
                    Ok(Ok(r)) => r.tracks,
                    _ => vec![],
                },
                None => vec![],
            }
        },
        async {
            match radio_task.await {
                Ok(Ok(r)) => r.tracks,
                _ => vec![],
            }
        },
    );

    let mut all = Vec::new();
    all.extend(local_res);
    all.extend(qq_res);
    all.extend(ne_res);
    all.extend(sp_res);
    all.extend(radio_res);
    tracing::info!("聚合搜索 '{}' 共 {} 条结果", keyword, all.len());
    Ok(all)
}

// ===== Spotify 命令 =====

#[tauri::command]
pub async fn spotify_configure(
    state: tauri::State<'_, AppState>,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    state
        .spotify
        .configure(&client_id, &client_secret)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn spotify_status(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    Ok(state.spotify.is_ready())
}

#[tauri::command]
pub async fn spotify_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
) -> Result<Vec<Track>, String> {
    use orange_core::AudioSource;
    let query = SearchQuery {
        keyword,
        page: 1,
        page_size: 20,
        ..Default::default()
    };
    let result = state
        .spotify
        .search(&query)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

// ===== 鉴权状态总览（settings 页用） =====

#[derive(Debug, Clone, Serialize)]
pub struct AuthStatusItem {
    pub source: String,
    pub source_name: String,
    /// 是否已登录 / 配置
    pub configured: bool,
    /// 上次保存 / 刷新时间（Unix 秒）
    pub saved_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthOverview {
    pub items: Vec<AuthStatusItem>,
}

/// 返回所有音源的鉴权状态总览（settings 页 + UI 角标用）
#[tauri::command]
pub async fn auth_overview(state: tauri::State<'_, AppState>) -> Result<AuthOverview, String> {
    use orange_core::AudioSource;

    let mut items = Vec::new();

    // 网易云
    let ne_saved = state
        .auth_store
        .get("netease")
        .await
        .map(|a| a.saved_at)
        .unwrap_or(0);
    items.push(AuthStatusItem {
        source: "netease".into(),
        source_name: "网易云音乐".into(),
        configured: state.netease.is_ready(),
        saved_at: ne_saved,
    });

    // QQ 音乐
    let qq_saved = state
        .auth_store
        .get("qqmusic")
        .await
        .map(|a| a.saved_at)
        .unwrap_or(0);
    items.push(AuthStatusItem {
        source: "qqmusic".into(),
        source_name: "QQ 音乐".into(),
        configured: state.qqmusic.is_ready(),
        saved_at: qq_saved,
    });

    // Spotify
    let sp_saved = state
        .auth_store
        .get("spotify")
        .await
        .map(|a| a.saved_at)
        .unwrap_or(0);
    items.push(AuthStatusItem {
        source: "spotify".into(),
        source_name: "Spotify".into(),
        configured: state.spotify.is_ready(),
        saved_at: sp_saved,
    });

    Ok(AuthOverview { items })
}

/// Spotify 登出（清掉 Client Credentials）
#[tauri::command]
pub async fn spotify_logout(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.spotify.logout().await.map_err(|e| e.to_string())
}

// ===== 推荐 / 懂你模式（v0.5） =====

/// 记录一次播放行为（前端切歌 / 播完时调用，驱动用户画像）
#[tauri::command]
pub async fn record_playback(
    state: tauri::State<'_, AppState>,
    track_id: String,
    played_secs: f64,
    total_secs: f64,
    completed: bool,
    skipped: bool,
) -> Result<(), String> {
    state
        .library
        .record_play_history(&track_id, played_secs, total_secs, completed, skipped)
        .map_err(|e| e.to_string())
}

/// 获取用户画像（settings / 调试用）
#[tauri::command]
pub async fn get_user_profile(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let profile = state
        .library
        .aggregate_user_profile()
        .map_err(|e| e.to_string())?;
    serde_json::to_value(profile).map_err(|e| e.to_string())
}

/// 懂你模式推荐下一首（排除最近播放 + 跳过反馈）
#[tauri::command]
pub async fn recommend_next(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
    current_track_id: Option<String>,
) -> Result<Vec<Track>, String> {
    use orange_core::recommendation::RecommendContext;
    let profile = state
        .library
        .aggregate_user_profile()
        .map_err(|e| e.to_string())?;
    let recent = state.library.recent_track_ids(20);
    let feedback = state.library.recent_feedback(20);
    let all = state.library.all();
    let current = current_track_id
        .as_ref()
        .and_then(|id| all.iter().find(|t| t.id.0.to_string() == *id).cloned());
    let n = limit.unwrap_or(1).max(1);
    let ctx = RecommendContext {
        now: chrono::Utc::now(),
        weather: None,
        mood: None,
        scene: None,
        recent_track_ids: recent,
        limit: n,
        candidates: all,
    };
    if n == 1 {
        let t = state
            .recommender
            .next_understand_you(&profile, &ctx, current.as_ref(), &feedback)
            .await
            .map_err(|e| e.to_string())?;
        Ok(vec![t])
    } else {
        state
            .recommender
            .recommend(&profile, &ctx)
            .await
            .map_err(|e| e.to_string())
    }
}

/// 分析本地音频文件的节拍图谱（驱动电影运镜预计算）。
/// 缓存到 `.orangeradio/beatmaps/<key>.json`，键 = fnv(path)+mtime+size。
/// 非本地文件（云曲）直接报错跳过。
#[tauri::command]
pub async fn analyze_beatmap(track_path: String) -> Result<serde_json::Value, String> {
    use std::path::PathBuf;
    let path = PathBuf::from(&track_path);
    if !path.is_file() {
        return Err("非本地文件，跳过节拍分析".into());
    }

    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let size = meta.len();
    let key = format!("{:x}-{}-{}", fnv_hash(&track_path), mtime, size);

    let cache_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(".orangeradio")
        .join("beatmaps");
    let _ = std::fs::create_dir_all(&cache_dir);
    let cache_file = cache_dir.join(format!("{key}.json"));

    // 命中缓存秒返
    if let Ok(data) = std::fs::read_to_string(&cache_file) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
            tracing::debug!("节拍图谱命中缓存: {key}");
            return Ok(v);
        }
    }

    // 解码 + DSP 分析（CPU 密集 → spawn_blocking，避免阻塞 tokio executor）
    let path_for_task = path.clone();
    let beatmap = tokio::task::spawn_blocking(move || -> Result<orange_audio::Beatmap, String> {
        let audio = orange_audio::decode_file(&path_for_task).map_err(|e| e.to_string())?;
        Ok(orange_audio::analyze_beatmap(&audio))
    })
    .await
    .map_err(|e| format!("分析线程失败: {e}"))?
    .map_err(|e| e)?;

    let json = serde_json::to_value(&beatmap).map_err(|e| e.to_string())?;
    if let Ok(s) = serde_json::to_string(&beatmap) {
        let _ = std::fs::write(&cache_file, s);
    }
    tracing::info!(
        "节拍图谱分析完成: {} 个 hit, BPM={:.1}",
        beatmap.hits.len(),
        beatmap.bpm
    );
    Ok(json)
}

/// FNV-1a 64bit（缓存键用，刻意不引新依赖）
fn fnv_hash(s: &str) -> u64 {
    let mut h = 0xcbf29ce484222325u64;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

// ===== Hue 灯光联动（v0.8 MVP） =====

/// 发现局域网内的 Hue Bridge（nupnp）
#[tauri::command]
pub async fn hue_discover() -> Result<Vec<serde_json::Value>, String> {
    let mgr = orange_hue::HueManager::new();
    let bridges = mgr.discover().await.map_err(|e| e.to_string())?;
    Ok(bridges.into_iter().map(|b| serde_json::json!({ "ip": b.ip })).collect())
}

/// 配对 Hue Bridge（需先按 Bridge 顶部 link button）→ 返回 username token
#[tauri::command]
pub async fn hue_pair(ip: String) -> Result<String, String> {
    let mgr = orange_hue::HueManager::new();
    mgr.pair(&ip).await.map_err(|e| e.to_string())
}

/// 设置 Hue 灯状态（on/bri/hue/sat）
#[tauri::command]
pub async fn hue_set_state(
    ip: String,
    token: String,
    light_id: String,
    on: bool,
    bri: u32,
    hue_val: u32,
    sat: u32,
) -> Result<(), String> {
    let mgr = orange_hue::HueManager::new();
    mgr.set_state(
        &ip,
        &token,
        &light_id,
        &orange_hue::LightState { on, bri, hue: hue_val, sat },
    )
    .await
    .map_err(|e| e.to_string())
}

// ===== 壁纸持久化（v0.4 P12，自定义命令避免引入 tauri-plugin-fs） =====

/// 把用户选择的壁纸文件复制到 {app_data_dir}/wallpapers/{timestamp}-{name}，返回目标路径。
/// 前端用 convertFileSrc(返回路径) 转成 webview 可访问的 URL。
#[tauri::command]
pub fn wallpaper_save(
    app: tauri::AppHandle,
    src_path: String,
    name: String,
) -> Result<String, String> {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 data_dir 失败: {e}"))?;
    let wallpapers_dir = data_dir.join("wallpapers");
    fs::create_dir_all(&wallpapers_dir).map_err(|e| format!("创建 wallpapers 目录失败: {e}"))?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // 安全文件名：只保留字母数字汉字和点横下划线，避免路径穿越
    let safe_name: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_' || ('\u{4e00}'..='\u{9fff}').contains(c))
        .collect();
    let safe_name = if safe_name.is_empty() { "wallpaper".to_string() } else { safe_name };
    let dest = wallpapers_dir.join(format!("{ts}-{safe_name}"));
    fs::copy(&src_path, &dest).map_err(|e| format!("复制壁纸文件失败: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// 删除已保存的壁纸文件（用户从壁纸库移除时调用）
#[tauri::command]
pub fn wallpaper_remove(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("删除壁纸文件失败: {e}"))
}

// ===== AI 歌词译注（v0.5，用 MiniMax LLM） =====

/// 用 MiniMax LLM 翻译并注解歌词（base/key/model 由前端配置传入，存 localStorage）
#[tauri::command]
pub async fn lyric_annotate(
    lyrics: String,
    source_lang: Option<String>,
    api_base: String,
    api_key: String,
    model: String,
) -> Result<serde_json::Value, String> {
    use orange_ai::provider::{LlmProvider, MinimaxProvider};
    use orange_ai::LyricsTranslator;
    let llm: std::sync::Arc<dyn LlmProvider> =
        std::sync::Arc::new(MinimaxProvider::new(api_base, api_key, model));
    let translator = LyricsTranslator::new(llm);
    let annotated = translator
        .translate(&lyrics, &source_lang.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&annotated).map_err(|e| e.to_string())
}

/// 分析歌词情绪（MiniMax LLM）→ {mood, reason}，可用于推荐/视觉配色
#[tauri::command]
pub async fn emotion_analyze(
    lyrics: String,
    api_base: String,
    api_key: String,
    model: String,
) -> Result<serde_json::Value, String> {
    use orange_ai::provider::{LlmProvider, LlmRequest, MinimaxProvider};
    let llm: std::sync::Arc<dyn LlmProvider> =
        std::sync::Arc::new(MinimaxProvider::new(api_base, api_key, model));
    let req = LlmRequest {
        system: Some("你是音乐情绪分析 AI。".into()),
        user: format!(
            "分析下面歌词的整体情绪，只输出 JSON：{{\"mood\":\"happy|sad|calm|energetic|focused|romantic|nostalgic|melancholy\",\"reason\":\"一句话理由\"}}\n\n歌词：\n{}",
            lyrics
        ),
        temperature: Some(0.2),
        max_tokens: Some(256),
    };
    let resp = llm.chat(&req).await.map_err(|e| e.to_string())?;
    let text = resp.text;
    let json = match (text.find('{'), text.rfind('}')) {
        (Some(s), Some(e)) => text[s..=e].to_string(),
        _ => text,
    };
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())
}

// ===== OrangeStudio AI 创作工作站（v0.6，MiniMax） =====

/// 工作室缓存目录（{app_data_dir}/studio/），用于存放生成的音频和工程文件
fn studio_cache_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 data_dir 失败: {e}"))?;
    let dir = data_dir.join("studio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 studio 目录失败: {e}"))?;
    Ok(dir)
}

/// AI 写词 → 结构化歌词草稿
///
/// `api_base` / `api_key` / `model` 对应 LLM 端点（Anthropic 兼容），
/// 通常和「歌词译注」用同一套配置（`orangeradio_minimax_*`）。
#[tauri::command]
pub async fn studio_generate_lyrics(
    theme: String,
    mood: String,
    style: String,
    language: String,
    api_base: String,
    api_key: String,
    model: String,
) -> Result<serde_json::Value, String> {
    use orange_studio::{LyricsGenerator, LyricsRequest};
    if api_key.is_empty() {
        return Err("未配置 MiniMax API Key，请先在设置中填写".into());
    }
    let generator = LyricsGenerator::new(api_base, api_key, model);
    let request = LyricsRequest {
        theme,
        mood,
        style,
        language,
        ..Default::default()
    };
    let draft = generator.generate(&request).await.map_err(|e| e.to_string())?;
    serde_json::to_value(&draft).map_err(|e| e.to_string())
}

/// 音乐生成 → 本地 mp3 路径
///
/// 调用 MiniMax music_generation（同步接口，约 30-90 秒）。
/// 返回的 `audio_path` 是本地缓存文件路径，前端用 `convertFileSrc` 播放。
#[tauri::command]
pub async fn studio_generate_music(
    app: tauri::AppHandle,
    prompt: String,
    lyrics: Option<String>,
    is_instrumental: Option<bool>,
    api_base: String,
    api_key: String,
    model: String,
) -> Result<serde_json::Value, String> {
    use orange_studio::{AudioAIProvider, GenerationRequest, MiniMaxProvider};
    if api_key.is_empty() {
        return Err("未配置 MiniMax API Key，请先在设置中填写".into());
    }
    let provider = MiniMaxProvider::new(api_key, api_base, model);
    let request = GenerationRequest {
        style_prompt: prompt,
        duration_secs: None,
        need_stems: false,
        lyrics,
        reference_audio_url: None,
        params: serde_json::json!({ "is_instrumental": is_instrumental.unwrap_or(false) }),
    };
    let result = provider
        .generate(&request)
        .await
        .map_err(|e| e.to_string())?;
    let audio_url = result.audio_url.ok_or_else(|| "MiniMax 未返回音频".to_string())?;

    // 下载到本地缓存
    let cache_dir = studio_cache_dir(&app)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = cache_dir.join(format!("{ts}-{task_id}.mp3", task_id = result.task_id));
    let audio_path = provider
        .download_audio(&audio_url, &dest)
        .await
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "audio_path": audio_path,
        "task_id": result.task_id,
    }))
}

/// 人声/伴奏分轨 → 两个本地 mp3 路径
///
/// **注意**：此命令会调用 MiniMax **两次**（带唱 + 纯伴奏），消耗双倍额度。
/// 两次生成基于同一 prompt，但旋律/编曲会有随机差异（适合试听，非精确分离）。
#[tauri::command]
pub async fn studio_separate_vocal(
    app: tauri::AppHandle,
    prompt: String,
    lyrics: Option<String>,
    api_base: String,
    api_key: String,
    model: String,
) -> Result<serde_json::Value, String> {
    use orange_studio::{MiniMaxProvider, StemSeparator};
    if api_key.is_empty() {
        return Err("未配置 MiniMax API Key，请先在设置中填写".into());
    }
    let provider = MiniMaxProvider::new(api_key, api_base, model);
    let separator = StemSeparator::new(Box::new(provider));
    let stems = separator
        .separate(&prompt, lyrics.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    // 下载两轨到本地缓存（provider 在 separator 内部已 drop，这里单独构造仅用于下载）
    let cache_dir = studio_cache_dir(&app)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let downloader = MiniMaxProvider::new("", "", "");
    let vocals_path = match stems.vocals.as_deref() {
        Some(url) if url.starts_with("http") => {
            let dest = cache_dir.join(format!("{ts}-vocals.mp3"));
            downloader
                .download_audio(url, &dest)
                .await
                .map_err(|e| e.to_string())?
        }
        Some(p) => p.to_string(),
        None => return Err("人声轨生成失败".into()),
    };
    let instrumental_path = match stems.other.as_deref() {
        Some(url) if url.starts_with("http") => {
            let dest = cache_dir.join(format!("{ts}-instrumental.mp3"));
            downloader
                .download_audio(url, &dest)
                .await
                .map_err(|e| e.to_string())?
        }
        Some(p) => p.to_string(),
        None => return Err("伴奏轨生成失败".into()),
    };

    Ok(serde_json::json!({
        "vocals_path": vocals_path,
        "instrumental_path": instrumental_path,
    }))
}

/// 保存创作工程到 `.orp` 文件
///
/// `project_json` 是前端序列化的完整 StudioProject JSON。
/// `name` 用于生成文件名（安全过滤）。
/// 返回保存的文件绝对路径。
#[tauri::command]
pub fn studio_project_save(
    app: tauri::AppHandle,
    project_json: serde_json::Value,
    name: String,
) -> Result<String, String> {
    use orange_studio::StudioProject;
    let project: StudioProject =
        serde_json::from_value(project_json).map_err(|e| format!("解析工程 JSON 失败: {e}"))?;
    let cache_dir = studio_cache_dir(&app)?;
    // 安全文件名
    let safe_name: String = name
        .chars()
        .filter(|c| {
            c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_'
                || ('\u{4e00}'..='\u{9fff}').contains(c)
        })
        .collect();
    let safe_name = if safe_name.is_empty() {
        "untitled".to_string()
    } else {
        safe_name
    };
    let dest = cache_dir.join(format!("{safe_name}.orp"));
    project
        .save_to_path(&dest)
        .map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// 从 `.orp` 文件加载创作工程
#[tauri::command]
pub fn studio_project_load(path: String) -> Result<serde_json::Value, String> {
    use orange_studio::StudioProject;
    let project =
        StudioProject::load_from_path(std::path::Path::new(&path)).map_err(|e| e.to_string())?;
    serde_json::to_value(&project).map_err(|e| e.to_string())
}

/// 注册所有命令到 Tauri Builder
pub fn register_all(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    let state = AppState::default();
    // 取出要延迟启动的引用 —— AppState::default() 同步上下文没有 tokio runtime，
    // 后台 spawn 必须在 Tauri runtime 起来后才能调（见 .setup()）
    let auth_sink = state.auth_sink.clone();
    let netease_for_loop = state.netease.clone();
    let qqmusic_for_loop = state.qqmusic.clone();
    let spotify_for_resume = state.spotify.clone();

    builder
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            ping,
            app_info,
            library_scan,
            library_tracks,
            library_count,
            search,
            resolve_stream,
            log_path,
            radio_search,
            radio_popular,
            netease_login,
            netease_logout,
            netease_status,
            netease_search,
            netease_stream,
            netease_playlists,
            netease_daily,
            netease_playlist_detail,
            netease_lyric,
            netease_comments,
            netease_like_track,
            netease_qrcode_create,
            netease_qrcode_check,
            toggle_liked,
            liked_tracks,
            create_playlist,
            rename_playlist,
            delete_playlist,
            add_to_playlist,
            remove_from_playlist,
            playlist_tracks,
            all_playlists,
            podcast_fetch,
            qqmusic_login,
            qqmusic_logout,
            qqmusic_status,
            qqmusic_search,
            qqmusic_stream,
            qqmusic_lyric,
            qqmusic_comments,
            qqmusic_playlists,
            qqmusic_playlist_detail,
            qqmusic_qrcode_create,
            qqmusic_qrcode_check,
            search_all,
            spotify_configure,
            spotify_status,
            spotify_search,
            spotify_logout,
            auth_overview,
            record_playback,
            get_user_profile,
            recommend_next,
            analyze_beatmap,
            hue_discover,
            hue_pair,
            hue_set_state,
            wallpaper_save,
            wallpaper_remove,
            lyric_annotate,
            emotion_analyze,
            studio_generate_lyrics,
            studio_generate_music,
            studio_separate_vocal,
            studio_project_save,
            studio_project_load,
        ])
        .setup(move |app| {
            // ⚠️ Tauri 2 的 setup 闭包本身是**同步上下文**——`tokio::spawn` 会 panic。
            // 必须用 `tauri::async_runtime::spawn`（内部 `RUNTIME.get_or_init(default_runtime)`），
            // 它能保证有 tokio runtime 可用。
            use tauri::async_runtime as rt;

            // 1. 注入 AppHandle 到 auth 过期事件 sink（同步操作 OK）
            auth_sink.set_handle(app.handle().clone());

            // 2. 启动网易云后台健康检查（每 6h 验证 cookie）
            //    run_health_loop 本身是 async，整个 loop 在 worker 上跑
            rt::spawn(async move {
                netease_for_loop.run_health_loop().await;
            });

            // 3. 启动 QQ 音乐后台自动续期（每 12h 刷 musickey）
            rt::spawn(async move {
                qqmusic_for_loop.run_refresh_loop().await;
            });

            // 4. 启动 Spotify 凭据恢复（如果 AuthStore 有 Client ID/Secret，自动拿 token）
            rt::spawn(async move {
                if let Err(e) = spotify_for_resume.resume_from_store().await {
                    tracing::warn!("Spotify 凭据恢复失败: {}", e);
                }
            });

            Ok(())
        })
}
