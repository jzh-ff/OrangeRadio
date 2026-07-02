//! # OrangeRadio Tauri 桥接层
//!
//! 将 Rust 核心能力通过 `#[tauri::command]` 暴露给前端 WebView。

pub mod commands;

use orange_library::LibraryDb;
use orange_sources::{NeteaseSource, WebRadioSource};
use std::path::PathBuf;
use std::sync::Arc;

/// 应用核心状态（注入到 Tauri 的 Managed State）
#[derive(Clone)]
pub struct AppState {
    pub event_bus: orange_core::EventBus,
    pub library: LibraryDb,
    pub web_radio: Arc<WebRadioSource>,
    pub netease: Arc<NeteaseSource>,
}

impl Default for AppState {
    fn default() -> Self {
        // 打开 SQLite 持久化库（启动时从磁盘加载缓存，秒开无需重扫）
        let db_path = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".orangeradio")
            .join("library.sqlite");
        let library = LibraryDb::open(&db_path).unwrap_or_else(|e| {
            tracing::warn!("打开本地库 SQLite 失败，降级为内存库: {}", e);
            LibraryDb::new()
        });
        Self {
            event_bus: orange_core::EventBus::default(),
            library,
            web_radio: Arc::new(WebRadioSource::new()),
            netease: Arc::new(NeteaseSource::new()),
        }
    }
}
