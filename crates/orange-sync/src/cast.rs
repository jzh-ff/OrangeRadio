//! 投屏（DLNA / AirPlay）

use serde::{Deserialize, Serialize};

/// 投放协议
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CastProtocol {
    Dlna,
    AirPlay,
    Chromecast,
}

/// 可投放设备
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastDevice {
    pub id: String,
    pub name: String,
    pub protocol: CastProtocol,
    pub address: String,
}

/// 设备投放器
pub struct DeviceCaster;

impl DeviceCaster {
    /// 扫描局域网内的投放设备
    /// v0.8 实现
    pub async fn discover(&self) -> orange_core::Result<Vec<CastDevice>> {
        Ok(vec![])
    }

    /// 投放当前播放到设备
    /// v0.8 实现
    pub async fn cast(&self, _device: &CastDevice) -> orange_core::Result<()> {
        Err(orange_core::CoreError::Unsupported(
            "投屏尚未实现 (v0.8)".into(),
        ))
    }
}
