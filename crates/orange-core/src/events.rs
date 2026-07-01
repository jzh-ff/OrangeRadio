//! 事件总线
//!
//! 模块间解耦通信：播放器事件、AI 事件、社交事件等通过统一事件总线广播。

use parking_lot::RwLock;
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
