//! # OrangeRadio Tauri 桥接层
//!
//! 将 Rust 核心能力通过 `#[tauri::command]` 暴露给前端 WebView。

pub mod commands;

use orange_library::LibraryDb;

/// 应用核心状态（注入到 Tauri 的 Managed State）
#[derive(Clone)]
pub struct AppState {
    pub event_bus: orange_core::EventBus,
    pub library: LibraryDb,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            event_bus: orange_core::EventBus::default(),
            library: LibraryDb::new(),
        }
    }
}
