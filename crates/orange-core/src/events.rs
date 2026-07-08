//! 事件总线
//!
//! 模块间解耦通信：播放器事件、AI 事件、社交事件等通过统一事件总线广播。

use parking_lot::RwLock;
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::broadcast;

/// 通用事件 (序列化后的 JSON 字符串，便于跨 IPC 传递)
pub type Event = String;

/// 事件订阅阅句柄
pub struct EventSubscription {
    rx: broadcast::Receiver<Event>,
}

impl EventSubscription {
    /// 异步接收一个事件
    pub async fn recv(&mut self) -> Option<Event> {
        self.rx.recv().await.ok()
    }
}

/// 事件总线：发布 / 订阅
#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<Event>,
    /// 最近事件缓存（便于新订阅者快速同步状态）
    #[allow(dead_code)]
    last_events: Arc<RwLock<std::collections::HashMap<String, Event>>>,
}

impl EventBus {
    pub fn new(buffer: usize) -> Self {
        let (tx, _) = broadcast::channel(buffer);
        Self {
            tx,
            last_events: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// 发布事件
    pub fn publish(&self, event: Event) {
        let _ = self.tx.send(event);
    }

    /// 订阅事件流
    pub fn subscribe(&self) -> EventSubscription {
        EventSubscription {
            rx: self.tx.subscribe(),
        }
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(256)
    }
}

// ===== 鉴权过期事件 =====

/// 登录态过期事件 payload（序列化到前端）
#[derive(Debug, Clone, Serialize)]
pub struct AuthExpiredPayload {
    /// 过期的音源名（"netease" / "qqmusic"）
    pub source: String,
    /// 人类可读的中文名（"网易云音乐" / "QQ音乐"）
    pub source_name: String,
    /// 过期原因（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 鉴权事件 sink 抽象
///
/// 各 source（netease/qqmusic 等）在 cookie 过期时调 `on_auth_expired`。
/// orange-tauri 注入的 sink 会把事件 emit 到前端 WebView，前端弹 toast 提示重新登录。
///
/// 这个 trait 在 orange-core 里定义是为了让 orange-sources 不直接依赖 tauri。
pub trait AuthEventSink: Send + Sync {
    fn on_auth_expired(&self, payload: AuthExpiredPayload);
}

/// 静默 sink：什么都不做，用于测试或默认 fallback
#[derive(Default)]
pub struct NoopAuthSink;

impl AuthEventSink for NoopAuthSink {
    fn on_auth_expired(&self, _payload: AuthExpiredPayload) {
        // 静默忽略
    }
}
