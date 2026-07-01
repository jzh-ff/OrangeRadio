# 🍊 OrangeRadio

> **你的智能音乐宇宙** — AI 驱动、跨平台、沉浸式、可扩展的下一代音乐伴侣 + 创作工作站
>
> 全方位超越 Mineradio：更轻（Rust 而非 Electron）、跨平台（×5）、Hi-Res 发烧音质、AI 智能引擎、可编程视觉、社交协作，以及 Mineradio 完全没有的 **AI 音乐创作工作室**。

[![Version](https://img.shields.io/badge/version-0.1.0-orange)]()
[![Stage](https://img.shields.io/badge/stage-v0.1%20地基-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

OrangeRadio 是一款基于 **Tauri 2 + Rust** 的桌面应用，融合了沉浸式音乐播放、Hi-Res 高保真音质、AI 智能推荐、社交协作，以及由 **MiniMax** 驱动的专业级 **AI 音乐创作工作站（OrangeStudio）**。

## ✨ 核心能力

| 能力 | 说明 | 上线版本 |
|------|------|---------|
| 🎧 Hi-Res 高保真 | FLAC/WAV/ALAC/DSD 无损解码 + 专业 DSP | v0.2 |
| 🌌 沉浸式视觉 | Three.js 粒子/频谱/3D 歌单架/歌词舞台 | v0.4 |
| 🧠 懂你模式 | AI 行为画像驱动的智能推荐 | v0.5 |
| 📝 AI 歌词译注 | 实时翻译 + 典故/创作背景标注 | v0.5 |
| 🎹 AI 音乐创作 | MiniMax 写词/作曲/演唱 + STEM 分轨 + DAW 编辑 | v0.6 |
| 🎚️ AI DJ 混音 | BPM 对齐、无缝接歌 | v0.7 |
| 👥 一起听 | 异地同步听歌 + 实时互动 | v0.7 |
| 💡 智能光效 | Hue/RGB 灯随音乐律动 | v0.8 |

## 🏗️ 技术栈

- **核心**：Rust（Tauri 2 桌面壳 + 9 个 workspace crate）
- **前端**：React 18 + TypeScript + Vite + Three.js + Web Audio API
- **后端**：Rust Axum + WebSocket（社交/协作/一起听）
- **AI**：云端大模型（播放侧）+ MiniMax（创作侧）
- **扩展**：Manifest V3 浏览器扩展

## 📁 项目结构

```
OrangeRadio/
├── apps/desktop/      # Tauri 2 桌面应用
├── crates/            # Rust 核心（9 个模块）
├── frontend/          # React + Three.js 前端
├── server/            # Axum 社交后端
├── extension/         # 浏览器识歌扩展
└── docs/              # 技术文档（7 份）
```

详见 [docs/01-技术架构.md](docs/01-技术架构.md)。

## 🚀 快速开始

### 前置要求
- Rust (stable) + Cargo
- Node.js 18+
- 系统依赖（见开发文档）

### 启动桌面应用（开发模式）

```bash
# 安装前端依赖
cd frontend
npm install

# 通过 Tauri 启动（自动编译 Rust + 启动前端 dev server）
cd ../apps/desktop/src-tauri
cargo tauri dev
```

### 启动社交后端

```bash
cd server
cargo run
# 访问 http://localhost:3847
```

## 📚 文档

| 文档 | 内容 |
|------|------|
| [快速上手] | `.\run.ps1` 一键启动（详见 [03-开发文档](docs/03-开发文档.md)） |
| [08 - 产品规划](docs/08-产品规划.md) | 竞品分析 / 用户画像 / 八大超越维度 |
| [09 - 开发计划](docs/09-开发计划.md) | 任务拆解 / 优先级 / 依赖关系 |
| [01 - 技术架构](docs/01-技术架构.md) | 架构总览 / 关键技术决策（含踩坑记录） |
| [02 - 使用手册](docs/02-使用手册.md) | 界面导览 / 播放操作 |
| [03 - 开发文档](docs/03-开发文档.md) | 环境搭建 / 一键启动 / 报错排查 |
| [04 - API 设计](docs/04-API设计.md) | IPC 命令 + 后端 REST API |
| [05 - 音源插件开发指南](docs/05-音源插件开发指南.md) | 自定义音源开发 |
| [06 - 创作工作室指南](docs/06-创作工作室指南.md) | OrangeStudio AI 创作 |
| [07 - Roadmap](docs/07-Roadmap.md) | 版本规划 / 已知限制 |

## 📄 License

MIT
