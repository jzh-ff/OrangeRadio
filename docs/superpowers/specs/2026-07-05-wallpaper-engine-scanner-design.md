# Wallpaper Engine 本地壁纸扫描器 — 设计文档

- **日期**:2026-07-05
- **状态**:已与用户确认大方向,待 spec 审阅 → 转入实现计划
- **范围**:在现有壁纸功能中加入「扫描本地 Wallpaper Engine 壁纸」入口,扫描结果直接展示(名字、格式、预览、大小等),视频/图片类型可一键设为播放器背景
- **关联**:`frontend/src/stores/wallpaperStore.ts`、`frontend/src/components/WallpaperPicker.tsx`、`crates/orange-tauri/src/commands.rs`、`apps/desktop/src-tauri/src/lib.rs`

---

## 1. 背景与动机

OrangeRadio 已有完整壁纸功能:`Wallpaper` 模型(仅 `image`/`video` 两种)、`WallpaperPicker` 卡片网格、内置 manifest + 用户上传两种来源、`WallpaperBackground` 渲染层。用户希望接入 **Steam Wallpaper Engine** 的本地壁纸库——它是一个现成、海量、已分门别类的壁纸源。

实测用户机器有 **413 个** Wallpaper Engine 壁纸。直接复用这批资源,既扩充壁纸库,又免去逐个上传。

## 2. 目标 / 非目标

### 目标
1. 自动发现本地 Wallpaper Engine 壁纸目录(适配任意安装位置)
2. 扫描全部壁纸,解析 `project.json` 提取关键字段
3. 在壁纸页直接展示扫描结果(名字、格式、预览图、大小),支持类型过滤与搜索
4. 视频/图片类型壁纸可一键设为播放器背景(引用 Steam 原路径,不复制)

### 非目标(YAGNI,本期不做)
- 渲染 Scene(`.pkg`)、Web(HTML)、Application 类型壁纸(需 WE 本体引擎,OrangeRadio 无法播放)→ 仅展示并标记"仅浏览"
- 把壁纸**复制/导入**到 `{data_dir}/wallpapers`(方案 C,用户未选)
- 编辑 Wallpaper Engine 壁纸、回写 Workshop
- 监听 Steam 目录变化实时刷新(初版手动触发扫描)

## 3. 关键技术发现(调研事实)

### 3.1 壁纸目录位置(每台机器不同)
- Workshop 内容固定在 `<SteamLibrary>/steamapps/workshop/content/431960/`(431960 = Wallpaper Engine 的 App ID)
- Steam 安装位置由注册表 `HKCU\Software\Valve\Steam\SteamPath` 给出(用户机器 = `D:\steam`)
- 多 Steam Library 声明在 `{SteamPath}/steamapps/libraryfolders.vdf`,每个库块含 `path` 与 `apps` 列表
- 用户机器实测:单库 `D:\steam`,`431960` 在主库,Workshop 内容 829MB

### 3.2 `project.json` 结构与类型判定
- **格式化 JSON(有换行缩进),最大可达 256KB**(Scene 类型把整张场景图序列化塞入),多数 < 30KB
- 关键字段:`file`(顶层,主资源文件)、`general.title`、`general.type`、`general.preview`、`general.tags`、`general.description`
- 用户 413 个壁纸的 `general.type` 分布:**Scene 48 / Video 8 / Web 3 / 其余 ~354 无标准 type 值**
- **结论:`general.type` 不可靠**。真实类型由 **`file` 字段后缀** 判定更稳:`.mp4/.webm/.mov/.mkv`→Video,`.jpg/.jpeg/.png/.webp/.gif/.bmp`→Picture,`.pkg`→Scene,`index.html`/`.html`→Web,`.exe`→Application;`general.type` 仅在 `file` 判不出时作补充。
- `general.preview` 是相对壁纸目录的路径(多为 `preview.jpg` / `preview.gif`)

### 3.3 Steam 目录文件访问
- Workshop 目录文件**不在 Tauri asset scope**,`convertFileSrc` 无法直接访问
- 项目已有 `orangeradio://` 自定义 URI scheme(`apps/desktop/src-tauri/src/lib.rs`,目前服务 QQ 音乐取流)→ **扩展一个 `/wefile?path=<绝对路径>` 分支**复用此基础设施,服务预览图与视频壁纸

### 3.4 现有可复用范式
- `LibraryScanner`(`crates/orange-library/src/scanner.rs`):**扫描目录由前端 localStorage 管理,作为命令参数传给 Rust**;Rust 侧用 `tokio::spawn_blocking` + `walkdir` 扫描。壁纸扫描沿用此范式。
- `wallpaperStore`(Zustand + localStorage):壁纸索引持久化模式。
- IPC 载荷类型必须定义在 `orange-core`(项目硬约束)。

## 4. 设计概述

新增一个独立的扫描器,通过新增的 IPC 命令 `wallpaper_engine_scan` / `wallpaper_engine_resolve` 暴露给前端;扫描结果在前端 `WallpaperPicker` 同页直接展开为带过滤/搜索的网格;视频/图片壁纸经 `orangeradio://wefile` 协议读取后,复用现有 `addWallpaper` 流程设为背景。

## 5. 详细设计

### 5.1 数据模型(`crates/orange-core`,新模块 `wallpaper_engine.rs`)

```rust
use serde::{Deserialize, Serialize};

/// Wallpaper Engine 壁纸类型(由 file 后缀为主、general.type 为辅判定)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
    /// 是否可被 OrangeRadio 直接设为播放器背景
    pub fn applicable(self) -> bool {
        matches!(self, Self::Video | Self::Picture)
    }
}

/// 单条扫描结果(跨 IPC 载荷,定义在 orange-core)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WallpaperEngineEntry {
    pub workshop_id: String,     // 壁纸文件夹名 = Steam Workshop ID
    pub title: String,
    pub kind: WallpaperEngineKind,
    pub file: String,            // 主资源相对路径(如 "index.html" / "scene.pkg" / "x.mp4")
    pub preview: Option<String>, // general.preview 相对路径(如 "preview.jpg"),可能缺失
    pub size_bytes: u64,         // 整个壁纸文件夹大小
    pub tags: Vec<String>,       // general.tags,可能为空
    pub applicable: bool,        // = kind.applicable(),前端便捷字段
    pub source_dir: String,      // 该壁纸所在绝对目录(多目录扫描时溯源 + wefile 读取用)
}
```

前端对应 TS 类型与 `kind` 字面量需与 Rust serde `snake_case` 对齐(`"video"`/`"picture"`/`"scene"`/`"web"`/`"application"`/`"unknown"`)。

### 5.2 路径发现策略(三级回退 + 可配置)

| 优先级 | 来源 | 说明 |
|--------|------|------|
| ① 最高 | 前端 localStorage `engineDirs: string[]` | 用户确认/手动添加过的目录 |
| ② 自动 | 注册表 `HKCU\Software\Valve\Steam\SteamPath` | 拿主 Steam 目录 |
| ③ 自动 | 解析 `{SteamPath}/steamapps/libraryfolders.vdf` | 取所有 library `path`,对每个探测 `{path}/steamapps/workshop/content/431960`,命中即纳入 |
| ④ 兜底 | `dialog.open({ directory: true })` 手选 | 自动发现为空时引导用户选目录 |

- 命令 `wallpaper_engine_scan(dirs: Option<Vec<String>>)`:前端传 `engineDirs` 就用配置;传 `None` 则 Rust 跑②③自动发现
- 自动发现命中的目录随结果一并返回(`discovered_dirs`),前端首次可写入 `engineDirs` 持久化
- 多目录:扫描合并所有目录结果,**按 `workshop_id` 去重**(同 ID 只保留第一个命中)
- Rust 侧**不持久化**任何路径配置(沿用 `LibraryScanner` 范式,配置在前端)

### 5.3 扫描流程(`crates/orange-tauri/src/wallpaper_engine.rs`,新文件)

职责:`wallpaper_engine.rs` 薄模块承载所有扫描逻辑,`commands.rs` 只做命令封装调用,避免 commands.rs(已 1100+ 行)继续膨胀。

```text
discover_dirs(override) -> Vec<PathBuf>
  ├─ override 非空 → 直接返回
  └─ 否则:注册表 SteamPath → 解析 libraryfolders.vdf
            → 对每个 lib 探测 workshop/content/431960 → 收集命中

scan_dir(dir) -> Vec<WallpaperEngineEntry>   // 单目录,spawn_blocking 内
  for each 子目录(= workshop_id):
    ├─ 读 project.json(瘦反序列化,只取 file/general.*;serde 忽略未知字段)
    ├─ kind = infer_kind(file, general.type)
    ├─ size_bytes = 递归求和子目录大小
    ├─ tags = general.tags.unwrap_or_default()
    └─ 组装 WallpaperEngineEntry

scan(dirs) -> (Vec<WallpaperEngineEntry>, Vec<String> discovered_dirs)
  并发扫各目录 → 合并 → workshop_id 去重
```

- 解析在 `tokio::spawn_blocking` 中执行(纯阻塞文件 IO,参考 `LibraryScanner::scan`)
- 并发度用 `tokio::task::JoinSet` 控制单目录内 413 个 `project.json` 的解析
- 单个壁纸解析失败(无 project.json / JSON 损坏)→ 跳过并 `tracing::warn!`,不中断整批

### 5.4 文件访问(`apps/desktop/src-tauri/src/lib.rs`,扩展现有 `orangeradio://` handler)

在 `handle_orangeradio_protocol` 的 `match path` 加分支:

```rust
"/wefile" => handle_we_file(&request, &query).await,
```

`handle_we_file(query)`:
- 读 `path` 参数(绝对路径)
- **路径安全**:`path.canonicalize()` 后,必须以 `AppState` 中已登记的 Workshop 根目录为前缀,否则 403。防 `..` 穿越、防读任意系统文件。
- 读文件字节,透传 `content-type`(按后缀:`.jpg`→image/jpeg, `.gif`→image/gif, `.mp4`→video/mp4, `.webm`→video/webm …)、`content-length`、`Range`(支持视频拖动)
- 前端经 `toWebviewUrl` 已有的平台适配(Windows → `http://orangeradio.localhost/...`)直接 `<img>`/`<video>`

> 允许根目录的传递:`wallpaper_engine_scan` 完成后,把发现的 Workshop 根目录存入 `AppState` 一个 `RwLock<Vec<PathBuf>>`,handler 读取校验。避免 handler 重复跑注册表/解析 vdf。

### 5.5 IPC 命令(`crates/orange-tauri/src/commands.rs::register_all`)

```rust
#[tauri::command]
pub async fn wallpaper_engine_scan(
    state: tauri::State<'_, AppState>,
    dirs: Option<Vec<String>>,
) -> Result<WallpaperEngineScanResult, String>;   // { entries, discovered_dirs }

> **不设 `wallpaper_engine_resolve` 命令**:`source_dir` 与 `file`/`preview` 都在 entry 里,前端自行拼 `orangeradio://localhost/wefile?path=<abs>` 即可(经现有 `toWebviewUrl` 平台适配),省一次 IPC 往返。

### 5.6 前端(`wallpaperStore` 扩展 + `WallpaperPicker` 增强)

**`wallpaperStore.ts` 新增**:
```ts
interface WallpaperEngineEntryTs { workshop_id: string; title: string;
  kind: "video"|"picture"|"scene"|"web"|"application"|"unknown";
  file: string; size_bytes: number; tags: string[]; applicable: boolean;
  source_dir: string; }

interface WallpaperState {
  // 现有字段...
  engineDirs: string[];                       // localStorage 持久化
  engineEntries: WallpaperEngineEntryTs[];    // 最近一次扫描结果(内存)
  engineScanning: boolean;
  scanWallpaperEngine: () => Promise<void>;
  addEngineDir: (dir: string) => void;
}
```

**`WallpaperPicker.tsx` 增强**:
- 现有"上传"卡片旁加 **「Wallpaper Engine」入口卡片**(图标 + 文案)。首次点击 → 触发 `scanWallpaperEngine()`(用 `engineDirs` 或自动发现)
- 扫描结果**同页展开**在 Picker 网格下方:
  - 工具栏:类型过滤(全部/视频/图片/场景/网页/其他)+ 搜索框(按 title)+ 「添加目录」「重新检测」+ 当前扫描目录显示
  - 网格卡片:`<img>` 预览图(`orangeradio://localhost/wefile?path=...`)+ 名字 + 格式色标(视频=蓝/图片=绿/场景=灰"仅浏览"/网页=橙)+ 文件夹大小(人类可读)
  - **缩略图懒加载**(IntersectionObserver),413 个不卡顿
  - `applicable` 卡片点击 → 前端拼 `orangeradio://localhost/wefile?path=<source_dir>/<file>`(经 `toWebviewUrl` 平台适配)→ `addWallpaper({ type: kind 对应 image|video, src, name: title, builtin:false })` → `setActive`
  - 非 `applicable` 卡片点击 → Toast「该格式(Scene/网页)需 Wallpaper Engine 本体渲染,暂仅浏览」

## 6. 数据流

```text
[WallpaperPicker「Wallpaper Engine」入口]
   │ scanWallpaperEngine(): engineDirs 非空? 用配置 : 传 None
   ▼ invoke("wallpaper_engine_scan", { dirs })
[Rust wallpaper_engine.rs]
   ├─ discover_dirs: 注册表 SteamPath → libraryfolders.vdf → 探测 content/431960
   ├─ spawn_blocking: 并发解析各 project.json → 瘦 WallpaperEngineEntry
   ├─ 合并 + workshop_id 去重
   └─ 写 AppState 允许根目录(供 wefile 校验)
   ▼ { entries, discovered_dirs }
[前端 wallpaperStore] 存 engineEntries;首次写回 engineDirs = discovered_dirs
   ▼ 渲染网格(预览图走 orangeradio://wefile)
[用户点视频/图片壁纸]
   ▼ 前端拼 orangeradio://localhost/wefile?path=<source_dir>/<file>
[addWallpaper + setActive] → WallpaperBackground 渲染
```

## 7. 错误处理与安全

| 场景 | 处理 |
|------|------|
| Steam 未装 / 注册表无 SteamPath | 自动发现返回空;前端提示「未找到,请手动选择目录」→ `dialog.open` |
| `libraryfolders.vdf` 缺失/解析失败 | 仅用注册表 SteamPath 单库探测,不阻断 |
| 单个 `project.json` 缺失/损坏 | 跳过该壁纸,`tracing::warn!`,继续扫其余 |
| 路径穿越攻击(`/wefile?path=../../etc/passwd`) | `canonicalize` 后校验必须在已发现 Workshop 根目录前缀下,否则 403 |
| 视频壁纸引用 Steam 路径,Steam 验证完整性/卸载后失效 | UI 标注来源「Wallpaper Engine 引用」;设为背景失败时回退提示 |
| 超大目录扫描耗时 | 扫描期间 `engineScanning=true` 显示 loading;并发受控 |

**安全红线**:`orangeradio://wefile` 只读 Workshop 内容目录,绝不返回任意路径文件;不把任何敏感路径写日志(沿用项目 AuthStore 安全规范的同源约束)。

## 8. 测试策略

项目当前无测试框架(Rust 单测/Vitest 均待引入),合并门槛为 `cargo build -p orangeradio-desktop` + `npm run build` 双绿。本期对**纯函数**就近加 `#[cfg(test)]` 单测(低成本、不依赖框架基建):

- `wallpaper_engine::infer_kind(file, type_str)`:`.mp4`→Video、`index.html`→Web、`.pkg`→Scene、空→Unknown 等边界
- `wallpaper_engine::parse_libraryfolders(vdf_text)`:多库/单库/畸形 vdf
- `wallpaper_engine::is_within_roots(path, roots)`:路径穿越拦截(`..`、符号链接规范化后越界)

前端类型检查(`npx tsc -b --noEmit`)必须通过。

## 9. 风险与权衡

- **类型判定靠 `file` 后缀**:极少数壁纸 `file` 字段异常会落到 `Unknown` → 可接受(标记后用户可知)
- **引用 vs 复制(方案 B 固有)**:视频壁纸不占额外磁盘,但依赖 Steam 目录稳定 → UI 显式标注来源
- **多库扫描性能**:用户多库时目录数翻倍,但去重 + 并发可控
- **`orangeradio://wefile` 扩展了自定义协议职责**:原仅服务 QQ 流,现在多一类本地文件读取 → handler 加 path 分支隔离,安全靠根目录白名单

## 10. 未来扩展(本期不做)

- 监听 Steam 目录变化,增量刷新(`notify` crate)
- Scene 类型通过嵌入 Wallpaper Engine 子进程渲染(重度,远期)
- Web 类型壁纸用独立 `<webview>`/iframe 沙箱嵌入
- 壁纸收藏/评分同步回 Steam Workshop
