//! # OrangeRadio Tauri 桥接层
//!
//! 将 Rust 核心能力通过 `#[tauri::command]` 暴露给前端 WebView。

pub mod commands;
pub mod wallpaper_engine;

use orange_ai::AiRecommendationEngine;
use orange_core::{AuthEventSink, AuthExpiredPayload};
use orange_library::LibraryDb;
use orange_sources::{
    AuthStore, GequbaoSource, HttpClient, KugouSource, KuwoSource, NeteaseSource, PodcastSource,
    QishuiSource, QqMusicSource, SpotifySource, WebRadioSource,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// 把 source 的"登录过期"事件 emit 到前端 WebView 的 sink
///
/// AppState::default() 创建时 AppHandle 还没就绪（Tauri Builder::run() 之后才有），
/// 所以 handle 字段是 Option，启动后由 setup 钩子注入。
pub struct TauriAuthSink {
    handle: Mutex<Option<AppHandle>>,
}

impl TauriAuthSink {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            handle: Mutex::new(None),
        })
    }

    /// 由 Tauri Builder::setup() 调用，注入运行时 AppHandle
    pub fn set_handle(&self, handle: AppHandle) {
        *self.handle.lock() = Some(handle);
    }
}

impl AuthEventSink for TauriAuthSink {
    fn on_auth_expired(&self, payload: AuthExpiredPayload) {
        let handle_opt = self.handle.lock().clone();
        if let Some(handle) = handle_opt {
            // emit 到前端；前端 listen("auth-expired", ...) 弹 toast
            if let Err(e) = handle.emit("auth-expired", &payload) {
                tracing::warn!("emit auth-expired 事件失败: {}", e);
            }
        }
    }
}

/// 应用核心状态（注入到 Tauri 的 Managed State）
#[derive(Clone)]
pub struct AppState {
    pub event_bus: orange_core::EventBus,
    pub library: LibraryDb,
    pub web_radio: Arc<WebRadioSource>,
    pub netease: Arc<NeteaseSource>,
    pub podcast: Arc<PodcastSource>,
    pub qqmusic: Arc<QqMusicSource>,
    pub spotify: Arc<SpotifySource>,
    pub gequbao: Arc<GequbaoSource>,
    pub kugou: Arc<KugouSource>,
    pub kuwo: Arc<KuwoSource>,
    pub qishui: Arc<QishuiSource>,
    pub auth_store: Arc<AuthStore>,
    /// 鉴权过期事件 sink —— 暴露给 orange-tauri::commands 注册 IPC 命令用
    pub auth_sink: Arc<TauriAuthSink>,
    /// 推荐引擎（懂你模式）：本地画像打分，不依赖 LLM
    pub recommender: Arc<dyn orange_core::recommendation::RecommendationEngine>,
    /// 音源注册表：聚合所有网络音源，供 search_all 遍历（本地库走 library 字段单独处理）
    pub sources: Arc<orange_sources::SourceRegistry>,
    /// 共享 HTTP 客户端（含 TTL 缓存）。暴露引用用于 setup 钩子里启动后台清理任务。
    pub http_client: Arc<orange_sources::HttpClient>,
    /// Wallpaper Engine Workshop 根目录白名单（wefile 安全校验用）。
    /// 由 wallpaper_engine_scan 命令扫描完成后写入；Task 5 的 wefile handler 读这里。
    /// Arc 包裹以保留 `#[derive(Clone)]`（parking_lot::RwLock 本身不是 Clone）。
    pub we_roots: Arc<parking_lot::RwLock<Vec<PathBuf>>>,
    pub cover_cache: Arc<CoverCache>,
    /// 封面下载计数器：每 N 次下载触发一次 prune_covers（替代每次下载都全目录扫描）
    pub cover_download_count: Arc<AtomicU64>,
}

/// 封面缓存：内存索引 + 并发下载去重 + 磁盘 LRU 清理
#[derive(Default)]
pub struct CoverCache {
    /// 正在下载中的 URL → shared future，相同 URL 并发请求只下载一次
    pub in_flight: Mutex<HashMap<String, Arc<tokio::sync::Mutex<Option<String>>>>>,
}

impl CoverCache {
    pub fn new() -> Self {
        Self::default()
    }
}

// ===== 跨平台数据目录工具 =====
//
// 之前所有数据目录都用 `std::env::current_dir().join(".orangeradio/...")`，在
// macOS 上从 Finder 双击 .app 启动时 CWD 是 `/`，所有写操作会失败。
// 统一改成走 `app.path().app_data_dir()`，各 OS 落到约定位置：
//   - Windows: %APPDATA%\com.orangeradio.app\
//   - macOS:   ~/Library/Application Support/com.orangeradio.app/
//   - Linux:   ~/.local/share/com.orangeradio.app/

/// 应用数据根目录。失败时回退到当前工作目录的 `.orangeradio/`（仅供开发期）。
pub fn app_data_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// 应用数据子目录（自动 create_dir_all）。`name` 只能是单层目录名（不含 `/`）。
pub fn app_data_subdir(app: &AppHandle, name: &str) -> std::result::Result<PathBuf, String> {
    let dir = app_data_root(app).join(name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 {name} 目录失败: {e}"))?;
    Ok(dir)
}

impl Default for AppState {
    fn default() -> Self {
        // 统一数据目录：与本地库 SQLite 同一根 `.orangeradio/`
        let data_dir = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".orangeradio");

        // 打开 SQLite 持久化库（启动时从磁盘加载缓存，秒开无需重扫）
        let db_path = data_dir.join("library.sqlite");
        let library = LibraryDb::open(&db_path).unwrap_or_else(|e| {
            tracing::warn!("打开本地库 SQLite 失败，降级为内存库: {}", e);
            LibraryDb::new()
        });

        // AuthStore：加密持久化网易云 / QQ 音乐 Cookie（keyring + AES-GCM）
        let auth_store = AuthStore::new(data_dir);

        // 共享 HTTP 客户端（含 TTL 缓存），注入到各网络音源
        let http_client = Arc::new(HttpClient::new());

        // 鉴权过期事件 sink（handle 后续由 setup 钩子注入）
        let auth_sink = TauriAuthSink::new();
        let auth_sink_dyn: Arc<dyn AuthEventSink> = auth_sink.clone();

        let qqmusic = Arc::new(
            QqMusicSource::new(auth_store.clone(), Some(auth_sink_dyn.clone()))
                .with_client(http_client.clone()),
        );
        // 注意：start_refresh_loop 必须在 Tauri runtime 起来后调
        // （见 commands.rs::register_all 的 setup 钩子），不能在 default() 里调

        let netease = Arc::new(
            NeteaseSource::new(auth_store.clone(), Some(auth_sink_dyn.clone()))
                .with_client(http_client.clone()),
        );
        // 同上：start_health_loop 在 setup 钩子里调

        // Spotify：启动恢复要 spawn tokio task，同样放 setup 钩子
        let spotify = Arc::new(
            SpotifySource::new(auth_store.clone(), Some(auth_sink_dyn))
                .with_client(http_client.clone()),
        );

        // 推荐引擎（懂你模式）：本地画像打分，开箱即用
        let recommender: Arc<dyn orange_core::recommendation::RecommendationEngine> =
            Arc::new(AiRecommendationEngine::local());

        let web_radio = Arc::new(WebRadioSource::new().with_client(http_client.clone()));
        let podcast = Arc::new(PodcastSource::new().with_client(http_client.clone()));
        let gequbao = Arc::new(GequbaoSource::new().with_client(http_client.clone()));
        let kugou = Arc::new(KugouSource::new(auth_store.clone()).with_client(http_client.clone()));
        let kuwo = Arc::new(KuwoSource::new().with_client(http_client.clone()));
        let qishui = Arc::new(QishuiSource::new(auth_store.clone()));

        // 音源注册表：聚合所有网络音源，search_all 遍历用
        // （本地库走 library 字段单独处理，因为 LibraryDb 未实现 AudioSource trait）
        let mut registry = orange_sources::SourceRegistry::new();
        registry.register(web_radio.clone());
        registry.register(netease.clone());
        registry.register(podcast.clone());
        registry.register(qqmusic.clone());
        registry.register(spotify.clone());
        registry.register(gequbao.clone());
        registry.register(kugou.clone());
        registry.register(kuwo.clone());
        registry.register(qishui.clone());

        Self {
            event_bus: orange_core::EventBus::default(),
            library,
            web_radio,
            netease,
            podcast,
            qqmusic,
            spotify,
            gequbao,
            kugou,
            kuwo,
            qishui,
            auth_store,
            auth_sink,
            recommender,
            sources: Arc::new(registry),
            http_client,
            we_roots: Arc::new(parking_lot::RwLock::new(Vec::new())),
            cover_cache: Arc::new(CoverCache::new()),
            cover_download_count: Arc::new(AtomicU64::new(0)),
        }
    }
}
