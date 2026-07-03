//! Tauri 命令（暴露给前端）

use crate::AppState;
use orange_core::source::{AudioSource, SearchQuery};
use orange_core::track::Track;
use orange_library::{LibraryScanner, ScanOptions};
use serde::{Deserialize, Serialize};

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
    let tracks = scanner
        .scan(&options)
        .await
        .map_err(|e| e.to_string())?;
    let count = tracks.len() as u32;
    state.library.replace_all(tracks);
    Ok(ScanReport { count })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub count: u32,
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
    state.netease.login_with_cookie(&cookie).await.map_err(|e| e.to_string())
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
    let result = state.netease.search(&query).await.map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

/// 网易云获取播放地址
#[tauri::command]
pub async fn netease_stream(
    state: tauri::State<'_, AppState>,
    track_id: String,
) -> Result<String, String> {
    use orange_core::AudioSource;
    // 构造临时 Track 来调用 resolve_stream
    let track = Track::new(
        state.netease.id(),
        track_id,
        orange_core::track::TrackMeta::default(),
    );
    let loc = state.netease.resolve_stream(&track).await.map_err(|e| e.to_string())?;
    match loc {
        orange_core::StreamLocation::Url { url, .. } => Ok(url),
        _ => Err("不支持的流类型".into()),
    }
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
    let result = state.podcast.search(&query).await.map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

// ===== QQ 音乐命令 =====

#[tauri::command]
pub async fn qqmusic_login(
    state: tauri::State<'_, AppState>,
    cookie: String,
) -> Result<(), String> {
    use orange_core::AuthSource;
    state.qqmusic.login_with_cookie(&cookie).await.map_err(|e| e.to_string())
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
    let query = SearchQuery { keyword, page: 1, page_size: 30, ..Default::default() };
    let result = state.qqmusic.search(&query).await.map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

#[tauri::command]
pub async fn qqmusic_stream(
    state: tauri::State<'_, AppState>,
    track_id: String,
) -> Result<String, String> {
    use orange_core::AudioSource;
    let track = Track::new(state.qqmusic.id(), track_id, orange_core::track::TrackMeta::default());
    let loc = state.qqmusic.resolve_stream(&track).await.map_err(|e| e.to_string())?;
    match loc {
        orange_core::StreamLocation::Url { url, .. } => Ok(url),
        _ => Err("不支持的流类型".into()),
    }
}

// ===== Spotify 命令 =====

#[tauri::command]
pub async fn spotify_configure(
    state: tauri::State<'_, AppState>,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    state.spotify.configure(&client_id, &client_secret).await.map_err(|e| e.to_string())
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
    let query = SearchQuery { keyword, page: 1, page_size: 20, ..Default::default() };
    let result = state.spotify.search(&query).await.map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

/// 注册所有命令到 Tauri Builder
pub fn register_all(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .manage(AppState::default())
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
            podcast_fetch,
            qqmusic_login,
            qqmusic_status,
            qqmusic_search,
            qqmusic_stream,
            spotify_configure,
            spotify_status,
            spotify_search,
        ])
}
