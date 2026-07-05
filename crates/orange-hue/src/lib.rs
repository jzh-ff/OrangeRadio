//! # OrangeRadio Hue
//!
//! 智能光效联动（v0.8 MVP：Philips Hue Bridge API v2 经典接口）。
//!
//! ## 支持的流程
//! - `discover`：通过 nupnp（HTTPS discovery.meethue.com）发现局域网内的 Hue Bridge
//! - `pair`：配对（需用户先按 Bridge 顶部 link button），拿到 username token
//! - `set_state`：控制单盏灯（on/bri/hue/sat）
//! - 音乐驱动：节拍 / 封面主色调 → set_state（前端按节拍触发）
//!
//! ## 后续
//! - OpenRGB 协议（RGB 灯带 / 键盘灯）
//! - 频谱反应 / 氛围渐变（update 接口）

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

/// 发现到的 Hue Bridge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HueBridge {
    pub ip: String,
}

/// 灯光状态（Hue API v1：bri/hue/sat 都是 0~max）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightState {
    pub on: bool,
    /// 亮度 0~254
    pub bri: u32,
    /// 色相 0~65535
    pub hue: u32,
    /// 饱和度 0~254
    pub sat: u32,
}

/// nupnp 发现接口返回
#[derive(Deserialize)]
struct HueBridgeResp {
    internalipaddress: String,
}

/// 光效管理器
pub struct HueManager {
    pub mode: LightMode,
    client: reqwest::Client,
}

impl HueManager {
    pub fn new() -> Self {
        Self {
            mode: LightMode::Off,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_default(),
        }
    }

    /// 通过 nupnp 发现 Hue Bridge（HTTPS GET discovery.meethue.com）
    pub async fn discover(&self) -> orange_core::Result<Vec<HueBridge>> {
        let resp = self
            .client
            .get("https://discovery.meethue.com/")
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json::<Vec<HueBridgeResp>>()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        Ok(resp
            .into_iter()
            .map(|r| HueBridge {
                ip: r.internalipaddress,
            })
            .collect())
    }

    /// 配对（需用户先按 Bridge 顶部 link button，60s 内有效）→ 拿 username token
    pub async fn pair(&self, ip: &str) -> orange_core::Result<String> {
        let body = serde_json::json!({ "devicetype": "orangeradio#desktop" });
        let resp: Vec<serde_json::Value> = self
            .client
            .post(format!("http://{ip}/api"))
            .json(&body)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .json()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        // 成功：[{"success":{"username":"..."}}]；未按 button：[{"error":{...}}]
        if let Some(token) = resp
            .first()
            .and_then(|v| v.get("success"))
            .and_then(|s| s.get("username"))
            .and_then(|u| u.as_str())
        {
            Ok(token.to_string())
        } else {
            Err(orange_core::CoreError::AuthFailed(
                "配对失败：请先按 Hue Bridge 顶部的圆形按钮（link button）后再试".into(),
            ))
        }
    }

    /// 设置单盏灯状态（on/bri/hue/sat）
    pub async fn set_state(
        &self,
        ip: &str,
        token: &str,
        light_id: &str,
        state: &LightState,
    ) -> orange_core::Result<()> {
        let url = format!("http://{ip}/api/{token}/lights/{light_id}/state");
        let body = serde_json::json!({
            "on": state.on,
            "bri": state.bri,
            "hue": state.hue,
            "sat": state.sat,
        });
        self.client
            .put(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        Ok(())
    }

    /// 频谱驱动（保留接口，前端按节拍调 set_state 更直接）
    pub async fn update(&self, _spectrum: &SpectrumData) -> orange_core::Result<()> {
        Ok(())
    }
}

impl Default for HueManager {
    fn default() -> Self {
        Self::new()
    }
}
