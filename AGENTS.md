# AGENTS.md

OrangeRadio 沉浸式智能音乐播放器桌面端 — 基于 Tauri 2 + Rust 的跨平台音乐播放器，融合 Hi-Res 发烧音质、AI 智能推荐、社交协作和 AI 音乐创作工作站（OrangeStudio）。完整产品定位见 `README.md` 和 `docs/08-产品规划.md`。

## Setup commands

- Install deps:  `cd frontend && npm install`（Node.js 18+）
- Build frontend: `cd frontend && npm run build`（`tsc -b && vite build`）
- Build desktop (one-shot): `.\run.ps1` — 自动配 MSVC link.exe、构建前端、`cargo build -p orangeradio-desktop`、启动 `target\debug\orangeradio-desktop.exe`
- Dev (hot reload): `cd apps\desktop\src-tauri && cargo tauri dev`
- Build server: `cd server && cargo run`（默认 `http://localhost:3847`）
- Lint (Rust):   `cargo clippy --workspace --all-targets -- -D warnings`
- Format (Rust): `cargo fmt --all`
- Typecheck (frontend): `cd frontend && npx tsc -b --noEmit`

## Project layout

- `apps/desktop/src-tauri/` — Tauri 2 桌面壳（`orangeradio-desktop` crate + `tauri.conf.json` + capabilities）
- `crates/orange-core/` — 核心 trait / 域类型（`Track` / `AudioSource` / `Player` / `EventBus` / `VERSION`）
- `crates/orange-tauri/` — IPC 桥接层（`#[tauri::command]` 注册表 + `AppState` 注入）
- `crates/orange-library/` — 本地音乐库：扫描 / 元数据（lofty）/ SQLite 持久化（`.orangeradio/library.sqlite`）/ 用户歌单与收藏
- `crates/orange-audio/` — Hi-Res 解码 + DSP（v0.2 暂为 trait 骨架，v0.2 实际播放走前端 Web Audio API）
- `crates/orange-sources/` — 第三方音源：网易云 / QQ / Spotify / 网络电台 / 播客 RSS（统一 `AudioSource` trait）
- `crates/orange-ai/` — 播放侧 AI：推荐 / 歌词译注 / 语音交互（云端 LLM，OpenAI 兼容）
- `crates/orange-studio/` — AI 创作工作站（MiniMax）：写词 / 作曲 / 演唱 / STEM 分轨 / DAW 编辑
- `crates/orange-sync/` — 社交同步（一起听）
- `crates/orange-hue/` — 智能光效（Hue / RGB 灯随音乐律动）
- `server/` — Axum 社交后端（WebSocket，CORS，端口 3847）
- `frontend/` — React 18 + TypeScript + Vite + Three.js + Zustand + Web Audio API
- `extension/` — Manifest V3 浏览器识歌扩展（`background.js` / `content.js` / `popup.html`）
- `docs/` — 中文技术文档（01-架构 / 02-手册 / 03-开发 / 04-API / 05-音源插件 / 06-创作 / 07-Roadmap / 08-产品 / 09-计划）
- `.orangeradio/` — 运行时数据：SQLite 库 / 日志 / 缓存（已 gitignore）
- `test-music/` — 开发用测试音频（已 gitignore）
- `target/` — Cargo 构建产物（已 gitignore）

## Code style

- Rust：`edition = "2021"`，workspace 用 `resolver = "2"`，统一版本在 `[workspace.package]`；clippy 警告视为错误（`-D warnings`）；提交前 `cargo fmt --all`
- MSVC 工具链：`run.ps1` 已把 MSVC `link.exe` 加到 PATH 最前以盖过 Git Bash 的 `/usr/bin/link`；裸 cargo 命令请先 `run.ps1` 或手动设置 PATH
- 前端：TypeScript 严格模式（`tsconfig.json: strict`），React 18 + 函数组件 + hooks；状态走 Zustand store，不在组件内持有跨页状态
- 命名：crate 名 `orange-<domain>`（kebab），Rust 模块 `snake_case`，前端组件 `PascalCase`，Tauri 命令 `lower_snake_case`
- 不要在 `commands.rs` 之外加新的 `#[tauri::command]`：所有命令统一注册在 `crates/orange-tauri/src/commands.rs::register_all`

## Testing instructions

- Rust 单测：当前未配置（项目 v0.3 阶段，trait 骨架先行）— 见 `docs/09-开发计划.md` 中待办。新增 `crates/*/src/**` 代码时建议就近写 `#[cfg(test)]` 模块
- 前端测试：当前未配置 — 引入 Vitest 由 `tester` rein 负责
- 手动验收脚本：`.\run.ps1` 全流程；启动后应能扫本地库 / 搜网络电台 / 网易云扫码登录 / 播放 / 切歌
- 所有改动必须在 `cargo build -p orangeradio-desktop` + `npm run build` 双绿后才能合并

## PR & commit conventions

- 分支策略：所有改动基于 `main` 开新分支；**禁止直推 `main`**（默认分支）
- 提交规范：Conventional Commits（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` / `test:`）
- 涉及多 crate / 多模块时，提交信息正文列出每个 crate 的影响点
- 合并前需 `.harness/reins/tester/` 验收签字（人工或脚本）

## Security

- **绝不入库任何密钥**：Cookie / API Key / Spotify client secret / MiniMax key 等走本地配置，不进 git（`.gitignore` 已屏蔽 `.env*` / `*.pem` / `*.key`）
- 网易云 / QQ 音乐 Cookie 仅存内存或本地加密 DB；不要写入日志
- 第三方音源接口的 weapi 加密 / AES / RSA 密钥材料属实现细节，不暴露在 IPC 返回值
- 浏览器扩展权限最小化（已声明：`activeTab` / `tabCapture` / `storage` / `nativeMessaging` + `<all_urls>` host），新功能前先评估是否真的需要
- 详细安全策略（待补充）见 `SECURITY.md`（如不存在则由 orchestrator 创建）

## Repository-specific notes

- 中文优先：项目用户界面、技术文档、提交信息正文允许中文；代码标识符 / Cargo crate 名 / Tauri 命令名保持英文
- 单一 Cargo workspace（11 个成员），不要新增独立的 `Cargo.toml` 到子目录
- 前端通过 `convertFileSrc()` 把本地路径转成 `asset.localhost` URL 喂给 `<audio>`；不要绕过 IPC 直接读盘
- 当前架构状态、踩坑记录、未实现项见 `docs/01-技术架构.md` 和 `docs/09-开发计划.md`