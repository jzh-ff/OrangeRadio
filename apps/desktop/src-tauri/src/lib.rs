//! OrangeRadio 桌面应用入口

use std::path::PathBuf;
use tracing_appender::rolling;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

/// 日志目录（相对于应用工作目录）
fn log_dir() -> PathBuf {
    let dir = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".orangeradio")
        .join("logs");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// 初始化日志：控制台 + 文件双输出
///
/// 日志文件位置：`<工作目录>/.orangeradio/logs/orangeradio.log`
/// 按天滚动（每天一个文件，如 orangeradio.log.2026-07-02）。
/// 启动时会在控制台打印日志文件路径。
fn init_logging() -> (PathBuf, tracing_appender::non_blocking::WorkerGuard) {
    let dir = log_dir();

    // 文件 appender：按天滚动，前缀 orangeradio.log.
    let file_appender = rolling::daily(&dir, "orangeradio.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    // 控制台层 + 文件层
    let console_layer = fmt::layer()
        .with_target(true)
        .with_filter(filter.clone());

    let file_layer = fmt::layer()
        .with_writer(file_writer)
        .with_ansi(false) // 文件里不要 ANSI 颜色码
        .with_target(true)
        .with_filter(filter);

    tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer)
        .init();

    (dir, guard)
}

/// 启动应用
pub fn run() {
    // 初始化日志（guard 必须保活，否则文件写入会停止）
    let (log_dir, _guard) = init_logging();

    tracing::info!("========================================");
    tracing::info!("OrangeRadio v{} 启动中...", orange_core::VERSION);
    tracing::info!("日志目录: {}", log_dir.display());
    tracing::info!("========================================");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init());

    // 注册所有 IPC 命令
    let builder = orange_tauri::commands::register_all(builder);

    builder
        .run(tauri::generate_context!())
        .expect("OrangeRadio 启动失败");
}
