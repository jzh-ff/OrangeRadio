//! Tauri 命令（暴露给前端）

use crate::AppState;
use orange_core::source::SearchQuery;
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
    // 前端通过 Tauri asset protocol 直接访问本地文件，
    // 形如 http://asset.localhost/<encoded-path>
    // 这里仅做存在性校验占位
    Ok(_track_path)
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
        ])
}
