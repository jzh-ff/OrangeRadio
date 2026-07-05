//! Wallpaper Engine 本地壁纸扫描的跨 IPC 域类型。
//!
//! 唯一真相源:前后端共享的载荷类型定义在此(项目硬约束:跨 IPC 结构体不入命令文件)。

use serde::{Deserialize, Serialize};

/// Wallpaper Engine 壁纸类型。
///
/// 判定以 `project.json` 的 `file` 字段后缀为主,`general.type` 为辅
/// (实测 413 个壁纸里 ~354 个 `general.type` 缺失或非标准值,不可单独依赖)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WallpaperEngineKind {
    Video,
    Picture,
    Scene,
    Web,
    Application,
    Unknown,
}

impl WallpaperEngineKind {
    /// 是否可被 OrangeRadio 直接设为播放器背景(其余类型需 Wallpaper Engine 本体渲染)。
    pub fn applicable(self) -> bool {
        matches!(self, Self::Video | Self::Picture)
    }
}

/// 单条扫描结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WallpaperEngineEntry {
    /// 壁纸文件夹名 = Steam Workshop ID
    pub workshop_id: String,
    pub title: String,
    pub kind: WallpaperEngineKind,
    /// 主资源相对路径(如 "index.html" / "scene.pkg" / "x.mp4")
    pub file: String,
    /// `general.preview` 相对路径(如 "preview.jpg"),可能缺失
    pub preview: Option<String>,
    /// 整个壁纸文件夹大小(字节)
    pub size_bytes: u64,
    /// `general.tags`,可能为空
    pub tags: Vec<String>,
    /// 是否可设为背景(= kind.applicable(),前端便捷字段)
    pub applicable: bool,
    /// 该壁纸所在绝对目录(wefile 读取 + 多目录溯源用)
    pub source_dir: String,
}

/// 扫描命令返回。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WallpaperEngineScanResult {
    pub entries: Vec<WallpaperEngineEntry>,
    /// 自动发现或前端传入的 Workshop 根目录(前端首次可写回 engineDirs 持久化)
    pub discovered_dirs: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applicable_only_video_and_picture() {
        assert!(WallpaperEngineKind::Video.applicable());
        assert!(WallpaperEngineKind::Picture.applicable());
        assert!(!WallpaperEngineKind::Scene.applicable());
        assert!(!WallpaperEngineKind::Web.applicable());
        assert!(!WallpaperEngineKind::Application.applicable());
        assert!(!WallpaperEngineKind::Unknown.applicable());
    }

    #[test]
    fn kind_serde_snake_case() {
        // 前端 TS 字面量必须与这里的序列化值对齐
        let v = serde_json::to_string(&WallpaperEngineKind::Video).unwrap();
        assert_eq!(v, "\"video\"");
        let k: WallpaperEngineKind = serde_json::from_str("\"picture\"").unwrap();
        assert_eq!(k, WallpaperEngineKind::Picture);
    }
}
