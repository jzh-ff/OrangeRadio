//! Wallpaper Engine 本地壁纸扫描器逻辑。
//!
//! 目录由前端 localStorage 管理、命令参数传入(沿用 LibraryScanner 范式);
//! Rust 侧不持久化路径配置,仅在 AppState 内存登记发现的 Workshop 根供 wefile 安全校验。

use orange_core::wallpaper_engine::WallpaperEngineKind;

/// 由 `file` 字段后缀为主、`general.type` 为辅判定壁纸类型。
pub fn infer_kind(file: &str, type_str: Option<&str>) -> WallpaperEngineKind {
    let lower = file.to_ascii_lowercase();
    if matches_ext(&lower, &[".mp4", ".webm", ".mov", ".mkv"]) {
        WallpaperEngineKind::Video
    } else if matches_ext(&lower, &[".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]) {
        WallpaperEngineKind::Picture
    } else if lower == "index.html" || lower.ends_with(".html") {
        WallpaperEngineKind::Web
    } else if lower.ends_with(".pkg") {
        WallpaperEngineKind::Scene
    } else if lower.ends_with(".exe") {
        WallpaperEngineKind::Application
    } else {
        match type_str.map(|s| s.to_ascii_lowercase()).as_deref() {
            Some("video") => WallpaperEngineKind::Video,
            Some("picture") => WallpaperEngineKind::Picture,
            Some("scene") => WallpaperEngineKind::Scene,
            Some("web") => WallpaperEngineKind::Web,
            Some("application") => WallpaperEngineKind::Application,
            _ => WallpaperEngineKind::Unknown,
        }
    }
}

fn matches_ext(lower: &str, exts: &[&str]) -> bool {
    exts.iter().any(|e| lower.ends_with(e))
}

/// 解析 Steam `libraryfolders.vdf`,提取所有 library 的 `path`。
///
/// vdf 片段形如:`"path"		"D:\\steam"`。只关心 "path" 行,提取引号内值并把 `\\` 还原为 `\`。
pub fn parse_libraryfolders(vdf: &str) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        let trimmed = line.trim_start();
        let Some(rest) = trimmed.strip_prefix("\"path\"") else { continue };
        let s = rest.trim_start();
        let Some(start) = s.find('"') else { continue };
        let after = &s[start + 1..];
        let Some(end) = after.find('"') else { continue };
        let raw = &after[..end];
        out.push(std::path::PathBuf::from(raw.replace("\\\\", "\\")));
    }
    out
}

/// 校验 path 的 canonical 形式是否落在任一 roots 之下(防 wefile 路径穿越)。
///
/// path 或任一 root 不存在/canonicalize 失败 → 返回 false(安全侧拒绝)。
pub fn is_within_roots(path: &std::path::Path, roots: &[std::path::PathBuf]) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    roots.iter().any(|root| {
        root.canonicalize()
            .map(|rc| canonical.starts_with(&rc))
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use orange_core::wallpaper_engine::WallpaperEngineKind;
    use std::path::PathBuf;

    #[test]
    fn infer_kind_by_file_extension() {
        assert_eq!(infer_kind("intro.mp4", None), WallpaperEngineKind::Video);
        assert_eq!(infer_kind("clip.WEBM", None), WallpaperEngineKind::Video);
        assert_eq!(infer_kind("a.mov", None), WallpaperEngineKind::Video);
        assert_eq!(infer_kind("poster.JPG", None), WallpaperEngineKind::Picture);
        assert_eq!(infer_kind("p.webp", None), WallpaperEngineKind::Picture);
        assert_eq!(infer_kind("scene.pkg", None), WallpaperEngineKind::Scene);
        assert_eq!(infer_kind("index.html", None), WallpaperEngineKind::Web);
        assert_eq!(infer_kind("page.HTML", None), WallpaperEngineKind::Web);
        assert_eq!(infer_kind("app.exe", None), WallpaperEngineKind::Application);
    }

    #[test]
    fn infer_kind_falls_back_to_type_str_when_file_unknown() {
        // file 判不出(无后缀/未知后缀)时,用 general.type 补充
        assert_eq!(infer_kind("weird", Some("Video")), WallpaperEngineKind::Video);
        assert_eq!(infer_kind("weird", Some("picture")), WallpaperEngineKind::Picture);
        assert_eq!(infer_kind("weird", Some("Scene")), WallpaperEngineKind::Scene);
        assert_eq!(infer_kind("weird", None), WallpaperEngineKind::Unknown);
        // file 后缀优先于 type_str
        assert_eq!(infer_kind("x.mp4", Some("Picture")), WallpaperEngineKind::Video);
    }

    #[test]
    fn parse_libraryfolders_extracts_paths() {
        let vdf = r#"
"libraryfolders"
{
    "0"
    {
        "path"		"D:\\steam"
        "apps" { "431960" "829438869" }
    }
    "1"
    {
        "path"		"E:\\SteamLibrary"
    }
}
"#;
        let paths = parse_libraryfolders(vdf);
        assert_eq!(paths, vec![PathBuf::from("D:\\steam"), PathBuf::from("E:\\SteamLibrary")]);
    }

    #[test]
    fn parse_libraryfolders_empty_when_no_paths() {
        assert!(parse_libraryfolders("nothing here").is_empty());
    }

    #[test]
    fn is_within_roots_blocks_traversal() {
        // 用临时目录构造 roots
        let tmp = std::env::temp_dir();
        let root = tmp.join("we_test_root");
        std::fs::create_dir_all(&root).unwrap();
        let inside = root.join("1081733658").join("preview.jpg");
        let outside = tmp.join("we_test_outside.txt");
        let roots = vec![root.clone()];
        // canonicalize 在不存在文件上会失败 → 函数返回 false(安全侧)
        // 先创建文件让 canonicalize 成功
        std::fs::create_dir_all(root.join("1081733658")).unwrap();
        std::fs::write(&inside, b"x").unwrap();
        std::fs::write(&outside, b"x").unwrap();
        assert!(is_within_roots(&inside, &roots));
        assert!(!is_within_roots(&outside, &roots));
        // 清理
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&outside);
    }
}
