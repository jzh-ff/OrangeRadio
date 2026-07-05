//! # OrangeRadio Sync
//!
//! 投屏与多设备接力。
//!
//! ## 能力
//! - DLNA / UPnP 投放（电视、网络音箱）
//! - AirPlay 投放（Apple TV、HomePod）
//! - 多设备播放状态同步 + 无缝接力
//! - 手机当遥控器

pub mod cast;
pub mod handoff;

pub use cast::{CastDevice, CastProtocol, DeviceCaster};
pub use handoff::{HandoffManager, PlayState};
