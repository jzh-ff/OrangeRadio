//! OrangeRadio 桌面应用入口

use tracing_subscriber::EnvFilter;

/// 启动应用
pub fn run() {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    tracing::info!("OrangeRadio v{} 启动中...", orange_core::VERSION);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init());

    // 注册所有 IPC 命令
    let builder = orange_tauri::commands::register_all(builder);

    builder
        .run(tauri::generate_context!())
        .expect("OrangeRadio 启动失败");
}
