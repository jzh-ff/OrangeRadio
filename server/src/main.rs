//! OrangeRadio 社交后端入口
//!
//! v0.1 提供 health 健康检查 + 基础路由骨架。
//! v0.7 完整实现：一起听 / 协作歌单 / 创作发布 / 创意市场。

use axum::{routing::get, Router};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::EnvFilter;

mod routes;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let app = Router::new()
        .route("/", get(routes::index))
        .route("/health", get(routes::health))
        // v0.7 路由骨架
        .route("/api/auth", get(routes::auth_placeholder))
        .route("/api/playlists", get(routes::playlists_placeholder))
        .route("/api/listen-together", get(routes::listen_together_placeholder))
        .route("/api/studio/publish", get(routes::studio_publish_placeholder))
        .route("/api/market", get(routes::market_placeholder))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3847);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .expect("绑定端口失败");
    tracing::info!("🍊 OrangeRadio 社交后端已启动: http://localhost:{port}");
    axum::serve(listener, app).await.expect("服务器错误");
}
