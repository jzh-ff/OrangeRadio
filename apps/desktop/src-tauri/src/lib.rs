//! OrangeRadio 桌面应用入口

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::http::{Request, Response};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tracing_appender::rolling;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

/// 日志目录（使用应用数据目录，避免 macOS 从 Finder 启动时 CWD 为 / 导致写到根目录）
fn log_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("logs");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// 初始化日志：控制台 + 文件双输出
///
/// 日志文件位置：`<app_data_dir>/logs/orangeradio.log`
/// 按天滚动（每天一个文件，如 orangeradio.log.2026-07-02）。
/// 启动时会在控制台打印日志文件路径。
fn init_logging(app: &tauri::AppHandle) -> (PathBuf, tracing_appender::non_blocking::WorkerGuard) {
    let dir = log_dir(app);

    // 文件 appender：按天滚动，前缀 orangeradio.log.
    let file_appender = rolling::daily(&dir, "orangeradio.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);

    // 默认级别：dev 构建用 info（便于开发调试），release 用 warn（减少无效格式化开销）。
    // 控制台层仅 dev 构建挂载（release 是 windows_subsystem，控制台输出无人看，纯属浪费）。
    let default_level = if cfg!(debug_assertions) {
        "info"
    } else {
        "warn"
    };
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level));

    // 文件层（始终启用，日志落盘供排查）
    let file_layer = fmt::layer()
        .with_writer(file_writer)
        .with_ansi(false) // 文件里不要 ANSI 颜色码
        .with_target(true)
        .with_filter(filter.clone());

    // 控制台层：仅 dev 构建挂载，避免 release 下每条日志格式化写两次
    #[cfg(debug_assertions)]
    let console_layer = Some(fmt::layer().with_target(true).with_filter(filter));
    #[cfg(not(debug_assertions))]
    let console_layer: Option<fmt::Layer<_>> = None;

    tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer)
        .init();

    (dir, guard)
}

/// 启动应用
pub fn run() {
    // 先建一个最小 AppHandle 用于日志目录（Tauri generate_context 后才会进入 setup）
    // 这里先初始化一个占位；真正启动后再用 app_handle 重新初始化日志。
    // 但 tracing 只能 init 一次，因此把 init_logging 移到 setup 里。
    // 保留 guard 在 setup 闭包内。
    // 注册自定义 URI scheme：`orangeradio://<host>/<path>?<query>`
    //   - 前端 <audio src="orangeradio://app/qqstream?url=..."> 直接能播
    //   - handler 在 Rust runtime 拉远端流，绕开 WebView CORS
    //   - 完全替代了之前的 127.0.0.1:17986 axum 代理
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            // 全局热键（v0.4 P11.3）：前端通过 @tauri-apps/plugin-global-shortcut register/unregister
            // 触发时由前端 callback 直接执行动作（播放/上下曲/音量/全屏/桌面歌词）
            tauri_plugin_global_shortcut::Builder::default().build(),
        )
        .register_asynchronous_uri_scheme_protocol("orangeradio", |ctx, request, responder| {
            // handler 是同步闭包，且 WebView2 的 WebResourceRequested 回调在 main thread
            // （无 Tokio runtime context）→ tokio::spawn 会 panic（与 commands.rs:1472 同坑）。
            // 必须用 tauri::async_runtime::spawn（内部 RUNTIME.get_or_init，任意线程可调）。
            // Tauri 2 该闭包第一参数是 UriSchemeContext'<_, R>，.app_handle() 拿 &AppHandle<R>，
            // 克隆 owned handle 才能 move 进 'static task。
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let response = handle_orangeradio_protocol(&app, request).await;
                responder.respond(response);
            });
        });

    // 注册所有 IPC 命令
    let builder = orange_tauri::commands::register_all(builder);

    builder
        .setup(|app| {
            let (log_dir, _guard) = init_logging(app.handle());
            tracing::info!("========================================");
            tracing::info!("OrangeRadio v{} 启动中...", orange_core::VERSION);
            tracing::info!("日志目录: {}", log_dir.display());
            tracing::info!("========================================");
            setup_tray(app)
        })
        .run(tauri::generate_context!())
        .expect("OrangeRadio 启动失败");
}

/// 系统托盘初始化
///
/// 行为：
/// - 启动时创建系统托盘图标（应用默认图标）+ 右键菜单（显示 / 退出）
/// - 左键单击托盘：显示主窗口并聚焦
/// - 菜单「显示」：同左键
/// - 菜单「退出」：直接 `app.exit(0)`，不走前端（独立退出路径）
///
/// 主窗口的「关闭按钮」由前端拦截：点 X → 弹出 CloseConfirmDialog
/// 让用户选「最小化到托盘 / 退出应用 / 取消」。Rust 侧不再做无脑 hide 拦截。
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // ---- 托盘菜单 ----
    let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 OrangeRadio", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;

    // ---- 创建托盘 ----
    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("default_window_icon".into()))?,
        )
        .tooltip("OrangeRadio · 沉浸式智能音乐播放器")
        .menu(&menu)
        .show_menu_on_left_click(false) // 左键单击走 on_tray_icon_event（toggle 显示），不走菜单
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                tracing::info!("用户从托盘菜单选择退出");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    tracing::info!("系统托盘已创建");

    // 主窗口关闭按钮由前端 CloseConfirmDialog 拦截处理（最小化到托盘 / 退出 / 取消），
    // Rust 侧不再拦截 WindowEvent::CloseRequested，避免无脑 hide 把用户退出意图吞掉。

    Ok(())
}

/// 切换主窗口：隐藏就显示并聚焦；显示就聚焦
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            // 已经显示 → 聚焦
            let _ = win.set_focus();
            let _ = win.unminimize();
        } else {
            // 隐藏 → 显示 + 聚焦 + 取消最小化
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
        // 给前端发个事件，让 UI 可以做点额外反应（比如刷新视觉）
        let _ = app.emit("tray:show-window", ());
    } else {
        tracing::warn!("show_main_window 找不到 main 窗口");
    }
}

/// 自定义 `orangeradio://` 协议的请求处理
///
/// 支持的 path：
/// - `/qqstream?url=<encoded upstream URL>&referer=<...>`
///   远端拉流转发（带 Referer / UA / Range），解决 QQ 音乐 CDN 的 CORS
/// - `/wefile?path=<abs>` 读取 Wallpaper Engine Workshop 目录下文件（图片/视频）
///   仅允许落在 AppState.we_roots 登记根目录之下的路径（防 `..` 穿越）
async fn handle_orangeradio_protocol(
    app: &tauri::AppHandle,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let uri = request.uri();
    let path = uri.path().to_string();
    let query: HashMap<String, String> = uri.query().map(parse_query).unwrap_or_default();

    match path.as_str() {
        "/qqstream" => handle_qq_stream(&request, &query).await,
        "/wefile" => handle_we_file(app, &request, &query).await,
        _ => bad_request(format!("unknown path: {}", path)),
    }
}

/// QQ 流转发专用 reqwest::Client 单例（全局复用连接池/TLS）。
///
/// `orangeradio://qqstream` 的 URI scheme handler 注册在 setup 之前、拿不到 AppState，
/// 故用模块级 OnceLock 单例。与 HttpClient 内部 client 配置一致（30s 超时、连接池）。
fn qqstream_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .pool_max_idle_per_host(20)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

async fn handle_qq_stream(
    request: &Request<Vec<u8>>,
    query: &HashMap<String, String>,
) -> Response<Cow<'static, [u8]>> {
    let target_url = match query.get("url") {
        Some(u) if !u.is_empty() => u.clone(),
        _ => return bad_request("missing url param".into()),
    };

    let referer = query
        .get("referer")
        .cloned()
        .unwrap_or_else(|| "https://y.qq.com/".to_string());
    let user_agent = query
        .get("ua")
        .cloned()
        .unwrap_or_else(|| {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36".to_string()
        });

    // 复用单例 client（连接池/TLS 会话复用），避免每次 Range 请求重建 client。
    // <audio> 拖动进度条会对同一 URL 发多次 Range 请求，复用 client 可省 TLS 握手。
    let client = qqstream_client();

    let mut fwd = client
        .get(&target_url)
        .header("Referer", &referer)
        .header("User-Agent", &user_agent);

    // 透传 Range 头（支持 <audio> 拖动进度条）
    if let Some(range) = request.headers().get("range") {
        if let Ok(r) = range.to_str() {
            fwd = fwd.header("Range", r);
        }
    }

    match fwd.send().await {
        Ok(upstream) => {
            let status = upstream.status();
            let mut builder = Response::builder().status(status.as_u16());
            // 透传音频相关 headers
            for h in [
                "content-type",
                "content-length",
                "content-range",
                "accept-ranges",
            ] {
                if let Some(v) = upstream.headers().get(h) {
                    if let Ok(s) = v.to_str() {
                        builder = builder.header(h, s);
                    }
                }
            }
            // 添加 CORS 允许（虽然自定义 scheme 不强制，但 webview 偶尔会预检）
            builder = builder.header("Access-Control-Allow-Origin", "*");

            match upstream.bytes().await {
                Ok(bytes) => builder
                    .body(Cow::Owned(bytes.to_vec()))
                    .unwrap_or_else(|_| bad_request("response build failed".into())),
                Err(e) => {
                    tracing::warn!("orangeradio://qqstream 读取上游失败: {}", e);
                    bad_request(format!("upstream read error: {}", e))
                }
            }
        }
        Err(e) => {
            tracing::warn!("orangeradio://qqstream 拉流失败: {}", e);
            bad_request(format!("upstream error: {}", e))
        }
    }
}

fn bad_request(msg: String) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(502)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(Cow::Owned(msg.into_bytes()))
        .unwrap()
}

/// `orangeradio://wefile?path=<abs>`：读取 Wallpaper Engine Workshop 目录下文件。
///
/// 安全校验：path 经 canonicalize 后必须落在 AppState.we_roots 登记的根目录之下，
/// 否则 403（防 `..` 穿越、防读任意系统文件）。支持 Range（视频拖动）。
async fn handle_we_file(
    app: &tauri::AppHandle,
    request: &Request<Vec<u8>>,
    query: &HashMap<String, String>,
) -> Response<Cow<'static, [u8]>> {
    use std::io::{Read, Seek, SeekFrom};

    let path_str = match query.get("path") {
        Some(p) if !p.is_empty() => p.clone(),
        _ => return bad_request("missing path param".into()),
    };
    let path = std::path::PathBuf::from(&path_str);

    // 安全校验：必须在已登记 Workshop 根目录之下
    let state = app.state::<orange_tauri::AppState>();
    let mut roots = state.we_roots.read().clone();
    // 启动后未扫描（we_roots 空）：自动发现一次填充，避免 WE 壁纸重启后 wefile 全拒（黑屏）。
    // 首次请求触发，discover 完成后写入 AppState，后续请求 roots 非空直接走快路径。
    if roots.is_empty() {
        let discovered = orange_tauri::wallpaper_engine::discover_dirs();
        tracing::info!(
            "wefile 首次请求，自动发现 Workshop 根目录: {:?}",
            discovered
        );
        *state.we_roots.write() = discovered.clone();
        roots = discovered;
    }
    if !orange_tauri::wallpaper_engine::is_within_roots(&path, &roots) {
        tracing::warn!("wefile 拒绝越界路径: {}", path.display());
        return Response::builder()
            .status(403)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(Cow::Borrowed(&b"forbidden"[..]))
            .unwrap_or_else(|_| bad_request("forbidden".into()));
    }

    let metadata = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("wefile 读取元数据失败 {}: {}", path.display(), e);
            return bad_request("file not found".into());
        }
    };
    let total = metadata.len();
    let content_type = we_content_type(&path);

    // 解析 Range 头（形如 "bytes=0-1023" 或 "bytes=0-"）
    let (start, end, status) = match request.headers().get("range").and_then(|r| r.to_str().ok()) {
        Some(r) if r.starts_with("bytes=") => {
            let spec = &r[6..];
            let (s, e) = spec.split_once('-').unwrap_or((spec, ""));
            let start: u64 = s.parse().unwrap_or(0);
            let end: u64 = if e.is_empty() {
                total.saturating_sub(1)
            } else {
                e.parse().unwrap_or(total.saturating_sub(1))
            };
            (start, end.min(total.saturating_sub(1)), 206)
        }
        _ => (0, total.saturating_sub(1), 200),
    };

    if start > end || start >= total {
        return Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{}", total))
            .body(Cow::Borrowed(&b"range not satisfiable"[..]))
            .unwrap_or_else(|_| bad_request("range error".into()));
    }

    let len = end - start + 1;
    let mut buf = vec![0u8; len as usize];
    let read_result = std::fs::File::open(&path).and_then(|mut f| {
        f.seek(SeekFrom::Start(start))?;
        f.read_exact(&mut buf)?;
        Ok(())
    });
    if let Err(e) = read_result {
        tracing::warn!("wefile 读取文件失败 {}: {}", path.display(), e);
        return bad_request("read error".into());
    }

    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        // 始终带 Accept-Ranges:浏览器首探若走 200,带上此头能让它更早发后续 Range 请求
        .header("Accept-Ranges", "bytes");
    if status == 206 {
        builder = builder.header(
            "Content-Range",
            format!("bytes {}-{}/{}", start, end, total),
        );
    }
    builder = builder
        .header("Content-Length", len.to_string())
        .header("Access-Control-Allow-Origin", "*");
    builder
        .body(Cow::Owned(buf))
        .unwrap_or_else(|_| bad_request("response build failed".into()))
}

/// 按后缀推断 wefile 的 Content-Type（覆盖 Wallpaper Engine 常见格式）。
fn we_content_type(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        _ => "application/octet-stream",
    }
}

/// 手动解析 query string（避免引入 url crate）
fn parse_query(q: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in q.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut kv = pair.splitn(2, '=');
        let k = kv.next().unwrap_or("");
        let v = kv.next().unwrap_or("");
        if let Ok(decoded_key) = urldecode(k) {
            let decoded_val = urldecode(v).unwrap_or_default();
            map.insert(decoded_key, decoded_val);
        }
    }
    map
}

fn urldecode(s: &str) -> std::result::Result<String, ()> {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = hex_digit(bytes[i + 1])?;
                let lo = hex_digit(bytes[i + 2])?;
                out.push((hi << 4) | lo);
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| ())
}

fn hex_digit(b: u8) -> std::result::Result<u8, ()> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err(()),
    }
}
