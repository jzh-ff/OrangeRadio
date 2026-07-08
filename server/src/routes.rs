//! 路由处理

use axum::Json;
use serde_json::{json, Value};

pub async fn index() -> Json<Value> {
    Json(json!({
        "name": "OrangeRadio Server",
        "version": "0.1.0",
        "stage": "v0.1 地基",
        "docs": "/health"
    }))
}

pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "orangeradio-server" }))
}

#[allow(dead_code)]
pub async fn auth_placeholder() -> Json<Value> {
    Json(json!({ "feature": "用户认证", "stage": "v0.7" }))
}

#[allow(dead_code)]
pub async fn playlists_placeholder() -> Json<Value> {
    Json(json!({ "feature": "协作歌单", "stage": "v0.7" }))
}

#[allow(dead_code)]
pub async fn listen_together_placeholder() -> Json<Value> {
    Json(json!({ "feature": "一起听", "stage": "v0.7" }))
}

#[allow(dead_code)]
pub async fn studio_publish_placeholder() -> Json<Value> {
    Json(json!({ "feature": "创作发布/Remix", "stage": "v0.7" }))
}

#[allow(dead_code)]
pub async fn market_placeholder() -> Json<Value> {
    Json(json!({ "feature": "创意市场(皮肤/歌单/视觉场景)", "stage": "v0.9" }))
}
