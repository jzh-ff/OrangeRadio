//! Wallpaper Engine 本地壁纸扫描器逻辑。
//!
//! 目录由前端 localStorage 管理、命令参数传入(沿用 LibraryScanner 范式);
//! Rust 侧不持久化路径配置,仅在 AppState 内存登记发现的 Workshop 根供 wefile 安全校验。

use orange_core::wallpaper_engine::{
    WallpaperEngineEntry, WallpaperEngineKind, WallpaperEngineScanResult,
};
use std::path::{Path, PathBuf};

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
/// vdf 片段形如:`"path"        "D:\\steam"`。只关心 "path" 行,提取引号内值并把 `\\` 还原为 `\`。
pub fn parse_libraryfolders(vdf: &str) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        let trimmed = line.trim_start();
        let Some(rest) = trimmed.strip_prefix("\"path\"") else {
            continue;
        };
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

/// `project.json` 的瘦反序列化结构(serde 忽略未知字段,即便文件 256KB 也只取这几项)。
///
/// Wallpaper Engine 的 `file`/`title`/`type`/`preview`/`tags` 都在 JSON **顶层**;
/// `general` 块只装 `localization`/`properties`,不含这些字段。
#[derive(serde::Deserialize, Clone)]
struct ProjectJson {
    file: Option<String>,
    title: Option<String>,
    /// JSON 字段名 "type"(Wallpaper Engine 顶层字段)
    #[serde(rename = "type")]
    kind: Option<String>,
    preview: Option<String>,
    tags: Option<Vec<String>>,
}

/// 递归求目录总大小(字节)。失败返回 0。
fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for e in entries.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_file() {
            total += e.metadata().map(|m| m.len()).unwrap_or(0);
        } else if ft.is_dir() {
            total += dir_size(&e.path());
        }
    }
    total
}

/// 读单个 Workshop 根目录,返回其下每个壁纸子目录的 entry。损坏/无 project.json 的跳过并告警。
pub fn scan_dir(dir: &Path) -> Vec<WallpaperEngineEntry> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let sub = entry.path();
        if !sub.is_dir() {
            continue;
        }
        let workshop_id = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        let pj = sub.join("project.json");
        let text = match std::fs::read_to_string(&pj) {
            Ok(t) => t,
            Err(_) => continue, // 无 project.json,跳过
        };
        let proj: ProjectJson = match serde_json::from_str(&text) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("project.json 解析失败 {}: {}", pj.display(), e);
                continue;
            }
        };
        let file = proj.file.clone().unwrap_or_default();
        let title = proj.title.clone().unwrap_or_else(|| workshop_id.clone());
        let kind = infer_kind(&file, proj.kind.as_deref());
        out.push(WallpaperEngineEntry {
            workshop_id,
            title,
            kind,
            file,
            preview: proj.preview.clone(),
            size_bytes: dir_size(&sub),
            tags: proj.tags.clone().unwrap_or_default(),
            applicable: kind.applicable(),
            source_dir: sub.to_string_lossy().into_owned(),
        });
    }
    out
}

/// 自动发现 Wallpaper Engine 的 Workshop 根目录(`<lib>/steamapps/workshop/content/431960`)。
///
/// 策略:Windows 注册表读 SteamPath → 解析 libraryfolders.vdf 拿所有 library →
/// 对每个 library 探测 content/431960 是否存在。非 Windows 或读不到返回空。
pub fn discover_dirs() -> Vec<PathBuf> {
    let mut libs: Vec<PathBuf> = Vec::new();
    if let Some(steam) = read_steam_path_from_registry() {
        libs.push(steam.clone());
        let vdf = steam.join("steamapps").join("libraryfolders.vdf");
        if let Ok(text) = std::fs::read_to_string(&vdf) {
            libs.extend(parse_libraryfolders(&text));
        }
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    for lib in libs {
        let candidate = lib
            .join("steamapps")
            .join("workshop")
            .join("content")
            .join("431960");
        if candidate.is_dir() && !roots.contains(&candidate) {
            roots.push(candidate);
        }
    }
    roots
}

#[cfg(target_os = "windows")]
fn read_steam_path_from_registry() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let val = hkcu
        .open_subkey("Software\\Valve\\Steam")
        .ok()?
        .get_value::<String, _>("SteamPath")
        .ok()?;
    Some(PathBuf::from(val))
}

#[cfg(not(target_os = "windows"))]
fn read_steam_path_from_registry() -> Option<PathBuf> {
    None
}

/// 扫描入口(命令调用)。`dirs=Some` 用前端配置;`None` 自动发现。
pub async fn scan(dirs: Option<Vec<String>>) -> WallpaperEngineScanResult {
    let roots: Vec<PathBuf> = match dirs {
        Some(v) if !v.is_empty() => v.into_iter().map(PathBuf::from).collect(),
        _ => tokio::task::spawn_blocking(discover_dirs)
            .await
            .unwrap_or_else(|e| {
                tracing::error!("wallpaper scan (discover_dirs) 任务失败: {e}");
                Vec::new()
            }),
    };
    let roots_for_size = roots.clone();
    let entries = tokio::task::spawn_blocking(move || -> Vec<WallpaperEngineEntry> {
        let mut all = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for root in &roots_for_size {
            for e in scan_dir(root) {
                if seen.insert(e.workshop_id.clone()) {
                    all.push(e);
                }
            }
        }
        all
    })
    .await
    .unwrap_or_else(|e| {
        tracing::error!("wallpaper scan (scan_dir) 任务失败: {e}");
        Vec::new()
    });
    WallpaperEngineScanResult {
        entries,
        discovered_dirs: roots
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
    }
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
        assert_eq!(
            infer_kind("app.exe", None),
            WallpaperEngineKind::Application
        );
    }

    #[test]
    fn infer_kind_falls_back_to_type_str_when_file_unknown() {
        // file 判不出(无后缀/未知后缀)时,用 general.type 补充
        assert_eq!(
            infer_kind("weird", Some("Video")),
            WallpaperEngineKind::Video
        );
        assert_eq!(
            infer_kind("weird", Some("picture")),
            WallpaperEngineKind::Picture
        );
        assert_eq!(
            infer_kind("weird", Some("Scene")),
            WallpaperEngineKind::Scene
        );
        assert_eq!(infer_kind("weird", None), WallpaperEngineKind::Unknown);
        // file 后缀优先于 type_str
        assert_eq!(
            infer_kind("x.mp4", Some("Picture")),
            WallpaperEngineKind::Video
        );
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
        assert_eq!(
            paths,
            vec![
                PathBuf::from("D:\\steam"),
                PathBuf::from("E:\\SteamLibrary")
            ]
        );
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

    use std::fs;

    fn make_fixture(root: &std::path::Path) {
        // 视频壁纸
        let v = root.join("1001");
        fs::create_dir_all(&v).unwrap();
        fs::write(
            v.join("project.json"),
            r#"{"file":"clip.mp4","title":"My Video","type":"Video","preview":"preview.jpg","tags":["Anime"]}"#,
        ).unwrap();
        fs::write(v.join("clip.mp4"), b"fake").unwrap();
        fs::write(v.join("preview.jpg"), b"fake").unwrap();
        // 场景壁纸(无 tags)
        let s = root.join("1002");
        fs::create_dir_all(&s).unwrap();
        fs::write(
            s.join("project.json"),
            r#"{"file":"scene.pkg","title":"Scene One"}"#,
        )
        .unwrap();
        // 损坏的 project.json(应被跳过,不中断)
        let bad = root.join("1003");
        fs::create_dir_all(&bad).unwrap();
        fs::write(bad.join("project.json"), "{not json").unwrap();
        // 无 project.json 的子目录(应被跳过)
        fs::create_dir_all(root.join("1004")).unwrap();
    }

    #[test]
    fn scan_dir_parses_and_skips_bad() {
        let root = std::env::temp_dir().join("we_scan_test");
        let _ = fs::remove_dir_all(&root);
        make_fixture(&root);

        let mut entries = scan_dir(&root);
        entries.sort_by_key(|e| e.workshop_id.clone());

        assert_eq!(entries.len(), 2, "损坏/无 project.json 的应被跳过");
        let video = entries.iter().find(|e| e.workshop_id == "1001").unwrap();
        assert_eq!(video.title, "My Video");
        assert_eq!(video.kind, WallpaperEngineKind::Video);
        assert_eq!(video.preview.as_deref(), Some("preview.jpg"));
        assert!(video.applicable);
        assert_eq!(video.tags, vec!["Anime".to_string()]);
        assert!(video.size_bytes > 0);

        let scene = entries.iter().find(|e| e.workshop_id == "1002").unwrap();
        assert_eq!(scene.kind, WallpaperEngineKind::Scene);
        assert!(!scene.applicable);
        assert!(scene.tags.is_empty());

        let _ = fs::remove_dir_all(&root);
    }
}
