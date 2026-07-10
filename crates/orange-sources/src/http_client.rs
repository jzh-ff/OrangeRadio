use dashmap::DashMap;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// 共享 HTTP 客户端 + 轻量 TTL 缓存。
///
/// - 统一 timeout/UA/连接池，避免各音源各自创建 reqwest::Client。
/// - 对幂等 GET 请求提供 `get_cached`，命中缓存时直接返回文本，减少重复网络请求。
/// - 相同 key 的并发请求共享一次 future，避免缓存击穿。
/// - **安全**：缓存 key 会把 `Cookie` / `Authorization` 等鉴权头哈希进去，
///   避免不同登录态命中同一缓存条目（跨用户串号）。带鉴权头的请求可安全缓存。
#[derive(Clone)]
pub struct HttpClient {
    inner: Arc<reqwest::Client>,
    cache: Arc<DashMap<String, CacheEntry>>,
    in_flight: Arc<DashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

struct CacheEntry {
    inserted_at: Instant,
    body: String,
}

/// 参与缓存 key 计算的鉴权头名称（小写比较）。
/// 这些头的值直接决定响应内容，必须进 key 才能避免跨用户串号。
const AUTH_HEADERS: [&str; 2] = ["cookie", "authorization"];

/// 构造缓存 key：`GET:<url>:<鉴权头指纹>`。
/// 鉴权头（Cookie/Authorization）的值经哈希后拼进 key，确保不同登录态隔离；
/// 无鉴权头的公开请求，key 退化为纯 url。
fn cache_key(url: &str, extra_headers: &[(&str, &str)]) -> String {
    let mut auth_values: Vec<&str> = Vec::new();
    for (name, value) in extra_headers {
        if AUTH_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
            auth_values.push(*value);
        }
    }
    if auth_values.is_empty() {
        format!("GET:{url}")
    } else {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        for v in &auth_values {
            v.hash(&mut hasher);
        }
        format!("GET:{url}:a{:016x}", hasher.finish())
    }
}

impl HttpClient {
    /// 创建默认 client：30s 超时，标准 UA。
    pub fn new() -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 OrangeRadio",
            ),
        );
        let builder = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(20);
        // reqwest Client 构建极少失败（TLS 后端初始化异常等），失败时降级到默认 Client
        // 而非 panic —— 避免单例构建失败带崩整个 Tauri 应用。
        let inner = builder.build().unwrap_or_else(|_| reqwest::Client::new());
        Self {
            inner: Arc::new(inner),
            cache: Arc::new(DashMap::new()),
            in_flight: Arc::new(DashMap::new()),
        }
    }

    /// 共享底层 reqwest::Client（复用连接池/TLS，避免每次请求重建 client）。
    /// 供需要自定义请求（如流式转发、Range、二进制下载）的调用方使用。
    pub fn client(&self) -> &reqwest::Client {
        &self.inner
    }

    /// 返回一个周期性清理过期缓存的后台 future。
    ///
    /// 调用方负责把它 spawn 到合适的 runtime（Tauri 应用应使用
    /// `tauri::async_runtime::spawn`，因为 setup 闭包是同步上下文，
    /// 直接 `tokio::spawn` 会 panic）。
    ///
    /// 每 `interval_secs` 秒清一次超过 `ttl_secs` 的条目。
    pub fn prune_loop(
        self,
        interval_secs: u64,
        ttl_secs: u64,
    ) -> impl std::future::Future<Output = ()> {
        let interval = Duration::from_secs(interval_secs);
        async move {
            loop {
                tokio::time::sleep(interval).await;
                self.prune_cache(ttl_secs);
            }
        }
    }

    /// 不缓存的 GET 请求。
    pub async fn get(
        &self,
        url: &str,
        extra_headers: &[(&str, &str)],
    ) -> orange_core::Result<String> {
        self.request_text(reqwest::Method::GET, url, extra_headers, None)
            .await
    }

    /// 带 TTL 缓存的 GET 请求。适合搜索、歌单详情、歌词、榜单等幂等接口。
    ///
    /// 缓存 key 含鉴权头指纹，因此带 Cookie/Authorization 的请求也会按登录态隔离，
    /// 不会跨用户串号。
    pub async fn get_cached(
        &self,
        url: &str,
        extra_headers: &[(&str, &str)],
        ttl_secs: u64,
    ) -> orange_core::Result<String> {
        let key = cache_key(url, extra_headers);
        let now = Instant::now();
        let ttl = Duration::from_secs(ttl_secs);

        if let Some(entry) = self.cache.get(&key) {
            if now.duration_since(entry.inserted_at) < ttl {
                return Ok(entry.body.clone());
            }
        }

        // 并发去重：同 key 同时只有一个请求真正发出，其余在锁上等待后命中缓存。
        let slot = self
            .in_flight
            .entry(key.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();

        let _guard = slot.lock().await;
        // 拿到锁后复查缓存（前一个请求可能刚把结果写进去）
        if let Some(entry) = self.cache.get(&key) {
            if now.duration_since(entry.inserted_at) < ttl {
                return Ok(entry.body.clone());
            }
        }

        let body = self
            .request_text(reqwest::Method::GET, url, extra_headers, None)
            .await?;
        self.cache.insert(
            key.clone(),
            CacheEntry {
                inserted_at: now,
                body: body.clone(),
            },
        );
        Ok(body)
    }

    /// 缓存 JSON GET 并直接反序列化。
    pub async fn get_cached_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        extra_headers: &[(&str, &str)],
        ttl_secs: u64,
    ) -> orange_core::Result<T> {
        let text = self.get_cached(url, extra_headers, ttl_secs).await?;
        serde_json::from_str(&text)
            .map_err(|e| orange_core::CoreError::Network(format!("JSON 解析失败: {e}")))
    }

    /// POST 请求（不缓存）。
    pub async fn post(
        &self,
        url: &str,
        extra_headers: &[(&str, &str)],
        form: Option<Vec<(String, String)>>,
    ) -> orange_core::Result<String> {
        self.request_text(reqwest::Method::POST, url, extra_headers, form)
            .await
    }

    /// POST JSON 请求（不缓存）。
    pub async fn post_json<T: serde::Serialize + ?Sized>(
        &self,
        url: &str,
        extra_headers: &[(&str, &str)],
        body: &T,
    ) -> orange_core::Result<String> {
        let mut req = self.inner.post(url);
        for (k, v) in extra_headers {
            req = apply_header(req, k, v)?;
        }
        let resp = req
            .json(body)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(orange_core::CoreError::Network(format!(
                "HTTP {}: {}",
                resp.status(),
                url
            )));
        }
        resp.text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))
    }

    async fn request_text(
        &self,
        method: reqwest::Method,
        url: &str,
        extra_headers: &[(&str, &str)],
        form: Option<Vec<(String, String)>>,
    ) -> orange_core::Result<String> {
        let mut req = self.inner.request(method, url);
        for (k, v) in extra_headers {
            req = apply_header(req, k, v)?;
        }
        if let Some(f) = form {
            req = req.form(&f);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(orange_core::CoreError::Network(format!(
                "HTTP {}: {}",
                resp.status(),
                url
            )));
        }
        resp.text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))
    }

    /// 后台清理过期缓存（可由 `prune_loop` 周期调用）。
    pub fn prune_cache(&self, ttl_secs: u64) {
        let now = Instant::now();
        let ttl = Duration::from_secs(ttl_secs);
        self.cache
            .retain(|_, entry| now.duration_since(entry.inserted_at) < ttl);
    }
}

/// 安全地为请求设置 header：非法 header name/value 返回错误而非 panic。
/// （reqwest 的 `.header(&str, &str)` 在 value 含非 ASCII 字符时会 panic。）
fn apply_header(
    mut req: reqwest::RequestBuilder,
    name: &str,
    value: &str,
) -> orange_core::Result<reqwest::RequestBuilder> {
    let name = HeaderName::from_bytes(name.as_bytes())
        .map_err(|e| orange_core::CoreError::Network(format!("非法 header name {name}: {e}")))?;
    let value = HeaderValue::from_str(value).map_err(|e| {
        orange_core::CoreError::Network(format!("非法 header value for {name}: {e}"))
    })?;
    req = req.header(name, value);
    Ok(req)
}

/// UTF-8 安全地截取字符串前 `max` 字节，避免在多字节字符中间切断导致 panic。
pub fn safe_truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &s[..end]
    }
}

impl Default for HttpClient {
    fn default() -> Self {
        Self::new()
    }
}
