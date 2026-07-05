//! OrangeRadio 桌面应用入口

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::http::{Request, Response};
use tauri::Manager;
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

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    // 控制台层 + 文件层
    let console_layer = fmt::layer().with_target(true).with_filter(filter.clone());

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
            // Tauri 2 该闭包第一参数是 UriSchemeContext<'_, R>，.app_handle() 拿 &AppHandle<R>，
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
        .run(tauri::generate_context!())
        .expect("OrangeRadio 启动失败");
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
    let query: HashMap<String, String> = uri.query().map(|q| parse_query(q)).unwrap_or_default();

    match path.as_str() {
        "/qqstream" => handle_qq_stream(&request, &query).await,
        "/wefile" => handle_we_file(app, &request, &query).await,
        _ => bad_request(format!("unknown path: {}", path)),
    }
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

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();

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
    let body: &'static [u8] = Box::leak(msg.into_boxed_str()).as_bytes();
    Response::builder()
        .status(502)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(Cow::Borrowed(body))
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
        tracing::info!("wefile 首次请求，自动发现 Workshop 根目录: {:?}", discovered);
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
    let (start, end, status) = match request
        .headers()
        .get("range")
        .and_then(|r| r.to_str().ok())
    {
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
