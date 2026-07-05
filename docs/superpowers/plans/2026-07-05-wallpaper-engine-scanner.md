# Wallpaper Engine 本地壁纸扫描器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有壁纸功能中扫描本地 Steam Wallpaper Engine 壁纸库,展示(名字/格式/预览/大小),视频/图片类型可一键设为播放器背景。

**Architecture:** Rust 侧新增扫描器(读注册表+`libraryfolders.vdf` 发现 Workshop 目录,瘦反序列化 `project.json`),经 IPC 命令返回;复用现有 `orangeradio://` 自定义协议加 `/wefile` 分支读取 Steam 目录文件(根目录白名单防穿越);前端在 `WallpaperPicker` 同页展开结果网格。

**Tech Stack:** Rust 2021 / Tauri 2 / serde / winreg(Windows 注册表)/ React 18 + TypeScript + Zustand

## Global Constraints

> 摘自 spec § 项目硬约束,每个任务默认遵守。

- **命令注册位置**:`#[tauri::command]` 只能在 `crates/orange-tauri/src/commands.rs::register_all` 注册,别处会被 harness 拒绝
- **IPC 载荷**:跨 IPC 结构体定义在 `orange-core`,不在命令文件就地定义
- **serde 命名**:枚举/结构体统一 `#[serde(rename_all = "snake_case")]`,前端 TS 字面量必须对齐
- **语言**:中文回复用户;代码标识符/crate 名/命令名英文
- **合并门槛**:`cargo build -p orangeradio-desktop` + `npm run build`(即 `tsc -b && vite build`)双绿
- **MSVC 工具链**:裸 cargo 命令前先跑 `.\run.ps1`(把 MSVC link.exe 推到 PATH 最前),否则报 `link: extra operand`
- **Rust 诊断**:库代码用 `tracing::*!`,禁止 `println!`;`unwrap()` 仅限测试或 `expect("invariant: ...")`
- **前端**:严格 TS(禁 `any`,用 `unknown` 收窄);状态走 Zustand store 不用组件 `useState`;CSS 文件与组件同目录同命名;`npm run build` 别拆开跑
- **Git**:`main` 禁止直推;开新分支;Conventional Commits(`feat:`/`fix:`/`refactor:` 等);多 crate 改动在 commit 正文列影响点
- **测试策略**:项目无测试框架;Rust 纯函数就近 `#[cfg(test)]` + `cargo test`;前端靠 `npx tsc -b --noEmit` + `npm run build`;无 Vitest

## File Structure

| 文件 | 责任 | 创建/修改 |
|------|------|----------|
| `crates/orange-core/src/wallpaper_engine.rs` | 域类型:`WallpaperEngineKind` / `WallpaperEngineEntry` / `WallpaperEngineScanResult` | 创建 |
| `crates/orange-core/src/lib.rs` | 挂载新模块 | 修改 |
| `crates/orange-tauri/src/wallpaper_engine.rs` | 扫描逻辑:`infer_kind` / `parse_libraryfolders` / `is_within_roots` / `dir_size` / `scan_dir` / `discover_dirs` / `scan` | 创建 |
| `crates/orange-tauri/src/lib.rs` | `pub mod wallpaper_engine;` + `AppState` 加 `we_roots` | 修改 |
| `crates/orange-tauri/Cargo.toml` | 加 Windows-only `winreg` 依赖 | 修改 |
| `crates/orange-tauri/src/commands.rs` | `wallpaper_engine_scan` 命令 + 注册 | 修改 |
| `apps/desktop/src-tauri/src/lib.rs` | `orangeradio://` handler 加 `/wefile` 分支 + `handle_we_file` | 修改 |
| `frontend/src/lib/webviewUrl.ts` | 从 `useAudioEngine.ts` 抽出的 `toWebviewUrl`(DRY 共享) | 创建 |
| `frontend/src/features/player/useAudioEngine.ts` | 改为从 `lib/webviewUrl.ts` import `toWebviewUrl` | 修改 |
| `frontend/src/lib/wallpaperEngine.ts` | 前端类型 + `weFileUrl` / `weKindLabel` / `formatSize` / `scanWallpaperEngine` | 创建 |
| `frontend/src/stores/wallpaperStore.ts` | 加 `engineDirs` / `engineEntries` / `engineScanning` / `scanWallpaperEngine` / `addEngineDir` | 修改 |
| `frontend/src/components/WallpaperEngineGrid.tsx` | 结果网格 + 工具栏 + 懒加载 | 创建 |
| `frontend/src/components/wallpaper-engine.css` | 网格样式 | 创建 |
| `frontend/src/components/WallpaperPicker.tsx` | 加「Wallpaper Engine」入口卡片 + 渲染 Grid | 修改 |

## 任务依赖

```
Task1 → Task3 → Task4 → Task5   (后端链)
Task2 ↗(Task3, Task5 用)
Task6 → Task7                    (前端链;Task7 需后端 Task4/5 可用)
```

---

## Task 1: orange-core 域类型

**Files:**
- Create: `crates/orange-core/src/wallpaper_engine.rs`
- Modify: `crates/orange-core/src/lib.rs`

**Interfaces:**
- Produces: `WallpaperEngineKind`(枚举,serde snake_case,含 `applicable()` 方法)、`WallpaperEngineEntry`(结构体,字段见下)、`WallpaperEngineScanResult { entries, discovered_dirs }`。后续 Task 3/4/6 依赖这些类型名与字段名。

- [ ] **Step 1: 创建域类型文件**

创建 `crates/orange-core/src/wallpaper_engine.rs`:

```rust
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
```

- [ ] **Step 2: 挂载模块**

修改 `crates/orange-core/src/lib.rs`,在现有 `pub mod ...` 列表里加一行(位置与其他 `pub mod` 一致):

```rust
pub mod wallpaper_engine;
```

- [ ] **Step 3: 加 `applicable()` 单测**

在 `crates/orange-core/src/wallpaper_engine.rs` 末尾追加:

```rust
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
```

- [ ] **Step 4: 跑测试与构建**

> 先 `.\run.ps1` 一次(修 MSVC link.exe PATH),或确认已修。

Run: `cargo test -p orange-core wallpaper_engine`
Expected: PASS(2 tests)

Run: `cargo build -p orange-core`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add crates/orange-core/src/wallpaper_engine.rs crates/orange-core/src/lib.rs
git commit -m "feat(orange-core): 新增 Wallpaper Engine 扫描域类型"
```

---

## Task 2: 扫描器纯函数(infer_kind / parse_libraryfolders / is_within_roots)

TDD。这三个是纯函数,先写测试。

**Files:**
- Create: `crates/orange-tauri/src/wallpaper_engine.rs`
- Modify: `crates/orange-tauri/src/lib.rs`(挂模块)
- Modify: `crates/orange-tauri/Cargo.toml`(暂不加 winreg,本任务不需要;Task 3 加)

**Interfaces:**
- Consumes: `orange_core::wallpaper_engine::{WallpaperEngineKind, ...}`(Task 1)
- Produces: `pub fn infer_kind(file: &str, type_str: Option<&str>) -> WallpaperEngineKind`、`pub fn parse_libraryfolders(vdf: &str) -> Vec<std::path::PathBuf>`、`pub fn is_within_roots(path: &std::path::Path, roots: &[std::path::PathBuf]) -> bool`。Task 3/5 依赖。

- [ ] **Step 1: 挂模块 + 写失败测试**

修改 `crates/orange-tauri/src/lib.rs`,在 `pub mod ...` 区加:

```rust
pub mod wallpaper_engine;
```

创建 `crates/orange-tauri/src/wallpaper_engine.rs`,先只放测试模块(函数未定义,测试应编译失败):

```rust
//! Wallpaper Engine 本地壁纸扫描器逻辑。
//!
//! 目录由前端 localStorage 管理、命令参数传入(沿用 LibraryScanner 范式);
//! Rust 侧不持久化路径配置,仅在 AppState 内存登记发现的 Workshop 根供 wefile 安全校验。

use orange_core::wallpaper_engine::WallpaperEngineKind;

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test -p orange-tauri wallpaper_engine`
Expected: 编译失败(`infer_kind` / `parse_libraryfolders` / `is_within_roots` 未定义)

- [ ] **Step 3: 实现三个纯函数**

在 `crates/orange-tauri/src/wallpaper_engine.rs` 顶部(`use` 之后、`#[cfg(test)]` 之前)插入实现:

```rust
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test -p orange-tauri wallpaper_engine`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add crates/orange-tauri/src/wallpaper_engine.rs crates/orange-tauri/src/lib.rs
git commit -m "feat(orange-tauri): Wallpaper Engine 扫描纯函数(infer_kind/parse_libraryfolders/is_within_roots)"
```

---

## Task 3: 扫描编排(scan_dir / discover_dirs / scan)+ winreg 依赖

**Files:**
- Modify: `crates/orange-tauri/Cargo.toml`(加 winreg)
- Modify: `crates/orange-tauri/src/wallpaper_engine.rs`(加扫描编排)
- Modify: 根 `Cargo.toml`(workspace deps 加 winreg)—— *若 orange-tauri/Cargo.toml 直接写版本则跳过根*

**Interfaces:**
- Consumes: Task 1 类型、Task 2 三个纯函数
- Produces: `pub fn scan_dir(dir: &std::path::Path) -> Vec<WallpaperEngineEntry>`、`pub fn discover_dirs() -> Vec<std::path::PathBuf>`、`pub async fn scan(dirs: Option<Vec<String>>) -> WallpaperEngineScanResult`。Task 4 命令依赖 `scan`。

- [ ] **Step 1: 加 winreg 依赖(Windows-only)**

修改 `crates/orange-tauri/Cargo.toml`,在 `[dependencies]` 之后追加:

```toml
[target.'cfg(windows)'.dependencies]
winreg = "0.52"
```

> 若构建报版本冲突,改成 `winreg = "0.5"`。API(`RegKey::predef` / `open_subkey` / `get_value`)自 0.5 稳定。

- [ ] **Step 2: 写 scan_dir 失败测试(临时目录 fixture)**

在 `crates/orange-tauri/src/wallpaper_engine.rs` 的 `tests` 模块内追加:

```rust
    use orange_core::wallpaper_engine::WallpaperEngineEntry;
    use std::fs;

    fn make_fixture(root: &std::path::Path) {
        // 视频壁纸
        let v = root.join("1001");
        fs::create_dir_all(&v).unwrap();
        fs::write(
            v.join("project.json"),
            r#"{"file":"clip.mp4","general":{"title":"My Video","type":"Video","preview":"preview.jpg","tags":["Anime"]}}"#,
        ).unwrap();
        fs::write(v.join("clip.mp4"), b"fake").unwrap();
        fs::write(v.join("preview.jpg"), b"fake").unwrap();
        // 场景壁纸(无 tags)
        let s = root.join("1002");
        fs::create_dir_all(&s).unwrap();
        fs::write(
            s.join("project.json"),
            r#"{"file":"scene.pkg","general":{"title":"Scene One"}}"#,
        ).unwrap();
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
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cargo test -p orange-tauri scan_dir`
Expected: 编译失败(`scan_dir` 未定义)

- [ ] **Step 4: 实现 scan_dir + 辅助结构 + discover_dirs + scan**

在 `crates/orange-tauri/src/wallpaper_engine.rs` 顶部 `use` 区改为:

```rust
use orange_core::wallpaper_engine::{WallpaperEngineEntry, WallpaperEngineScanResult};
use std::path::{Path, PathBuf};
```

> `WallpaperEngineKind` 已在 Task 2 的模块级 `use` 引入,无需重复。

在纯函数之后(`#[cfg(test)]` 之前)追加下面这一段(连同辅助结构):

```rust
/// `project.json` 的瘦反序列化结构(serde 忽略未知字段,即便文件 256KB 也只取这几项)。
#[derive(serde::Deserialize)]
struct ProjectJson {
    file: Option<String>,
    general: Option<GeneralBlock>,
}

#[derive(serde::Deserialize)]
struct GeneralBlock {
    title: Option<String>,
    /// JSON 字段名 "type"
    #[serde(rename = "type")]
    kind: Option<String>,
    preview: Option<String>,
    tags: Option<Vec<String>>,
}

/// 递归求目录总大小(字节)。失败返回 0。
fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
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
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for entry in entries.flatten() {
        let sub = entry.path();
        if !sub.is_dir() { continue; }
        let workshop_id = match entry.file_name().into_string() { Ok(s) => s, Err(_) => continue };
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
        let general = proj.general.clone();
        let title = general
            .as_ref()
            .and_then(|g| g.title.clone())
            .unwrap_or_else(|| workshop_id.clone());
        let kind = infer_kind(&file, general.as_ref().and_then(|g| g.kind.as_deref()));
        out.push(WallpaperEngineEntry {
            workshop_id,
            title,
            kind,
            file,
            preview: general.as_ref().and_then(|g| g.preview.clone()),
            size_bytes: dir_size(&sub),
            tags: general.as_ref().and_then(|g| g.tags.clone()).unwrap_or_default(),
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
        let candidate = lib.join("steamapps").join("workshop").join("content").join("431960");
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
        _ => tokio::task::spawn_blocking(discover_dirs).await.unwrap_or_default(),
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
    .unwrap_or_default();
    WallpaperEngineScanResult {
        entries,
        discovered_dirs: roots.into_iter().map(|p| p.to_string_lossy().into_owned()).collect(),
    }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cargo test -p orange-tauri wallpaper_engine`
Expected: PASS(6 tests,含新增 `scan_dir_parses_and_skips_bad`)

Run: `cargo build -p orange-tauri`
Expected: 编译通过(winreg 在 Windows 拉取成功)

- [ ] **Step 6: Commit**

```bash
git add crates/orange-tauri/Cargo.toml crates/orange-tauri/src/wallpaper_engine.rs
git commit -m "feat(orange-tauri): Wallpaper Engine 扫描编排(scan_dir/discover_dirs/scan)"
```

---

## Task 4: AppState 加 we_roots + wallpaper_engine_scan 命令 + 注册

**Files:**
- Modify: `crates/orange-tauri/src/lib.rs`(AppState 加字段)
- Modify: `crates/orange-tauri/src/commands.rs`(命令 + 注册)

**Interfaces:**
- Consumes: Task 3 `scan`、Task 1 `WallpaperEngineScanResult`
- Produces: Tauri 命令 `wallpaper_engine_scan({ dirs: Option<Vec<String>> }) -> WallpaperEngineScanResult`;`AppState.we_roots: parking_lot::RwLock<Vec<PathBuf>>`。Task 5 的 wefile handler 读 `we_roots`。

- [ ] **Step 1: AppState 加 we_roots 字段**

修改 `crates/orange-tauri/src/lib.rs`。找到 `AppState` 结构体定义,加一个字段(放在现有 `Arc` 字段之后,保持结构体风格一致):

```rust
pub struct AppState {
    // ... 现有字段 ...
    /// Wallpaper Engine Workshop 根目录白名单(wefile 安全校验用)。
    /// 扫描命令完成后写入。
    pub we_roots: parking_lot::RwLock<Vec<std::path::PathBuf>>,
}
```

在 `AppState::default()` / `new()` 实现(看现有写法)里初始化:

```rust
we_roots: parking_lot::RwLock::new(Vec::new()),
```

> 如果 AppState 用 `Default` derive,改为手动 `impl Default` 或在 derive 后用 builder;参考现有字段初始化方式保持一致。若 derive 困难,把该字段类型改为 `std::sync::Arc<parking_lot::RwLock<Vec<std::path::PathBuf>>>` 并在 `#[derive(Clone)]` 上无影响(parking_lot::RwLock 不是 Default,但手动初始化即可)。

- [ ] **Step 2: 加命令**

修改 `crates/orange-tauri/src/commands.rs`。在 `wallpaper_remove` 之后(壁纸命令区)追加:

```rust
/// 扫描本地 Wallpaper Engine 壁纸。
///
/// `dirs=Some` 用前端配置目录;`None` 自动发现(注册表 + libraryfolders.vdf)。
/// 扫描完成后把发现的 Workshop 根目录登记到 AppState.we_roots,供 orangeradio://wefile 安全校验。
#[tauri::command]
pub async fn wallpaper_engine_scan(
    state: tauri::State<'_, crate::AppState>,
    dirs: Option<Vec<String>>,
) -> Result<orange_core::wallpaper_engine::WallpaperEngineScanResult, String> {
    let result = crate::wallpaper_engine::scan(dirs).await;
    let roots: Vec<std::path::PathBuf> = result
        .discovered_dirs
        .iter()
        .map(std::path::PathBuf::from)
        .collect();
    *state.we_roots.write() = roots;
    tracing::info!(
        "Wallpaper Engine 扫描完成:{} 条壁纸,根目录 {:?}",
        result.entries.len(),
        result.discovered_dirs
    );
    Ok(result)
}
```

- [ ] **Step 3: 注册命令**

修改 `crates/orange-tauri/src/commands.rs::register_all`。在 `.invoke_handler(tauri::generate_handler![ ... ])` 的命令列表里加(按字母序或就近壁纸命令位置):

```rust
wallpaper_engine_scan,
```

- [ ] **Step 4: 构建验证**

Run: `cargo build -p orangeradio-desktop`
Expected: 编译通过(orange-tauri + desktop 一起)

- [ ] **Step 5: Commit**

```bash
git add crates/orange-tauri/src/lib.rs crates/orange-tauri/src/commands.rs
git commit -m "feat(orange-tauri): wallpaper_engine_scan 命令 + AppState.we_roots 白名单"
```

---

## Task 5: orangeradio:// 加 /wefile 分支(预览图/视频文件读取 + 路径安全)

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Task 2 `is_within_roots`、Task 4 `AppState.we_roots`、现有 `parse_query` / `bad_request`
- Produces: `orangeradio://localhost/wefile?path=<abs>` 可读取 Workshop 目录下文件(图片/视频),透传 `content-type` / `content-length` / `Range`

- [ ] **Step 1: 改 handler 签名 capture app handle + 加 /wefile 分支**

修改 `apps/desktop/src-tauri/src/lib.rs`。把 `register_asynchronous_uri_scheme_protocol` 的闭包从 `|_ctx, request, responder|` 改为 capture app handle 并把 `handle_orangeradio_protocol` 调用传入 app:

```rust
.register_asynchronous_uri_scheme_protocol("orangeradio", |app, request, responder| {
    tokio::spawn(async move {
        let response = handle_orangeradio_protocol(app, request).await;
        responder.respond(response);
    });
});
```

> Tauri 2 的 URI scheme handler 第一个参数是 `&AppHandle`(原代码命名 `_ctx`)。这里改名 `app` 以便传给 handler。

- [ ] **Step 2: 改 handle_orangeradio_protocol 签名 + 加分支**

修改 `handle_orangeradio_protocol`,接收 app handle 并加 `/wefile` 分支:

```rust
async fn handle_orangeradio_protocol(
    app: &tauri::AppHandle,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let uri = request.uri();
    let path = uri.path().to_string();
    let query: HashMap<String, String> = uri.query().map(|q| parse_query(q)).unwrap_or_default();

    match path.as_str() {
        "/qqstream" => handle_qq_stream(&request, &query).await,
        "/wefile" => handle_we_file(app, &request, &query).await,
        _ => bad_request(format!("unknown path: {}", path)),
    }
}
```

- [ ] **Step 3: 实现 handle_we_file(含 Range 支持 + 路径白名单)**

在 `apps/desktop/src-tauri/src/lib.rs`(其他 `handle_*` 函数附近)追加。文件读取 + Range(支持视频拖动):

```rust
/// `orangeradio://wefile?path=<abs>`:读取 Wallpaper Engine Workshop 目录下文件。
///
/// 安全校验:path 经 canonicalize 后必须落在 AppState.we_roots 登记的根目录之下,
/// 否则 403(防 `..` 穿越、防读任意系统文件)。支持 Range(视频拖动)。
async fn handle_we_file(
    app: &tauri::AppHandle,
    request: &Request<Vec<u8>>,
    query: &HashMap<String, String>,
) -> Response<Cow<'static, [u8]>> {
    use std::io::{Read, Seek, SeekFrom};

    let path_str = match query.get("path") {
        Some(p) if !p.is_empty() => p.clone(),
        _ => return bad_request("missing path param".into()),
    };
    let path = std::path::PathBuf::from(&path_str);

    // 安全校验:必须在已登记 Workshop 根目录之下
    let state = app.state::<orange_tauri::AppState>();
    let roots = state.we_roots.read().clone();
    if !orange_tauri::wallpaper_engine::is_within_roots(&path, &roots) {
        tracing::warn!("wefile 拒绝越界路径: {}", path.display());
        return Response::builder()
            .status(403)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(Cow::Borrowed(b"forbidden"))
            .unwrap_or_else(|_| bad_request("forbidden".into()));
    }

    let metadata = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("wefile 读取元数据失败 {}: {}", path.display(), e);
            return bad_request("file not found".into());
        }
    };
    let total = metadata.len();
    let content_type = we_content_type(&path);

    // 解析 Range 头(形如 "bytes=0-1023" 或 "bytes=0-")
    let (start, end, status) = match request.headers().get("range").and_then(|r| r.to_str().ok()) {
        Some(r) if r.starts_with("bytes=") => {
            let spec = &r[6..];
            let (s, e) = spec.split_once('-').unwrap_or((spec, ""));
            let start: u64 = s.parse().unwrap_or(0);
            let end: u64 = if e.is_empty() { total.saturating_sub(1) } else { e.parse().unwrap_or(total.saturating_sub(1)) };
            (start, end.min(total.saturating_sub(1)), 206)
        }
        _ => (0, total.saturating_sub(1), 200),
    };

    if start > end || start >= total {
        return Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{}", total))
            .body(Cow::Borrowed(b"range not satisfiable"))
            .unwrap_or_else(|_| bad_request("range error".into()));
    }

    let len = end - start + 1;
    let mut buf = vec![0u8; len as usize];
    let read_result = std::fs::File::open(&path).and_then(|mut f| {
        f.seek(SeekFrom::Start(start))?;
        f.read_exact(&mut buf)?;
        Ok(())
    });
    if let Err(e) = read_result {
        tracing::warn!("wefile 读取文件失败 {}: {}", path.display(), e);
        return bad_request("read error".into());
    }

    let mut builder = Response::builder().status(status).header("Content-Type", content_type);
    if status == 206 {
        builder = builder
            .header("Content-Range", format!("bytes {}-{}/{}", start, end, total))
            .header("Accept-Ranges", "bytes");
    }
    builder = builder.header("Content-Length", len.to_string())
        .header("Access-Control-Allow-Origin", "*");
    builder.body(Cow::Owned(buf)).unwrap_or_else(|_| bad_request("response build failed".into()))
}

/// 按后缀推断 wefile 的 Content-Type(覆盖 Wallpaper Engine 常见格式)。
fn we_content_type(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        _ => "application/octet-stream",
    }
}
```

- [ ] **Step 4: 构建验证**

Run: `cargo build -p orangeradio-desktop`
Expected: 编译通过

- [ ] **Step 5: 手动验收 wefile(可选,需应用能跑起来)**

启动应用后,从 wallpaper_engine_scan 结果取一个 preview 绝对路径,在终端:
```bash
# 编码 path 后请求(Windows 路由形式)
curl -sI "http://orangeradio.localhost/wefile?path=$(printf 'D:/steam/steamapps/workshop/content/431960/1081733658/preview.jpg' | jq -sRr @uri)" | head -5
```
Expected: `HTTP/1.1 200` 且 `Content-Type: image/jpeg`
(若无法手动跑,Task 7 前端联调时一并验证。)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): orangeradio://wefile 分支读取 Wallpaper Engine 文件(白名单+Range)"
```

---

## Task 6: 前端 lib(webviewUrl 抽取 + wallpaperEngine.ts)+ store 扩展

**Files:**
- Create: `frontend/src/lib/webviewUrl.ts`
- Modify: `frontend/src/features/player/useAudioEngine.ts`(改 import)
- Create: `frontend/src/lib/wallpaperEngine.ts`
- Modify: `frontend/src/stores/wallpaperStore.ts`

**Interfaces:**
- Consumes: Task 1 类型(对齐 TS)、Task 4 命令 `wallpaper_engine_scan`
- Produces: `toWebviewUrl`(共享)、`WallpaperEngineEntry`/`WallpaperEngineScanResult`/`WeKind` 类型、`weFileUrl` / `weKindLabel` / `formatSize` / `scanWallpaperEngine`;store 的 `engineDirs` / `engineEntries` / `engineScanning` / `scanWallpaperEngine()` / `addEngineDir()`。Task 7 依赖。

- [ ] **Step 1: 抽取 toWebviewUrl 到共享 lib(DRY)**

创建 `frontend/src/lib/webviewUrl.ts`:

```ts
/**
 * 把后端返回的播放源/文件 URL 转成 webview 实际能加载的 URL。
 *
 * 三种情况:
 * 1. http(s):// 直链 —— 原样返回。
 * 2. 自定义协议 <scheme>://localhost/... (orangeradio:// 用于 QQ 流 / Wallpaper Engine 文件)——
 *    Tauri 2 在 Windows/Android 路由成 http://<scheme>.localhost/...。
 * 3. 本地文件路径 —— convertFileSrc(asset 协议)。
 */
import { convertFileSrc } from "@tauri-apps/api/core";

export function toWebviewUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const m = raw.match(/^([a-z][a-z0-9+.-]*):\/\/localhost\//i);
  if (m) {
    const scheme = m[1].toLowerCase();
    const rest = raw.slice(m[0].length);
    const isWinLike =
      navigator.userAgent.includes("Windows") || /Android/i.test(navigator.userAgent);
    return isWinLike
      ? `http://${scheme}.localhost/${rest}`
      : `${scheme}://localhost/${rest}`;
  }
  return convertFileSrc(raw);
}
```

- [ ] **Step 2: useAudioEngine.ts 改为 import**

修改 `frontend/src/features/player/useAudioEngine.ts`:删除文件内的 `toWebviewUrl` function 定义(第 18-31 行那块),顶部 import 改为:

```ts
import { invoke } from "@tauri-apps/api/core";
import { toWebviewUrl } from "../../lib/webviewUrl";
```

(保留原 `convertFileSrc` import 若其他地方仍用,否则去掉。)

- [ ] **Step 3: 创建 wallpaperEngine.ts**

创建 `frontend/src/lib/wallpaperEngine.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

/** 与 Rust WallpaperEngineKind(serde snake_case)对齐 */
export type WeKind =
  | "video" | "picture" | "scene" | "web" | "application" | "unknown";

export interface WallpaperEngineEntry {
  workshop_id: string;
  title: string;
  kind: WeKind;
  file: string;
  preview: string | null;
  size_bytes: number;
  tags: string[];
  applicable: boolean;
  source_dir: string;
}

export interface WallpaperEngineScanResult {
  entries: WallpaperEngineEntry[];
  discovered_dirs: string[];
}

/** 拼原始 orangeradio://localhost/wefile?path=<abs> URL(再由 toWebviewUrl 平台适配) */
export function weFileUrl(sourceDir: string, rel: string): string {
  const dir = sourceDir.replace(/[\\/]+$/, "");
  const name = rel.replace(/^[\\/]+/, "");
  return `orangeradio://localhost/wefile?path=${encodeURIComponent(`${dir}/${name}`)}`;
}

export function weKindLabel(k: WeKind): string {
  const m: Record<WeKind, string> = {
    video: "视频", picture: "图片", scene: "场景", web: "网页", application: "应用", unknown: "未知",
  };
  return m[k];
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** 调 Rust 扫描命令。dirs 传 null 走自动发现。 */
export async function scanWallpaperEngine(
  dirs: string[] | null,
): Promise<WallpaperEngineScanResult> {
  return invoke<WallpaperEngineScanResult>("wallpaper_engine_scan", { dirs });
}
```

- [ ] **Step 4: 扩展 wallpaperStore**

修改 `frontend/src/stores/wallpaperStore.ts`。

顶部 import 加:
```ts
import {
  scanWallpaperEngine,
  type WallpaperEngineEntry,
} from "../lib/wallpaperEngine";
```

`WallpaperState` interface 末尾加字段与方法签名:
```ts
interface WallpaperState {
  // ... 现有字段与方法 ...
  engineDirs: string[];
  engineEntries: WallpaperEngineEntry[];
  engineScanning: boolean;
  scanWallpaperEngine: () => Promise<void>;
  addEngineDir: (dir: string) => void;
}
```

`STORAGE_KEY` 附近加一个 key:
```ts
const ENGINE_DIRS_KEY = "orangeradio_wallpaper_engine_dirs";
```

`create` 的初始 state 里加:
```ts
  engineDirs: (() => {
    try { return JSON.parse(localStorage.getItem(ENGINE_DIRS_KEY) || "[]"); }
    catch { return []; }
  })(),
  engineEntries: [],
  engineScanning: false,
  scanWallpaperEngine: async () => {
    if (get().engineScanning) return;
    set({ engineScanning: true });
    try {
      const { engineDirs } = get();
      const result = await scanWallpaperEngine(engineDirs.length > 0 ? engineDirs : null);
      // 首次自动发现:把 discovered_dirs 写回 engineDirs 持久化
      if (engineDirs.length === 0 && result.discovered_dirs.length > 0) {
        const next = result.discovered_dirs;
        localStorage.setItem(ENGINE_DIRS_KEY, JSON.stringify(next));
        set({ engineDirs: next });
      }
      set({ engineEntries: result.entries });
    } catch (e) {
      console.warn("[Wallpaper Engine] 扫描失败:", e);
      set({ engineEntries: [] });
    } finally {
      set({ engineScanning: false });
    }
  },
  addEngineDir: (dir) => {
    const next = Array.from(new Set([...get().engineDirs, dir]));
    localStorage.setItem(ENGINE_DIRS_KEY, JSON.stringify(next));
    set({ engineDirs: next });
  },
```

> 注意 `create<WallpaperState>((set, get) => ({ ... }))` 里现有方法已用 `get`,新方法沿用。TS 严格模式:`engineDirs` 初始值需保证类型为 `string[]`,`JSON.parse(... || "[]")` 返回 `any` → 显式标注或 `as string[]`。改成:
> ```ts
> engineDirs: (() => {
>   try { return JSON.parse(localStorage.getItem(ENGINE_DIRS_KEY) || "[]") as string[]; }
>   catch { return [] as string[]; }
> })(),
> ```

- [ ] **Step 5: 类型检查 + 构建**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 无错误

Run: `cd frontend && npm run build`
Expected: 构建通过

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/webviewUrl.ts frontend/src/lib/wallpaperEngine.ts \
        frontend/src/features/player/useAudioEngine.ts frontend/src/stores/wallpaperStore.ts
git commit -m "feat(frontend): wallpaperEngine lib + wallpaperStore 扩展(toWebviewUrl 抽取共享)"
```

---

## Task 7: WallpaperEngineGrid 组件 + WallpaperPicker 集成 + 手动验收

**Files:**
- Create: `frontend/src/components/WallpaperEngineGrid.tsx`
- Create: `frontend/src/components/wallpaper-engine.css`
- Modify: `frontend/src/components/WallpaperPicker.tsx`

**Interfaces:**
- Consumes: Task 6 store 方法/字段、`weFileUrl`/`weKindLabel`/`formatSize`/`toWebviewUrl`、现有 `useWallpaperStore.addWallpaper`/`setActive`

- [ ] **Step 1: 创建网格组件**

创建 `frontend/src/components/WallpaperEngineGrid.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { useWallpaperStore } from "../stores/wallpaperStore";
import {
  weFileUrl, weKindLabel, formatSize, type WeKind, type WallpaperEngineEntry,
} from "../lib/wallpaperEngine";
import { toWebviewUrl } from "../lib/webviewUrl";
import type { Wallpaper } from "../stores/wallpaperStore";
import "../styles/wallpaper-engine.css";

const KIND_FILTERS: Array<"all" | WeKind> = ["all", "video", "picture", "scene", "web", "unknown"];

/** Wallpaper Engine 扫描结果网格:工具栏(过滤/搜索/添加目录)+ 卡片网格(懒加载预览) */
export function WallpaperEngineGrid() {
  const entries = useWallpaperStore((s) => s.engineEntries);
  const scanning = useWallpaperStore((s) => s.engineScanning);
  const engineDirs = useWallpaperStore((s) => s.engineDirs);
  const scan = useWallpaperStore((s) => s.scanWallpaperEngine);
  const addEngineDir = useWallpaperStore((s) => s.addEngineDir);
  const addWallpaper = useWallpaperStore((s) => s.addWallpaper);
  const setActive = useWallpaperStore((s) => s.setActive);

  const [filter, setFilter] = useState<"all" | WeKind>("all");
  const [query, setQuery] = useState("");

  useEffect(() => { void scan(); }, [scan]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) => (filter === "all" || e.kind === filter) && (q === "" || e.title.toLowerCase().includes(q)),
    );
  }, [entries, filter, query]);

  const onAddDir = async () => {
    const selected = await dialogOpen({ directory: true, multiple: false });
    if (typeof selected === "string") {
      addEngineDir(selected);
      void scan();
    }
  };

  const onApply = (e: WallpaperEngineEntry) => {
    if (!e.applicable) {
      window.alert(`「${weKindLabel(e.kind)}」类型需 Wallpaper Engine 本体渲染,暂仅浏览`);
      return;
    }
    const raw = weFileUrl(e.source_dir, e.file);
    const w: Wallpaper = {
      id: `we-${e.workshop_id}`,
      name: e.title,
      type: e.kind === "video" ? "video" : "image",
      src: toWebviewUrl(raw),
      builtin: false,
      addedAt: Date.now(),
    };
    addWallpaper(w);
    setActive(w.id);
  };

  return (
    <div className="we-grid">
      <div className="we-grid__bar">
        <select value={filter} onChange={(ev) => setFilter(ev.target.value as "all" | WeKind)}>
          {KIND_FILTERS.map((k) => (
            <option key={k} value={k}>{k === "all" ? "全部" : weKindLabel(k)}</option>
          ))}
        </select>
        <input
          className="we-grid__search"
          placeholder="搜索标题..."
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
        <button type="button" onClick={() => void scan()} disabled={scanning}>
          {scanning ? "扫描中..." : "重新检测"}
        </button>
        <button type="button" onClick={() => void onAddDir()}>添加目录</button>
      </div>
      <div className="we-grid__dirs">
        扫描目录:{engineDirs.length > 0 ? engineDirs.join(" | ") : "未配置(将自动发现)"}
      </div>
      {scanning && entries.length === 0 ? (
        <div className="we-grid__empty">扫描中...</div>
      ) : filtered.length === 0 ? (
        <div className="we-grid__empty">未找到 Wallpaper Engine 壁纸。点「添加目录」手动指定。</div>
      ) : (
        <div className="we-grid__list">
          {filtered.map((e) => (
            <WeCard key={e.workshop_id} entry={e} onApply={() => onApply(e)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单卡片:预览图懒加载 + 名字 + 格式色标 + 大小 */
function WeCard({ entry, onApply }: { entry: WallpaperEngineEntry; onApply: () => void }) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([it]) => { if (it.isIntersecting) { setVisible(true); io.disconnect(); } },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const previewRel = entry.preview ?? (entry.kind === "picture" ? entry.file : null);
  const imgSrc = previewRel ? toWebviewUrl(weFileUrl(entry.source_dir, previewRel)) : null;
  const kindCls = `we-card__kind we-card__kind--${entry.kind}`;

  return (
    <button type="button" className="we-card" onClick={onApply} title={entry.title}>
      <div className="we-card__cover" ref={ref as React.RefObject<HTMLDivElement>}>
        {visible && imgSrc ? (
          <img src={imgSrc} alt={entry.title} loading="lazy" />
        ) : (
          <div className="we-card__placeholder">{entry.applicable ? "" : "仅浏览"}</div>
        )}
      </div>
      <span className={kindCls}>{weKindLabel(entry.kind)}</span>
      <span className="we-card__name">{entry.title}</span>
      <span className="we-card__size">{formatSize(entry.size_bytes)}</span>
    </button>
  );
}
```

- [ ] **Step 2: 创建样式**

创建 `frontend/src/components/wallpaper-engine.css`:

```css
.we-grid { padding: 8px 4px; border-top: 1px solid rgba(255,255,255,0.08); margin-top: 12px; }
.we-grid__bar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.we-grid__search { flex: 1; min-width: 120px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15);
  color: #fff; padding: 4px 8px; border-radius: 6px; }
.we-grid__dirs { font-size: 11px; opacity: 0.6; margin-bottom: 8px; word-break: break-all; }
.we-grid__empty { padding: 24px; text-align: center; opacity: 0.6; }
.we-grid__list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px;
  max-height: 420px; overflow-y: auto; }

.we-card { display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.25);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; cursor: pointer; color: #fff; }
.we-card:hover { border-color: rgba(255,140,40,0.6); }
.we-card__cover { width: 100%; aspect-ratio: 16/9; background: rgba(0,0,0,0.4); border-radius: 4px; overflow: hidden; }
.we-card__cover img { width: 100%; height: 100%; object-fit: cover; }
.we-card__placeholder { display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.4; font-size: 12px; }
.we-card__kind { font-size: 10px; padding: 1px 6px; border-radius: 4px; align-self: flex-start; }
.we-card__kind--video { background: rgba(80,140,255,0.3); }
.we-card__kind--picture { background: rgba(80,200,120,0.3); }
.we-card__kind--scene, .we-card__kind--web, .we-card__kind--application, .we-card__kind--unknown { background: rgba(140,140,140,0.3); }
.we-card__name { font-size: 12px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.we-card__size { font-size: 10px; opacity: 0.5; }
```

- [ ] **Step 3: WallpaperPicker 加入口卡片 + 渲染 Grid**

修改 `frontend/src/components/WallpaperPicker.tsx`。顶部 import:
```tsx
import { useState } from "react";
import { WallpaperEngineGrid } from "./WallpaperEngineGrid";
```

在组件内加折叠状态:
```tsx
const [showEngine, setShowEngine] = useState(false);
```

在 `wp-picker__grid` 内、「上传」卡片**之后**(或之前),追加入口卡片:
```tsx
<button
  type="button"
  className="wp-card wp-card--upload"
  onClick={() => setShowEngine((v) => !v)}
  title="扫描本地 Wallpaper Engine 壁纸"
>
  <div className="wp-card__cover wp-card__upload">WE</div>
  <span className="wp-card__name">Wallpaper Engine</span>
</button>
```

在 `wp-picker__grid` 的闭合 `</div>` 之后、组件根 `</div>` 之前,渲染网格:
```tsx
{showEngine && <WallpaperEngineGrid />}
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 无错误(若有 `any` 报错,按提示收窄)

Run: `cd frontend && npm run build`
Expected: 构建通过

- [ ] **Step 5: 手动验收(全流程)**

Run: `.\run.ps1`(自动修 MSVC link.exe PATH + 构建前端 + 编译 desktop + 启动)

验收清单:
- [ ] 打开壁纸页(Sidebar 壁纸入口或全屏 VisualConsole),看到「Wallpaper Engine」入口卡片
- [ ] 点入口 → 自动扫描(首次自动发现 `D:\steam\…\431960`)→ 展示 413 个壁纸
- [ ] 顶部工具栏:类型过滤切到「视频」→ 剩 8 个;切「场景」→ 48 个;搜索框输入标题能过滤
- [ ] 卡片显示预览图(懒加载,滚动加载)、名字、格式色标、大小
- [ ] 点一个**视频**壁纸 → 设为播放器背景,`WallpaperBackground` 播放该视频
- [ ] 点一个**场景**壁纸 → 弹「需 Wallpaper Engine 本体渲染,暂仅浏览」
- [ ] 「扫描目录」显示 `D:\steam\steamapps\workshop\content\431960`;点「重新检测」可重扫
- [ ] 重启应用 → 不重新发现(已持久化 engineDirs),直接扫描

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/WallpaperEngineGrid.tsx \
        frontend/src/components/wallpaper-engine.css \
        frontend/src/components/WallpaperPicker.tsx
git commit -m "feat(frontend): Wallpaper Engine 结果网格 + WallpaperPicker 入口集成"
```

---

## Definition of Done

- `cargo build -p orangeradio-desktop` 绿 + `cd frontend && npm run build` 绿(双绿)
- `cargo test -p orange-core` + `cargo test -p orange-tauri` 全绿
- 手动验收清单(Task 7 Step 5)全过
- Conventional Commits,多 crate 改动在 commit 正文逐 crate 列影响点;新分支,不直推 main

## Self-Review 记录

(实施时由执行者填写;规划阶段已对照 spec 逐节确认有任务覆盖,类型签名跨任务一致,无 TBD/占位代码。)
