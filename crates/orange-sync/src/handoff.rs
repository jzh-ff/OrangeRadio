//! 多设备接力

use orange_core::track::Track;
use serde::{Deserialize, Serialize};

/// 可接力的播放状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayState {
    pub track: Track,
    pub position_secs: f64,
    pub is_playing: bool,
    pub volume: f32,
}

/// 接力管理器
pub struct HandoffManager;

impl HandoffManager {
    /// 上报当前状态供其他设备接力
    /// v0.8 实现
    pub async fn broadcast(&self, _state: &PlayState) -> orange_core::Result<()> {
        Ok(())
    }

    /// 从其他设备接力
    pub async fn receive(&self) -> orange_core::Result<Option<PlayState>> {
        Ok(None)
    }
}
