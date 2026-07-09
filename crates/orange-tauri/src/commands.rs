//! Tauri 命令（暴露给前端）

use crate::AppState;
use orange_core::source::{AudioSource, SearchQuery};
use orange_core::track::{Track, TrackMeta};
use orange_library::{LibraryScanner, ScanOptions};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

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
        stage: "v0.3 音源生态".into(),
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
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    root_dirs: Vec<String>,
) -> Result<ScanReport, String> {
    let options = ScanOptions {
        root_dirs,
        ..Default::default()
    };
    // 封面提取目录走 app.path().app_data_dir()（macOS 落 ~/Library/Application Support/...），
    // 避免 macOS release 模式下从 CWD 兜底失败。
    let covers_dir = crate::app_data_subdir(&app, "covers")?;
    let scanner = LibraryScanner::with_covers_dir(covers_dir);
    let tracks = scanner.scan(&options).await.map_err(|e| e.to_string())?;
    let count = tracks.len() as u32;
    // SQLite 持久化（persist_local 逐条 INSERT）是同步阻塞 IO，
    // 放进 spawn_blocking 避免占住 tokio worker（大库 + 慢盘时尤为关键）
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || library.replace_all(tracks))
        .await
        .map_err(|e| e.to_string())?;
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

/// 获取本地库全部曲目（支持分页：不传参返回全量；传 offset+limit 则分页）
/// filter 可选："liked" 只返回收藏，"local" 只返回本地来源。
#[tauri::command]
pub async fn library_tracks(
    state: tauri::State<'_, AppState>,
    offset: Option<usize>,
    limit: Option<usize>,
    filter: Option<String>,
) -> Result<Vec<Track>, String> {
    match (offset, limit) {
        (Some(o), Some(l)) => Ok(state.library.query_paged(o, l, filter.as_deref())),
        _ => {
            let mut tracks = state.library.all();
            match filter.as_deref() {
                Some("liked") => tracks.retain(|t| t.liked),
                Some("local") => {
                    tracks.retain(|t| t.source_kind == orange_core::source::SourceKind::Local)
                }
                _ => {}
            }
            Ok(tracks)
        }
    }
}

/// 本地库数量
#[tauri::command]
pub async fn library_count(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    Ok(state.library.count())
}

/// 搜索（本地库，支持分页，page 默认 1）
#[tauri::command]
pub async fn search(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    let query = SearchQuery {
        keyword,
        page: page.unwrap_or(1),
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
pub fn log_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = crate::app_data_subdir(&app, "logs")?;
    Ok(dir.to_string_lossy().to_string())
}

// ===== 网络电台命令 =====

/// 搜索网络电台（RadioBrowser，支持分页，page 默认 1）
#[tauri::command]
pub async fn radio_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    let query = SearchQuery {
        keyword,
        page: page.unwrap_or(1),
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

// ===== 歌曲宝命令（第三方聚合音源，无需登录） =====

/// 搜索歌曲宝（支持分页，page 默认 1）
#[tauri::command]
pub async fn gequbao_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    let query = SearchQuery {
        keyword,
        page: page.unwrap_or(1),
        page_size: 50,
        ..Default::default()
    };
    let result = state
        .gequbao
        .search(&query)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

/// 获取歌曲宝真实播放 URL（两步：详情页取 play_id → 换 mp3 直链）
///
/// `song_path` 是 Track.source_track_id（形如 `music/39466`）。
#[tauri::command]
pub async fn gequbao_stream(
    state: tauri::State<'_, AppState>,
    song_path: String,
) -> Result<String, String> {
    use orange_core::source::AudioSource;
    // 构造最小 Track 供 resolve_stream 使用（只需 source_track_id + source_id）
    let track = Track::new(
        state.gequbao.id(),
        song_path,
        orange_core::track::TrackMeta::default(),
    );
    match state
        .gequbao
        .resolve_stream(&track)
        .await
        .map_err(|e| e.to_string())?
    {
        orange_core::source::StreamLocation::Url { url, .. } => Ok(url),
        _ => Err("歌曲宝返回了非 URL 流地址".into()),
    }
}

/// 获取歌曲宝推荐（首页 /hot-music）
#[tauri::command]
pub async fn gequbao_popular(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<Track>, String> {
    state
        .gequbao
        .recommendations(limit.unwrap_or(30))
        .await
        .map_err(|e| e.to_string())
}

// ===== 酷我音乐命令（第三方公开接口，无需登录） =====

/// 搜索酷我音乐（支持分页，page 默认 1）
#[tauri::command]
pub async fn kuwo_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    let query = SearchQuery {
        keyword,
        page: page.unwrap_or(1),
        page_size: 50,
        ..Default::default()
    };
    let result = state.kuwo.search(&query).await.map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

/// 获取酷我音乐真实播放 URL
///
/// `rid` 是 Track.source_track_id（酷我歌曲 ID）。
#[tauri::command]
pub async fn kuwo_stream(state: tauri::State<'_, AppState>, rid: String) -> Result<String, String> {
    use orange_core::source::AudioSource;
    let track = Track::new(
        state.kuwo.id(),
        rid,
        orange_core::track::TrackMeta::default(),
    );
    match state
        .kuwo
        .resolve_stream(&track)
        .await
        .map_err(|e| e.to_string())?
    {
        orange_core::source::StreamLocation::Url { url, .. } => Ok(url),
        _ => Err("酷我返回了非 URL 流地址".into()),
    }
}

/// 酷我音乐热门推荐
#[tauri::command]
pub async fn kuwo_popular(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<Track>, String> {
    state
        .kuwo
        .recommendations(limit.unwrap_or(30))
        .await
        .map_err(|e| e.to_string())
}

/// 酷我音乐榜单详情
#[tauri::command]
pub async fn kuwo_chart_detail(
    state: tauri::State<'_, AppState>,
    bang_id: String,
    limit: Option<u32>,
) -> Result<Vec<Track>, String> {
    state
        .kuwo
        .chart_detail(&bang_id, limit.unwrap_or(30))
        .await
        .map_err(|e| e.to_string())
}

/// 酷我音乐歌词
#[tauri::command]
pub async fn kuwo_lyric(
    state: tauri::State<'_, AppState>,
    rid: String,
) -> Result<serde_json::Value, String> {
    let raw = state
        .kuwo
        .song_lyric(&rid)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(serde_json::json!({ "raw_lrc": raw, "translated_lrc": null }))
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

/// 网易云内嵌浏览器登录
///
/// 打开 music.163.com 登录页，用户扫码/账号密码登录后，后台轮询检测 Cookie 中的 MUSIC_U。
/// 检测到有效登录态后自动完成授权并关闭窗口；用户手动关闭窗口则返回取消错误。
#[tauri::command]
pub async fn netease_login_with_webview(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use orange_core::AuthSource;
    use tauri::webview::PageLoadEvent;
    use tauri::{Manager, WindowEvent};

    const WINDOW_LABEL: &str = "netease-login";
    const LOGIN_URL: &str = "https://music.163.com/#/login";
    const CHECK_INTERVAL_MS: u64 = 1200;

    // 如果已经存在旧窗口，先关掉，避免重复
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        let _ = existing.close();
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

    let tx_close = tx.clone();

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        WINDOW_LABEL,
        tauri::WebviewUrl::External(LOGIN_URL.parse().unwrap()),
    )
    .title("网易云音乐登录")
    .inner_size(900.0, 700.0)
    .min_inner_size(800.0, 600.0)
    .center()
    .resizable(true)
    .on_page_load(move |window, payload| {
        if payload.event() != PageLoadEvent::Finished {
            return;
        }
        let url = payload.url();
        if url.host_str() != Some("music.163.com") {
            return;
        }

        // 页面加载后自动点击"登录"/"立即登录"按钮，触发显示二维码
        let _ = window.eval(
            r#"
            setTimeout(function() {
                var docs = [document];
                document.querySelectorAll('iframe').forEach(function(frame) {
                    try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
                });
                for (var i = 0; i < docs.length; i++) {
                    var nodes = Array.from(docs[i].querySelectorAll('a, button, span, div'));
                    var loginNode = nodes.find(function(n) {
                        var text = (n.textContent || '').trim();
                        return /登录|立即登录/.test(text) && n.getBoundingClientRect().width > 0;
                    });
                    if (loginNode) { loginNode.click(); return; }
                }
            }, 900);
            "#,
        );
    })
    .build()
    .map_err(|e| e.to_string())?;

    // 后台轮询 cookie：Tauri 的 WebviewWindow::cookies() 能读取包括 HttpOnly 在内的全部 cookie
    // Windows 上必须在独立线程（spawn_blocking）调用，否则可能死锁
    let window_poll = window.clone();
    let state_poll = state.netease.clone();
    let tx_poll = tx.clone();
    let poll_handle = tauri::async_runtime::spawn(async move {
        let mut interval =
            tokio::time::interval(std::time::Duration::from_millis(CHECK_INTERVAL_MS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;

            let window = window_poll.clone();
            let cookie_header = match tokio::task::spawn_blocking(move || {
                let cookies = window.cookies().ok()?;
                let music_u_value = cookies
                    .iter()
                    .find(|c| c.name() == "MUSIC_U")
                    .map(|c| c.value().to_string())?;
                let mut parts: Vec<String> = cookies
                    .into_iter()
                    .filter(|c| !c.name().is_empty() && !c.value().is_empty())
                    .map(|c| format!("{}={}", c.name(), c.value()))
                    .collect();
                // 把 MUSIC_U 放到最前面，方便后续解析
                parts.retain(|p| !p.starts_with("MUSIC_U="));
                parts.insert(0, format!("MUSIC_U={}", music_u_value));
                Some(parts.join("; "))
            })
            .await
            {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!("网易云登录 cookie 读取线程出错: {}", e);
                    None
                }
            };

            if let Some(cookie) = cookie_header {
                let result = state_poll
                    .login_with_cookie(&cookie)
                    .await
                    .map_err(|e| e.to_string());
                let _ = window_poll.close();
                if let Some(tx) = tx_poll.lock().unwrap().take() {
                    let _ = tx.send(result);
                }
                return;
            }
        }
    });

    // 用户手动关闭窗口时兜底：如果还没拿到有效 cookie，返回取消错误
    let window_close = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            poll_handle.abort();
            let _ = window_close.close();
            if let Some(tx) = tx_close.lock().unwrap().take() {
                let _ = tx.send(Err("登录窗口已关闭".into()));
            }
        }
    });

    rx.await.map_err(|e| e.to_string())?
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

/// 网易云当前登录用户信息
#[tauri::command]
pub async fn netease_current_user(
    state: tauri::State<'_, AppState>,
) -> Result<Option<orange_core::source::UserInfo>, String> {
    use orange_core::AuthSource;
    state
        .netease
        .current_user()
        .await
        .map_err(|e| e.to_string())
}

/// 网易云当前播放音质
#[tauri::command]
pub async fn netease_get_quality(state: tauri::State<'_, AppState>) -> Result<String, String> {
    Ok(state.netease.quality().await)
}

/// 网易云设置播放音质
#[tauri::command]
pub async fn netease_set_quality(
    state: tauri::State<'_, AppState>,
    level: String,
) -> Result<(), String> {
    state.netease.set_quality(&level).await;
    Ok(())
}

/// 网易云搜索（支持分页，page 默认 1）
#[tauri::command]
pub async fn netease_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    use orange_core::AudioSource;
    let query = SearchQuery {
        keyword,
        page: page.unwrap_or(1),
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

/// 网易云官方排行榜列表
#[tauri::command]
pub async fn netease_toplists(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<(String, String, String, u64)>, String> {
    state.netease.toplists().await.map_err(|e| e.to_string())
}

/// 网易云排行榜详情（歌曲列表）
#[tauri::command]
pub async fn netease_toplist_detail(
    state: tauri::State<'_, AppState>,
    toplist_id: String,
) -> Result<Vec<Track>, String> {
    state
        .netease
        .toplist_detail(&toplist_id)
        .await
        .map_err(|e| e.to_string())
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

/// 网易云添加歌曲到任意用户歌单（自建/收藏的远端歌单，不含「我喜欢的音乐」）
#[tauri::command]
pub async fn netease_add_track_to_playlist(
    state: tauri::State<'_, AppState>,
    playlist_id: i64,
    song_id: String,
) -> Result<bool, String> {
    state
        .netease
        .add_track_to_playlist(playlist_id, &song_id)
        .await
        .map_err(|e| e.to_string())
}

// ===== 本地收藏 + 歌单系统 =====

/// 切换喜欢状态
#[tauri::command]
pub async fn toggle_liked(
    state: tauri::State<'_, AppState>,
    track: Track,
    liked: bool,
) -> Result<(), String> {
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || library.set_liked(&track, liked))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 添加到默认“我的收藏”歌单
#[tauri::command]
pub async fn add_to_favorites(
    state: tauri::State<'_, AppState>,
    track: Track,
) -> Result<(), String> {
    let source_track_id = track.source_track_id.clone();
    let source_kind = track.source_kind;
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || {
        library.add_to_playlist(orange_library::FAVORITES_PLAYLIST_ID, &track)?;
        library.set_liked(&track, true)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // 网易云曲目额外同步到远端“我喜欢的音乐”
    if source_kind == orange_core::source::SourceKind::NeteaseCloudMusic {
        state
            .netease
            .like_track(&source_track_id)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 从默认“我的收藏”歌单移除
#[tauri::command]
pub async fn remove_from_favorites(
    state: tauri::State<'_, AppState>,
    track: Track,
) -> Result<(), String> {
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || library.set_liked(&track, false))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 获取默认“我的收藏”歌单信息
#[tauri::command]
pub async fn favorites_playlist(
    state: tauri::State<'_, AppState>,
) -> Result<Option<orange_library::UserPlaylist>, String> {
    state
        .library
        .favorites_playlist()
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
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || library.create_playlist(&name))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 重命名歌单
#[tauri::command]
pub async fn rename_playlist(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
    name: String,
) -> Result<(), String> {
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || library.rename_playlist(&playlist_id, &name))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 删除歌单
#[tauri::command]
pub async fn delete_playlist(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
) -> Result<(), String> {
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || library.delete_playlist(&playlist_id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 添加歌曲到歌单（支持跨源：网易云歌曲也能加入）
#[tauri::command]
pub async fn add_to_playlist(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
    track: Track,
) -> Result<(), String> {
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || library.add_to_playlist(&playlist_id, &track))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 从歌单移除歌曲
#[tauri::command]
pub async fn remove_from_playlist(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
    track_id: String,
) -> Result<(), String> {
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || library.remove_from_playlist(&playlist_id, &track_id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// 歌单曲目列表（支持分页：不传参返回全量；传 offset+limit 则分页）
#[tauri::command]
pub async fn playlist_tracks(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<Track>, String> {
    let library = state.library.clone();
    // SQLite JOIN + 分页在阻塞线程里完成
    let tracks =
        tokio::task::spawn_blocking(move || library.playlist_tracks(&playlist_id, offset, limit))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    Ok(tracks)
}

/// 全部用户歌单
#[tauri::command]
pub async fn all_playlists(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<orange_library::UserPlaylist>, String> {
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || library.all_playlists())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
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
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    use orange_core::AudioSource;
    let query = SearchQuery {
        keyword,
        page: page.unwrap_or(1),
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

// ===== 酷狗音乐命令 =====

#[tauri::command]
pub async fn kugou_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    use orange_core::AudioSource;
    let query = SearchQuery {
        keyword,
        page: page.unwrap_or(1),
        page_size: 30,
        ..Default::default()
    };
    let result = state
        .kugou
        .search(&query)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

#[tauri::command]
pub async fn kugou_stream(
    state: tauri::State<'_, AppState>,
    track_id: String,
) -> Result<String, String> {
    use orange_core::AudioSource;
    let track = Track::new(
        state.kugou.id(),
        track_id,
        orange_core::track::TrackMeta::default(),
    );
    let loc = state
        .kugou
        .resolve_stream(&track)
        .await
        .map_err(|e| e.to_string())?;
    match loc {
        orange_core::StreamLocation::Url { url, .. } => Ok(url),
        _ => Err("不支持的流类型".into()),
    }
}

#[tauri::command]
pub async fn kugou_login(state: tauri::State<'_, AppState>, cookie: String) -> Result<(), String> {
    use orange_core::AuthSource;
    state
        .kugou
        .login_with_cookie(&cookie)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kugou_logout(state: tauri::State<'_, AppState>) -> Result<(), String> {
    use orange_core::AuthSource;
    state.kugou.logout().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kugou_status(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    Ok(state.kugou.is_ready())
}

#[tauri::command]
pub async fn kugou_current_user(
    state: tauri::State<'_, AppState>,
) -> Result<Option<orange_core::UserInfo>, String> {
    use orange_core::AuthSource;
    state.kugou.current_user().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kugou_playlists(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<orange_core::PlaylistRef>, String> {
    use orange_core::AudioSource;
    state
        .kugou
        .user_playlists()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kugou_playlist_detail(
    state: tauri::State<'_, AppState>,
    playlist_id: String,
) -> Result<Vec<Track>, String> {
    state
        .kugou
        .playlist_detail(&playlist_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kugou_lyric(
    state: tauri::State<'_, AppState>,
    song_id: String,
) -> Result<serde_json::Value, String> {
    let parts: Vec<&str> = song_id.split('|').collect();
    let hash = parts.first().copied().unwrap_or("").trim();
    let album_id = parts.get(1).copied();
    if hash.is_empty() {
        return Err("酷狗歌曲缺少 hash".into());
    }
    let raw = state
        .kugou
        .song_lyric(hash, album_id)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(serde_json::json!({ "raw_lrc": raw, "translated_lrc": null }))
}

// ===== 汽水音乐命令 =====

#[tauri::command]
pub async fn qishui_search(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    use orange_core::AudioSource;
    let query = SearchQuery {
        keyword,
        page: page.unwrap_or(1),
        page_size: 30,
        ..Default::default()
    };
    let result = state
        .qishui
        .search(&query)
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.tracks)
}

#[tauri::command]
pub async fn qishui_stream(
    state: tauri::State<'_, AppState>,
    track_id: String,
) -> Result<String, String> {
    use orange_core::AudioSource;
    let track = Track::new(
        state.qishui.id(),
        track_id,
        orange_core::track::TrackMeta::default(),
    );
    let loc = state
        .qishui
        .resolve_stream(&track)
        .await
        .map_err(|e| e.to_string())?;
    match loc {
        orange_core::StreamLocation::Url { url, .. } => Ok(url),
        _ => Err("不支持的流类型".into()),
    }
}

#[tauri::command]
pub async fn qishui_status(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    Ok(state.qishui.is_ready())
}

// ===== 聚合搜索 =====

/// 多源聚合搜索（遍历源注册表，并发查询所有已就绪音源，支持分页，page 默认 1）
#[tauri::command]
pub async fn search_all(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    use std::sync::Arc;
    let query = Arc::new(SearchQuery {
        keyword: keyword.clone(),
        kind: None,
        page: page.unwrap_or(1),
        page_size: 50,
    });

    // 本地库（同步 DB 查询，放 spawn_blocking）
    let lib = state.library.clone();
    let q_local = (*query).clone();
    let local_task = tokio::task::spawn_blocking(move || lib.search(&q_local));

    // 遍历源注册表，为每个就绪音源起一个并发搜索任务
    let sources = state.sources.list();
    let mut futures = Vec::with_capacity(sources.len());
    for src in sources {
        if !src.is_ready() {
            continue;
        }
        let q = (*query).clone();
        futures.push(async move {
            match tokio::time::timeout(std::time::Duration::from_secs(5), src.search(&q)).await {
                Ok(Ok(r)) => r.tracks,
                _ => vec![],
            }
        });
    }

    // 并发执行所有网络源 + 本地库
    let mut all = local_task.await.unwrap_or_default();
    // 用 tokio JoinSet 并发跑所有网络源搜索（避免引入 futures crate 依赖）
    let mut set = tokio::task::JoinSet::new();
    for f in futures {
        set.spawn(f);
    }
    while let Some(res) = set.join_next().await {
        if let Ok(tracks) = res {
            all.extend(tracks);
        }
    }
    tracing::info!("聚合搜索 '{}' 共 {} 条结果", keyword, all.len());
    Ok(all)
}

/// 截断字符串，用于日志输出避免大对象
fn trunc(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "..."
    }
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
    page: Option<u32>,
) -> Result<Vec<Track>, String> {
    use orange_core::AudioSource;
    let query = SearchQuery {
        keyword,
        page: page.unwrap_or(1),
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

    // 酷狗音乐
    let kg_saved = state
        .auth_store
        .get("kugou")
        .await
        .map(|a| a.saved_at)
        .unwrap_or(0);
    items.push(AuthStatusItem {
        source: "kugou".into(),
        source_name: "酷狗音乐".into(),
        configured: state.kugou.is_ready(),
        saved_at: kg_saved,
    });

    // 汽水音乐
    let qs_saved = state
        .auth_store
        .get("qishui")
        .await
        .map(|a| a.saved_at)
        .unwrap_or(0);
    items.push(AuthStatusItem {
        source: "qishui".into(),
        source_name: "汽水音乐".into(),
        configured: state.qishui.is_ready(),
        saved_at: qs_saved,
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
    let library = state.library.clone();
    tokio::task::spawn_blocking(move || {
        library.record_play_history(&track_id, played_secs, total_secs, completed, skipped)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// 获取用户画像（settings / 调试用）
#[tauri::command]
pub async fn get_user_profile(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let library = state.library.clone();
    // aggregate_user_profile 会 LIMIT 2000 全表扫 + 遍历建 HashMap，较重，放阻塞线程
    let profile = tokio::task::spawn_blocking(move || library.aggregate_user_profile())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    serde_json::to_value(profile).map_err(|e| e.to_string())
}

/// 懂你模式推荐下一首（排除最近播放 + 跳过反馈；候选池不足时自动跨源补充）
#[tauri::command]
pub async fn recommend_next(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
    current_track_id: Option<String>,
    mood: Option<String>,
    llm_config: Option<LlmConfig>,
) -> Result<Vec<Track>, String> {
    use orange_core::recommendation::{Mood, RecommendContext, Scene};
    use orange_core::source::{AudioSource, SearchQuery};
    // 把所有同步 SQLite + 内存聚合打包进一次 spawn_blocking
    let library = state.library.clone();
    let prep = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let profile = library
            .aggregate_user_profile()
            .map_err(|e| e.to_string())?;
        let recent = library.recent_track_ids(20);
        let feedback = library.recent_feedback(20);
        let all = library.all();
        Ok((profile, recent, feedback, all))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (profile, recent, feedback, mut candidates) = prep;

    // 跨源候选补充：本地库为空或不足时，从就绪的网络音源搜索 + 热门电台兜底
    if candidates.len() < 50 {
        let keyword = profile
            .top_artists
            .first()
            .map(|(a, _)| a.clone())
            .or_else(|| {
                current_track_id.as_ref().and_then(|id| {
                    candidates
                        .iter()
                        .find(|t| t.id.0.to_string() == *id)
                        .map(|t| t.meta.artist.clone())
                })
            })
            .filter(|s| !s.trim().is_empty());

        if let Some(kw) = keyword {
            let query = SearchQuery {
                keyword: kw,
                page: 1,
                page_size: 50,
                ..Default::default()
            };
            let sources = state.sources.list();
            let mut set = tokio::task::JoinSet::new();
            for src in sources {
                if !src.is_ready() {
                    continue;
                }
                let q = query.clone();
                set.spawn(async move {
                    match tokio::time::timeout(std::time::Duration::from_secs(5), src.search(&q))
                        .await
                    {
                        Ok(Ok(r)) => r.tracks,
                        _ => vec![],
                    }
                });
            }
            while let Some(res) = set.join_next().await {
                if let Ok(tracks) = res {
                    candidates.extend(tracks);
                }
            }
        }
    }
    // 最终兜底：网络源也没有时，用热门电台填充（保证空库也能「懂你」）
    if candidates.is_empty() {
        if let Ok(radio) = state.web_radio.recommendations(30).await {
            candidates.extend(radio);
        }
    }
    // 去重：同一 source_track_id + source_kind 视为同一首
    {
        let mut seen = std::collections::HashSet::new();
        candidates.retain(|t| {
            let key = format!("{}:{:?}", t.source_track_id, t.source_kind);
            seen.insert(key)
        });
    }

    let current = current_track_id.as_ref().and_then(|id| {
        candidates
            .iter()
            .find(|t| t.id.0.to_string() == *id)
            .cloned()
    });
    let n = limit.unwrap_or(1).max(1);

    // 时段推导场景（0-6/22+ = Sleep，7-9 = Commute，9-18 = Work，18-22 = Relax）
    let now = chrono::Utc::now();
    let hour = now.format("%H").to_string().parse::<u32>().unwrap_or(12);
    let scene = match hour {
        0..=6 | 22..=23 => Some(Scene::Sleep),
        7..=9 => Some(Scene::Commute),
        10..=18 => Some(Scene::Work),
        _ => Some(Scene::Relax),
    };
    // 情绪字符串 → Mood enum（前端传 "energetic" 等 snake_case）
    let mood = mood
        .as_deref()
        .and_then(|s| match s.to_lowercase().as_str() {
            "happy" => Some(Mood::Happy),
            "sad" => Some(Mood::Sad),
            "calm" => Some(Mood::Calm),
            "energetic" => Some(Mood::Energetic),
            "focused" => Some(Mood::Focused),
            "romantic" => Some(Mood::Romantic),
            "nostalgic" => Some(Mood::Nostalgic),
            "melancholy" | "melancholic" => Some(Mood::Melancholy),
            _ => None,
        });

    let ctx = RecommendContext {
        now,
        weather: None,
        mood,
        scene,
        recent_track_ids: recent,
        limit: n,
        candidates,
    };

    // 若前端传了 llm_config，临时构造带 LLM 的 recommender（覆盖默认 local 引擎）
    let recommender: std::sync::Arc<dyn orange_core::recommendation::RecommendationEngine> =
        if let Some(cfg) = llm_config {
            if !cfg.api_key.is_empty() {
                let provider: std::sync::Arc<dyn orange_ai::LlmProvider> =
                    match cfg.provider.as_deref().unwrap_or("openai") {
                        "minimax" => std::sync::Arc::new(orange_ai::MinimaxProvider::new(
                            cfg.api_base,
                            cfg.api_key,
                            cfg.model,
                        )),
                        _ => std::sync::Arc::new(orange_ai::CloudLlmProvider::new(
                            cfg.api_base,
                            cfg.api_key,
                            cfg.model,
                        )),
                    };
                std::sync::Arc::new(orange_ai::AiRecommendationEngine::with_llm(provider))
            } else {
                state.recommender.clone()
            }
        } else {
            state.recommender.clone()
        };

    if n == 1 {
        let t = recommender
            .next_understand_you(&profile, &ctx, current.as_ref(), &feedback)
            .await
            .map_err(|e| e.to_string())?;
        Ok(vec![t])
    } else {
        recommender
            .recommend(&profile, &ctx)
            .await
            .map_err(|e| e.to_string())
    }
}

/// LLM 配置（前端从 localStorage 读取后传入 recommend_next）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct LlmConfig {
    pub provider: Option<String>,
    pub api_base: String,
    pub api_key: String,
    pub model: String,
}

/// 分析本地音频文件的节拍图谱（驱动电影运镜预计算）。
/// 缓存到 `<app_data_dir>/beatmaps/<key>.json`，键 = fnv(path)+mtime+size。
/// 非本地文件（云曲）直接报错跳过。
#[tauri::command]
pub async fn analyze_beatmap(
    app: tauri::AppHandle,
    track_path: String,
) -> Result<serde_json::Value, String> {
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

    let cache_dir = crate::app_data_subdir(&app, "beatmaps")?;
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
    .map_err(|e| format!("分析线程失败: {e}"))??;

    let json = serde_json::to_value(&beatmap).map_err(|e| e.to_string())?;
    if let Ok(s) = serde_json::to_string(&beatmap) {
        let _ = std::fs::write(&cache_file, s);
    }
    tracing::debug!(
        "节拍图谱分析完成: {} 个 hit, BPM={:.1}",
        beatmap.hits.len(),
        beatmap.bpm
    );
    Ok(json)
}

/// 分析单首曲目的 BPM 并写回库（标签缺失时音频分析兜底，延迟填充用）
///
/// 流程：取 track → 已有 bpm 则秒返 → 否则 spawn_blocking 解码 + 节拍分析 → update_track_bpm
#[tauri::command]
pub async fn analyze_track_bpm(
    state: tauri::State<'_, AppState>,
    track_id: String,
) -> Result<f32, String> {
    // 查曲目
    let track = state
        .library
        .all()
        .into_iter()
        .find(|t| t.id.0.to_string() == track_id)
        .ok_or_else(|| format!("曲目不存在: {track_id}"))?;
    // 标签已有 bpm → 秒返
    if let Some(bpm) = track.meta.bpm {
        return Ok(bpm);
    }
    // 本地文件路径
    let path = std::path::PathBuf::from(&track.source_track_id);
    if !path.is_file() {
        return Err("非本地文件，无法分析 BPM".into());
    }
    // spawn_blocking 跑解码 + 节拍分析（CPU 密集）
    let bpm = tokio::task::spawn_blocking(move || -> Result<f32, String> {
        let audio = orange_audio::decode_file(&path).map_err(|e| e.to_string())?;
        let beatmap = orange_audio::analyze_beatmap(&audio);
        Ok(beatmap.bpm)
    })
    .await
    .map_err(|e| format!("BPM 分析线程失败: {e}"))??;
    // 写回库（DB + 内存）
    state
        .library
        .update_track_bpm(&track_id, bpm)
        .map_err(|e| e.to_string())?;
    tracing::info!("BPM 分析完成: {} → {:.1}", track.meta.title, bpm);
    Ok(bpm)
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

/// 远端封面代理下载到本地（绕开浏览器 CORS，驱动 cinema 模式 CoverParticles）
///
/// 输入是网易云/QQ 返回的封面 URL（不带 CORS 头），下载到
/// `<app_data_dir>/covers/<fnv(url)>.jpg` 后返回本地路径，前端用 `convertFileSrc` 喂给 WebView。
///
/// 命中缓存（URL 不变）秒返；并发相同 URL 共享一次下载。
/// 限制单文件 8MB，磁盘缓存总大小超过 256MB 时清理最旧的 20%。
/// 失败返回 Err，前端 fallback 到 hasCover=false（粒子层用默认色渐变）。
#[tauri::command]
pub async fn cover_proxy(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<String, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("仅支持 http(s) URL: {}", url));
    }

    let cache_dir = crate::app_data_subdir(&app, "covers")?;

    let key = fnv_hash(&url);
    // 用 URL 后缀推断扩展名（默认 jpg）
    let ext = std::path::Path::new(&url)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .filter(|s| matches!(s.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif"))
        .unwrap_or_else(|| "jpg".to_string());
    let cache_file = cache_dir.join(format!("{key}.{ext}"));

    // 命中缓存直接返回
    if cache_file.is_file() {
        // 更新 atime 用于 LRU 清理（只读打开即可）
        let _ = std::fs::OpenOptions::new().read(true).open(&cache_file).map(|_| ());
        return Ok(cache_file.to_string_lossy().into_owned());
    }

    // 并发去重：相同 URL 共享一次下载
    let slot = {
        let mut map = state.cover_cache.in_flight.lock();
        map.entry(url.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(None)))
            .clone()
    };

    let mut guard = slot.lock().await;
    if let Some(path) = guard.as_ref() {
        return Ok(path.clone());
    }

    // 下载（带 UA + Referer，部分 CDN 拦截裸请求）
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 OrangeRadio")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(&url)
        .header("Referer", "https://music.163.com/")
        .send()
        .await
        .map_err(|e| format!("下载封面失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("封面 HTTP {}: {}", resp.status(), url));
    }

    // 限制单文件大小
    if let Some(len) = resp.content_length() {
        if len > 8 * 1024 * 1024 {
            return Err(format!("封面过大 ({} bytes): {}", len, url));
        }
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取封面字节失败: {e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(format!("封面过大 ({} bytes): {}", bytes.len(), url));
    }

    std::fs::write(&cache_file, &bytes).map_err(|e| format!("写封面缓存失败: {e}"))?;

    // 磁盘缓存 LRU 清理：总大小超过 256MB 时删除最旧的 20%
    prune_covers(&cache_dir, 256 * 1024 * 1024, 0.2);

    tracing::debug!(
        "封面已下载: {} ({} bytes) → {}",
        trunc(&url, 120),
        bytes.len(),
        cache_file.display()
    );

    let path = cache_file.to_string_lossy().into_owned();
    *guard = Some(path.clone());
    Ok(path)
}

/// 清理 covers 目录：总大小超过 max_total_bytes 时，按 atime 删除最旧的 ratio
fn prune_covers(dir: &std::path::Path, max_total_bytes: u64, ratio: f64) {
    let entries: Vec<_> = std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().ok().map(|t| t.is_file()).unwrap_or(false))
        .collect();

    let total: u64 = entries
        .iter()
        .filter_map(|e| e.metadata().ok().map(|m| m.len()))
        .sum();
    if total <= max_total_bytes {
        return;
    }

    let mut with_atime: Vec<_> = entries
        .into_iter()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let atime = meta.accessed().ok()?;
            Some((atime, e.path()))
        })
        .collect();
    with_atime.sort_by_key(|a| a.0);

    let to_remove = (with_atime.len() as f64 * ratio).ceil() as usize;
    for (_, path) in with_atime.into_iter().take(to_remove) {
        let _ = std::fs::remove_file(&path);
    }
}

// ===== Hue 灯光联动（v0.8 MVP） =====

/// 发现局域网内的 Hue Bridge（nupnp）
#[tauri::command]
pub async fn hue_discover() -> Result<Vec<serde_json::Value>, String> {
    let mgr = orange_hue::HueManager::new();
    let bridges = mgr.discover().await.map_err(|e| e.to_string())?;
    Ok(bridges
        .into_iter()
        .map(|b| serde_json::json!({ "ip": b.ip }))
        .collect())
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
        &orange_hue::LightState {
            on,
            bri,
            hue: hue_val,
            sat,
        },
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
        .filter(|c| {
            c.is_alphanumeric()
                || *c == '.'
                || *c == '-'
                || *c == '_'
                || ('\u{4e00}'..='\u{9fff}').contains(c)
        })
        .collect();
    let safe_name = if safe_name.is_empty() {
        "wallpaper".to_string()
    } else {
        safe_name
    };
    let dest = wallpapers_dir.join(format!("{ts}-{safe_name}"));
    fs::copy(&src_path, &dest).map_err(|e| format!("复制壁纸文件失败: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// 删除已保存的壁纸文件（用户从壁纸库移除时调用）
#[tauri::command]
pub fn wallpaper_remove(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("删除壁纸文件失败: {e}"))
}

/// 扫描本地 Wallpaper Engine 壁纸。
///
/// `dirs=Some` 用前端配置目录；`None` 自动发现（注册表 + libraryfolders.vdf）。
/// 扫描完成后把发现的 Workshop 根目录登记到 AppState.we_roots，供 orangeradio://wefile 安全校验。
#[tauri::command]
pub async fn wallpaper_engine_scan(
    state: tauri::State<'_, AppState>,
    dirs: Option<Vec<String>>,
) -> Result<orange_core::wallpaper_engine::WallpaperEngineScanResult, String> {
    let result = crate::wallpaper_engine::scan(dirs).await;
    let roots: Vec<std::path::PathBuf> = result
        .discovered_dirs
        .iter()
        .map(std::path::PathBuf::from)
        .collect();
    *state.we_roots.write() = roots;
    tracing::info!(
        "Wallpaper Engine 扫描完成：{} 条壁纸，根目录 {:?}",
        result.entries.len(),
        result.discovered_dirs
    );
    Ok(result)
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

/// 工作室输出目录：优先使用用户在设置里配置的 `custom` 目录（非空时），
/// 否则回退到 `{app_data_dir}/studio/`。用于存放生成的音频、分轨、歌词、工程文件。
///
/// `custom` 为空字符串或全空白时视作未配置。目录不存在会自动创建。
fn studio_output_dir(
    app: &tauri::AppHandle,
    custom: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    if let Some(dir) = custom.map(str::trim).filter(|s| !s.is_empty()) {
        let path = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&path)
            .map_err(|e| format!("创建输出目录失败（{}）: {e}", path.display()))?;
        return Ok(path);
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 data_dir 失败: {e}"))?;
    let dir = data_dir.join("studio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 studio 目录失败: {e}"))?;
    Ok(dir)
}

/// 兼容旧调用点的薄包装（固定用默认 app_data_dir/studio）。
#[allow(dead_code)]
fn studio_cache_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    studio_output_dir(app, None)
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
    let draft = generator
        .generate(&request)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&draft).map_err(|e| e.to_string())
}

/// 音乐生成 → 本地 mp3 路径 + 歌词
///
/// 调用 MiniMax music_generation（同步接口，约 30-90 秒）。
/// 返回的 `audio_path` 是本地缓存文件路径，前端用 `convertFileSrc` 播放。
///
/// ## 自动写词（`auto_lyrics`）
/// MiniMax `music_generation` 响应**不返回歌词**（官方文档确认），请求里传的词或
/// `lyrics_optimizer` 自动写的词都拿不回来。为让用户能"听到 = 看到"，当：
///   - 用户没传歌词（`lyrics` 为空），且
///   - `auto_lyrics = true`，且
///   - 非纯伴奏模式（`is_instrumental != true`）
/// 时，本命令会**先**调一次 LLM（`lyrics_api_*` 配置，复用写词端点）生成一版
/// 结构化歌词，再把它同时用于：① 塞进 `GenerationRequest.lyrics` 喂给 MiniMax
/// 演唱；② 写进返回 JSON 的 `lyrics` 字段回传前端展示。
/// 写词失败不阻断音乐生成 —— 降级为让 MiniMax 自己 `lyrics_optimizer` 盲写
/// （此时返回的 `lyrics` 为 null，前端歌词区为空）。
///
/// ## 输出目录（`output_dir`）
/// 用户可在设置里配置创作输出目录；为空时回退 `{app_data_dir}/studio/`。
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri 命令需把前端各项配置作为独立参数接收
pub async fn studio_generate_music(
    app: tauri::AppHandle,
    prompt: String,
    lyrics: Option<String>,
    is_instrumental: Option<bool>,
    api_base: String,
    api_key: String,
    model: String,
    output_dir: Option<String>,
    auto_lyrics: Option<bool>,
    lyrics_api_base: Option<String>,
    lyrics_api_key: Option<String>,
    lyrics_model: Option<String>,
) -> Result<serde_json::Value, String> {
    use orange_studio::{AudioAIProvider, GenerationRequest, MiniMaxProvider};
    if api_key.is_empty() {
        return Err("未配置 MiniMax API Key，请先在设置中填写".into());
    }

    let is_instrumental = is_instrumental.unwrap_or(false);
    let user_lyrics_empty = lyrics.as_deref().map(str::trim).unwrap_or("").is_empty();

    // —— 自动写词：用户没给词 + 开启 auto_lyrics + 非纯伴奏 ——
    // 用 LLM 写一版结构化歌词，渲染成 MiniMax 格式，同时用于演唱和回传。
    // 写词失败降级为 None（让 MiniMax 自己 lyrics_optimizer 盲写），不阻断。
    let mut final_lyrics = lyrics;
    let mut auto_lyrics_note: Option<String> = None;
    let want_auto = auto_lyrics.unwrap_or(true) && !is_instrumental && user_lyrics_empty;
    if want_auto {
        match resolve_auto_lyrics(
            &prompt,
            lyrics_api_base.as_deref(),
            lyrics_api_key.as_deref(),
            lyrics_model.as_deref(),
            &api_key,
        )
        .await
        {
            Ok(text) => {
                tracing::info!(
                    "自动写词成功（{} 字符），将用于 MiniMax 演唱并回传",
                    text.len()
                );
                final_lyrics = Some(text);
            }
            Err(e) => {
                tracing::warn!("自动写词失败，降级为 MiniMax lyrics_optimizer 盲写: {e}");
                auto_lyrics_note = Some(format!("自动写词失败（{e}），已改用 MiniMax 自动补词"));
            }
        }
    }

    let provider = MiniMaxProvider::new(api_key, api_base, model);
    let request = GenerationRequest {
        style_prompt: prompt,
        duration_secs: None,
        need_stems: false,
        lyrics: final_lyrics.clone(),
        reference_audio_url: None,
        params: serde_json::json!({ "is_instrumental": is_instrumental }),
    };
    let result = provider
        .generate(&request)
        .await
        .map_err(|e| e.to_string())?;
    let audio_url = result
        .audio_url
        .ok_or_else(|| "MiniMax 未返回音频".to_string())?;

    // 落盘到输出目录（用户配置或默认 app_data_dir/studio）
    let out_dir = studio_output_dir(&app, output_dir.as_deref())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = out_dir.join(format!("{ts}-{task_id}.mp3", task_id = result.task_id));
    tracing::info!("开始下载 MiniMax 音频到本地: dest={}", dest.display());
    let audio_path = provider
        .download_audio(&audio_url, &dest)
        .await
        .map_err(|e| e.to_string())?;

    // 同步把歌词存成 .txt（与音频同名），方便用户在输出目录里翻看
    if let Some(ref text) = final_lyrics {
        let ldest = out_dir.join(format!("{ts}-{task_id}.txt", task_id = result.task_id));
        if let Err(e) = std::fs::write(&ldest, text.as_bytes()) {
            tracing::warn!("写入歌词文件失败（{}）: {e}", ldest.display());
        }
    }

    Ok(serde_json::json!({
        "audio_path": audio_path,
        "task_id": result.task_id,
        "lyrics": final_lyrics,
        "lyrics_note": auto_lyrics_note,
    }))
}

/// 解析自动写词的 LLM 配置：优先用前端显式传入的 `lyrics_api_*`，
/// 缺失时回退到与 music 端点相同的 `api_key`（但 base/model 仍需前端给，
/// 因为写词走 Anthropic 兼容端点，默认与 music 端点不同）。
async fn resolve_auto_lyrics(
    prompt: &str,
    lyrics_api_base: Option<&str>,
    lyrics_api_key: Option<&str>,
    lyrics_model: Option<&str>,
    fallback_key: &str,
) -> Result<String, String> {
    use orange_studio::{LyricsGenerator, LyricsRequest};
    let base = lyrics_api_base
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "lyrics_api_base 未配置".to_string())?;
    let key = lyrics_api_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_key);
    if key.is_empty() {
        return Err("未配置写词用 API Key".into());
    }
    let model = lyrics_model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("MiniMax-M1");
    let generator = LyricsGenerator::new(base, key, model);
    let request = LyricsRequest {
        theme: prompt.to_string(),
        ..Default::default()
    };
    let draft = generator
        .generate(&request)
        .await
        .map_err(|e| e.to_string())?;
    // 渲染成 MiniMax 格式（[Verse]\n... 形式），既喂 MiniMax 又回传前端
    Ok(draft.to_minimax_lyrics())
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
    output_dir: Option<String>,
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

    // 下载两轨到输出目录（provider 在 separator 内部已 drop，这里单独构造仅用于下载）
    let out_dir = studio_output_dir(&app, output_dir.as_deref())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let downloader = MiniMaxProvider::new("", "", "");
    // provider 返回的引用可能是 http(s) URL（URL 模式）或 file://（hex 模式落 temp）
    let is_remote_like = |s: &str| s.starts_with("http") || s.starts_with("file:");
    let vocals_path = match stems.vocals.as_deref() {
        Some(url) if is_remote_like(url) => {
            let dest = out_dir.join(format!("{ts}-vocals.mp3"));
            tracing::info!("开始下载人声轨: dest={}", dest.display());
            downloader
                .download_audio(url, &dest)
                .await
                .map_err(|e| e.to_string())?
        }
        Some(p) => p.to_string(),
        None => return Err("人声轨生成失败".into()),
    };
    let instrumental_path = match stems.other.as_deref() {
        Some(url) if is_remote_like(url) => {
            let dest = out_dir.join(format!("{ts}-instrumental.mp3"));
            tracing::info!("开始下载伴奏轨: dest={}", dest.display());
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
/// `output_dir` 为用户配置的输出目录，为空则回退默认 `{app_data_dir}/studio/`。
/// 返回保存的文件绝对路径。
#[tauri::command]
pub fn studio_project_save(
    app: tauri::AppHandle,
    project_json: serde_json::Value,
    name: String,
    output_dir: Option<String>,
) -> Result<String, String> {
    use orange_studio::StudioProject;
    let project: StudioProject =
        serde_json::from_value(project_json).map_err(|e| format!("解析工程 JSON 失败: {e}"))?;
    let out_dir = studio_output_dir(&app, output_dir.as_deref())?;
    // 安全文件名
    let safe_name: String = name
        .chars()
        .filter(|c| {
            c.is_alphanumeric()
                || *c == '.'
                || *c == '-'
                || *c == '_'
                || ('\u{4e00}'..='\u{9fff}').contains(c)
        })
        .collect();
    let safe_name = if safe_name.is_empty() {
        "untitled".to_string()
    } else {
        safe_name
    };
    let dest = out_dir.join(format!("{safe_name}.orp"));
    project.save_to_path(&dest).map_err(|e| e.to_string())?;
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

/// 内置 demo 曲元信息（首启自动播放用）
///
/// 从打包到安装包中的 `resources/demo/track.mp3` 直接读 ID3：
/// - title / artist / album / duration_secs 由 lofty 解析
/// - 专辑封面抽取到 `app_data_dir/covers/` 缓存（用 FNV-1a 哈希命名防重复）
/// - 歌词优先用 ID3 内嵌 USLT；如果没有，回退读 `resources/demo/track.lrc`
#[tauri::command]
pub async fn builtin_track_meta(app: AppHandle) -> Result<TrackMeta, String> {
    let mp3_path = app
        .path()
        .resolve("resources/demo/track.mp3", BaseDirectory::Resource)
        .map_err(|e| format!("resolve demo track.mp3 failed: {e}"))?;
    let lrc_path = app
        .path()
        .resolve("resources/demo/track.lrc", BaseDirectory::Resource)
        .ok();

    // 封面缓存目录：app_data_dir/covers/（dev 模式走 cwd/.orangeradio/covers）
    let covers_dir = app.path().app_data_dir().ok().map(|d| d.join("covers"));

    let mut meta = orange_library::metadata::read_track_meta(&mp3_path, covers_dir.as_deref());

    // 歌词：优先用 ID3 内嵌 USLT，否则读 track.lrc
    if meta.lyrics.is_none() {
        if let Some(lrc) = lrc_path {
            match std::fs::read_to_string(&lrc) {
                Ok(s) => meta.lyrics = Some(s),
                Err(e) => tracing::warn!("builtin demo LRC 读取失败 {}: {}", lrc.display(), e),
            }
        }
    }

    Ok(meta)
}

/// 内置 demo 曲音频文件绝对路径（前端 convertFileSrc 用）
#[tauri::command]
pub async fn builtin_stream(app: AppHandle) -> Result<String, String> {
    let p = app
        .path()
        .resolve("resources/demo/track.mp3", BaseDirectory::Resource)
        .map_err(|e| format!("resolve demo track failed: {e}"))?;
    Ok(p.to_string_lossy().into_owned())
}

/// 真正退出应用（不经过窗口关闭拦截）。
/// 由前端"关闭确认 Modal"的"退出应用"按钮调用——
/// 托盘菜单的"退出 OrangeRadio"走原 `on_menu_event` → `app.exit(0)`，不经过这里。
#[tauri::command]
pub fn app_exit(app: AppHandle) {
    tracing::info!("[app_exit] 用户主动选择退出应用");
    app.exit(0);
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
            gequbao_search,
            gequbao_stream,
            gequbao_popular,
            kuwo_search,
            kuwo_stream,
            kuwo_popular,
            kuwo_chart_detail,
            kuwo_lyric,
            netease_login,
            netease_login_with_webview,
            netease_logout,
            netease_status,
            netease_current_user,
            netease_get_quality,
            netease_set_quality,
            netease_search,
            netease_stream,
            netease_playlists,
            netease_daily,
            netease_toplists,
            netease_toplist_detail,
            netease_playlist_detail,
            netease_lyric,
            netease_comments,
            netease_like_track,
            netease_add_track_to_playlist,
            kugou_search,
            kugou_stream,
            kugou_login,
            kugou_logout,
            kugou_status,
            kugou_current_user,
            kugou_playlists,
            kugou_playlist_detail,
            kugou_lyric,
            qishui_search,
            qishui_stream,
            qishui_status,
            toggle_liked,
            liked_tracks,
            add_to_favorites,
            remove_from_favorites,
            favorites_playlist,
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
            analyze_track_bpm,
            cover_proxy,
            hue_discover,
            hue_pair,
            hue_set_state,
            wallpaper_save,
            wallpaper_remove,
            wallpaper_engine_scan,
            lyric_annotate,
            emotion_analyze,
            studio_generate_lyrics,
            studio_generate_music,
            studio_separate_vocal,
            studio_project_save,
            studio_project_load,
            builtin_track_meta,
            builtin_stream,
            app_exit,
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
