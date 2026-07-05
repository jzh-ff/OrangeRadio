//! OrangeRadio 社交后端入口
//!
//! v0.7 一起听（Listen Together）：WebSocket room，客户端把 play/pause/seek/track
//! 等同步消息发到 room，服务器广播给 room 内其他客户端，实现跨端同步播放。
//! 协作歌单 / 创作发布 / 创意市场留后续。

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::EnvFilter;

mod routes;

/// room 注册表：room_id → broadcast sender（所有客户端共享同一 channel）
type Rooms = Arc<Mutex<HashMap<String, broadcast::Sender<String>>>>;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    let app = Router::new()
        .route("/", get(routes::index))
        .route("/health", get(routes::health))
        // 一起听 WebSocket：/ws/room/{room_id}
        .route("/ws/room/{room_id}", get(ws_room))
        .with_state(rooms)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3847);
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .expect("绑定端口失败");
    tracing::info!("🍊 OrangeRadio 社交后端已启动: http://localhost:{port}（一起听 WS: /ws/room/<id>）");
    axum::serve(listener, app).await.expect("服务器错误");
}

/// WebSocket 升级：/ws/room/{room_id}
async fn ws_room(
    Path(room_id): Path<String>,
    ws: WebSocketUpgrade,
    State(rooms): State<Rooms>,
) -> impl IntoResponse {
    tracing::info!("一起听客户端加入 room={}", room_id);
    ws.on_upgrade(move |socket| handle_room(socket, room_id, rooms))
}

/// 处理一个一起听客户端：订阅 room 广播 + 把收到的消息广播给 room
async fn handle_room(socket: WebSocket, room_id: String, rooms: Rooms) {
    let (mut sender, mut receiver) = socket.split();

    // 加入 room（不存在则创建）→ 拿订阅 rx + 广播 tx
    let (rx, room_tx) = {
        let mut map = rooms.lock().await;
        let tx = map
            .entry(room_id.clone())
            .or_insert_with(|| broadcast::channel::<String>(64).0)
            .clone();
        (tx.subscribe(), tx)
    };

    // 任务 A：room 广播 → 发给本客户端
    let mut send_task = tokio::spawn(async move {
        let mut rx = rx;
        loop {
            match rx.recv().await {
                Ok(msg) => {
                    if sender.send(Message::Text(msg)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });

    // 任务 B：接收本客户端 → 广播给 room（其他客户端收到）
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(t) = msg {
                let _ = room_tx.send(t);
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => {}
        _ = &mut recv_task => {}
    }
}
