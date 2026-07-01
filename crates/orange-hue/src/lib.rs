//! # OrangeRadio Hue
//!
//! 智能光效联动。
//!
//! ## 支持
//! - Philips Hue（官方 Bridge API v2）
//! - RGB 灯带 / 键盘灯（OpenRGB 协议）
//! - 音乐驱动的光效：随 BPM 跳动、按封面色调染色、频谱反应

use orange_audio::spectrum::SpectrumData;
use serde::{Deserialize, Serialize};

/// 光效设备
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightDevice {
    pub id: String,
    pub name: String,
    pub kind: LightKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LightKind {
    PhilipsHue,
    RgbStrip,
    Keyboard,
}

/// 光效模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LightMode {
    /// 跟随封面主色调
    AlbumColor,
    /// 随鼓点跳动
    BeatPulse,
    /// 频谱反应
    Spectrum,
    /// 氛围渐变
    Ambient,
    Off,
}

/// 光效管理器
pub struct HueManager {
    pub mode: LightMode,
}

impl HueManager {
    pub fn new() -> Self {
        Self { mode: LightMode::Off }
    }

    /// 扫描设备
    pub async fn discover(&self) -> orange_core::Result<Vec<LightDevice>> {
        Ok(vec![])
    }

    /// 根据频谱数据更新灯光（每帧调用）
    pub async fn update(&self, _spectrum: &SpectrumData) -> orange_core::Result<()> {
        Ok(())
    }
}

impl Default for HueManager {
    fn default() -> Self {
        Self::new()
    }
}
