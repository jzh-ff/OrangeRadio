//! OrangeRadio 桌面应用入口

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::http::{Request, Response};
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
            tauri_plugin_global_shortcut::Builder::default()
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol("orangeradio", |_ctx, request, responder| {
            // handler 是同步的，但 reqwest 拉流是异步的 → tokio::spawn 异步执行
            tokio::spawn(async move {
                let response = handle_orangeradio_protocol(request).await;
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
async fn handle_orangeradio_protocol(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let uri = request.uri();
    let path = uri.path().to_string();
    let query: HashMap<String, String> = uri.query().map(|q| parse_query(q)).unwrap_or_default();

    match path.as_str() {
        "/qqstream" => handle_qq_stream(&request, &query).await,
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
