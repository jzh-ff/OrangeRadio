# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

OrangeRadio = Tauri 2 桌面壳 + 11 个 Rust workspace crate 的**分层**架构 + React/Three.js 前端。当前在 **v0.4 阶段**（本地/网易云/QQ/电台/播客多音源已可用，沉浸式视觉已完成，Hi-Res 解码、AI 创作、社交同步多为 trait 骨架）。

> **规范、命令、布局清单见 `AGENTS.md`（权威）。** 本文件只补充需要跨多文件阅读才能搞懂的"大图"架构与项目特有约束，不重复 `AGENTS.md`。

## 常用命令速查

```powershell
.\run.ps1                                    # 一键构建+运行（自动修 MSVC link.exe PATH，见下）
cd apps/desktop/src-tauri && cargo tauri dev # 热重载开发
cd frontend && npm run build                 # 仅前端：tsc -b && vite build
cd server && cargo run                       # 社交后端 http://localhost:3847
cargo clippy --workspace --all-targets -- -D warnings   # lint（警告即错误）
cargo fmt --all                              # 格式化（提交前）
cd frontend && npx tsc -b --noEmit           # 前端类型检查
```

- **合并门槛**：`cargo build -p orangeradio-desktop` **和** `npm run build` 必须双绿。
- **MSVC 工具链陷阱**：Git Bash 的 `/usr/bin/link` 会盖过 MSVC `link.exe`，导致链接报错 `link: extra operand`。**裸 cargo 命令前先跑一次 `.\run.ps1`**（它把 MSVC link.exe 推到 PATH 最前），或手动设 PATH。
- **测试**：当前无测试框架（Rust 单测/前端 Vitest 均待引入，见 `docs/09-开发计划.md`），因此暂没有"运行单个测试"的命令。新增库代码时建议就近写 `#[cfg(test)]` 模块，但尚未接入 CI。

## 分层架构

依赖**严格单向**：core ← sources/library ← tauri ← desktop。`AGENTS.md` 禁止跨层反向依赖（如 `orange-audio` 不得 import `orange-tauri`）。

| 层 | crate | 职责 |
|----|-------|------|
| **域类型/trait** | `orange-core` | `Track` / `AudioSource` / `AuthSource` / `Player` / `EventBus` / `StreamLocation`。**所有 IPC 载荷类型的唯一真相源**（新增跨 IPC 结构体定义在此） |
| **音源插件** | `orange-sources` | netease / qqmusic / spotify / web_radio / podcast，各自实现 `AudioSource`（可选 `AuthSource`）。`auth_store.rs` 加密持久化登录态 |
| **本地库** | `orange-library` | `LibraryScanner` 扫盘 + `LibraryDb`（SQLite，`.orangeradio/library.sqlite`）。本地库 + 用户歌单 + 跨源收藏都存这里 |
| **IPC 桥** | `orange-tauri` | **所有 `#[tauri::command]` 只能加在 `commands.rs::register_all`**（AGENTS.md 硬性约束）。`AppState` 在此定义并 `manage()` 注入 |
| **桌面壳** | `apps/desktop/src-tauri` | Tauri 入口、日志（按天滚动）、**`orangeradio://` 自定义 URI scheme（QQ 音乐 CORS 代理，见架构流 #2）** |
| 后端 | `server` | Axum 社交后端（WebSocket，CORS，端口 3847） |
| 骨架 | `orange-audio`/`orange-ai`/`orange-studio`/`orange-sync`/`orange-hue` | 多为 trait 骨架，按 Roadmap 逐版本落地 |

> 浏览器识歌扩展在 `extension/`（Manifest V3），不在主 Tauri 应用构建路径内。

## 关键架构流

### 1. 跨源播放流 —— `Track.source_kind` 是核心判别字段
**实际播放走前端 `<audio>` 元素 + Web Audio API**（`frontend/src/features/player/useAudioEngine.ts`），Rust 侧 `Player` trait 尚未驱动音频。取流路径由 `Track.source_kind` 字符串决定，入口在 `frontend/src/App.tsx::engineRef.playTrack`（按 `source_kind` 分支调 `invoke`），各音源返回的原始 URL 再经 `useAudioEngine.ts::toWebviewUrl` 统一适配成 webview 能加载的形式：

- `local` → `source_track_id` **就是文件路径** → `toWebviewUrl` 走 `convertFileSrc()` 包成 `asset.localhost` URL
- `netease_cloud_music` → `invoke("netease_stream", {trackId})` → 返回 `http(s)://` 直链 → 原样喂 `<audio>`
- `qq_music` → `invoke("qqmusic_stream", {trackId})` → 返回 `orangeradio://localhost/qqstream?url=...` 自定义协议 URL（不是本地文件路径）→ `toWebviewUrl` 按 **Tauri 2 在 Windows/Android 把自定义协议路由成 `http://<scheme>.localhost/...`** 的规则改写
- `web_radio` / `podcast` → URL 直接 → `<audio>`

> 因此跨源收藏后能正确播放，全靠 `Track.source_kind` 在收藏/入库时被正确写入（本地库、网易云、QQ 各填各的）。`source_kind` 的 Rust 枚举是 `SourceKind`（serde `rename_all="snake_case"`），前端 `SourceKind` 字符串字面量必须与之对齐（见 `libraryStore.ts`）。

### 2. QQ 音乐 CORS 代理 —— `orangeradio://` 自定义 URI scheme
`apps/desktop/src-tauri/src/lib.rs::run` 用 `builder.register_asynchronous_uri_scheme_protocol("orangeradio", ...)` 注册自定义协议；`handle_qq_stream` 在 Rust runtime 拉远端 QQ CDN 流，转发时加 `Referer: https://y.qq.com/` + UA，并**透传 `Range` 头**（支持拖动进度）和 `content-type/range/accept-ranges` 等响应头。**没有 axum、没有独立端口**（早期的 `127.0.0.1:17986` axum 代理服务器已废弃，`start_proxy_server` 函数已删除）。链路：前端 `<audio>` → `http://orangeradio.localhost/qqstream?url=...`（Windows/Android 路由形式，见架构流 #1）→ Rust handler → QQ CDN。

### 3. AppState 注入 —— 所有命令共享同一份状态
`orange-tauri/src/lib.rs::AppState` 持有 `EventBus`、`LibraryDb`、以及 `Arc` 包裹的各音源实例（netease/qqmusic/spotify/web_radio/podcast）+ `AuthStore`。`register_all` 里 `.manage(AppState::default())` 注入；每个 `#[tauri::command]` 通过 `tauri::State<'_, AppState>` 取用。`AppState` 是 `Clone` 的（内部全是 `Arc`），`commands.rs::search_all` 聚合搜索就靠 clone 出去并发 `tokio::join!`。

### 4. 凭据持久化 —— AuthStore
`orange-sources/src/auth_store.rs`：网易云/QQ 登录态（cookie）→ AES-256-GCM 加密 → `{data_dir}/auth/{source}.bin`，master key 存 OS keyring（Windows=Credential Manager）。启动时一次性解密进内存 `HashMap`，运行时零 IO。keyring 不可用时**降级而非崩溃**（退化为不持久化）。**绝不要把 cookie/密钥写日志或塞进 IPC 返回值。**

### 5. 前端播放竞态防护
`App.tsx` 用模块级 `playRequestSeq`（递增序号）防止快速切歌时旧的异步取流覆盖新歌；另有 500ms 同曲防抖（`lastPlayTrackId`）防 onClick+onDoubleClick 双触发。改播放逻辑时保留这两道防护。

## 项目特有约束

- **单一 Cargo workspace**：不要在任何子目录新建独立 `Cargo.toml`；新 crate 放 `crates/<name>/` 并加入根 `Cargo.toml` 的 `members`。
- **命令注册位置**：`#[tauri::command]` 只准出现在 `crates/orange-tauri/src/commands.rs::register_all`，别处会被 harness 拒绝。
- **IPC 载荷**：跨 IPC 的新结构体定义在 `orange-core`（域类型层），不要在命令文件里就地定义。
- **语言**：UI/文档/commit 正文允许中文；代码标识符、crate 名、Tauri 命令名保持英文。
- **Git**：`main` 是默认分支，禁止直推；开 `<reinshort>/<scope>` 新分支；Conventional Commits；多 crate 改动在 commit 正文逐 crate 列影响点。
- **Rust 诊断**：库代码用 `tracing::*!`，禁止 `println!`；`unwrap()` 仅限测试或 `expect("invariant: ...")`。
- **前端**：严格 TS（新代码禁 `any`，用 `unknown` 收窄）；状态走 Zustand store（`frontend/src/stores/`）不用组件 `useState` 持跨页状态；无 CSS-in-JS，纯 CSS 文件与组件同目录同命名（`Foo.tsx` ↔ `foo.css`）；`npm run build` 已链 `tsc -b && vite build`，别拆开跑。

## 多智能体 harness

`.harness/` 定义了一套 **reins（领域专家 agent）** 系统：`rust-expert` / `frontend-expert` / `server-expert` / `ai-expert` / `tester` / `pm` / `designer` / `user-advocate`，由 `.harness/agent.md` 的 harness（orchestrator）路由调度。共享规范在 `.harness/docs/code-standards.md`，团队记忆在 `.harness/memory/MEMORY.md`。

## 深入阅读

- `docs/01-技术架构.md` — 架构决策记录 + **踩坑记录**（冲突仲裁的权威出处）
- `docs/09-开发计划.md` — Roadmap / 当前里程碑 / 依赖关系
- `docs/04-API设计.md` — IPC 命令 + 后端 REST API 完整清单
- `docs/05-音源插件开发指南.md` — 实现 `AudioSource` trait 自定义音源
- `docs/10-Mineradio深度调研.md` — 对标项目 Mineradio 的音源接入/电影运镜/节拍图谱实现剖析；做视觉与音源时的参照
