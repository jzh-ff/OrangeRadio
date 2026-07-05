# 🍊 OrangeRadio

> **你的智能音乐宇宙** — 跨平台、沉浸式、多音源聚合的音乐播放器
>
> 基于 Tauri 2 + Rust，比 Electron 更轻量。多音源聚合搜索、节奏粒子视觉、跨源歌单收藏、全屏沉浸播放。

[![Version](https://img.shields.io/badge/version-0.3.0-orange)]()
[![Stage](https://img.shields.io/badge/stage-v0.3%20音源生态%20✅-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![Rust](https://img.shields.io/badge/Rust-7900行-orange)]()
[![React](https://img.shields.io/badge/React%2BTS-4400行-blue)]()

## ✨ 核心功能

### 🎵 多音源聚合
- **本地音乐**：FLAC/WAV/ALAC/MP3，lofty 元数据 + 封面提取
- **网易云音乐**：扫码/Cookie 登录、搜索、歌单、歌词（含翻译）、热门评论、远端收藏
- **QQ 音乐**：扫码（ptlogin2 四步换证）/Cookie、搜索、歌单、歌词、评论
- **Spotify**：OAuth2 + 30 秒试听
- **网络电台**：RadioBrowser 4 万+ 全球电台
- **播客**：RSS 订阅
- **聚合搜索**：一次搜索全网，混合列表 + 来源标签

### 🎨 沉浸式视觉
- **节奏粒子**：Three.js ShaderMaterial + UnrealBloomPass，低频爆发/高频闪烁/节拍推拉
- **全屏播放页**：4 种布局（电影粒子/沉浸双栏/歌词流/三栏）
- **动态歌词**：LRC 解析 + 自动滚动 + 翻译
- **真实封面**：网络 URL + 本地内嵌提取
- **视觉控制台**：灵敏度/粒子数/Bloom/颜色主题（橙焰/电紫/深海/极光）

### 📋 歌单与收藏
- **本地歌单系统**：新建/添加/删除，支持跨源收藏（网易云歌曲加入本地歌单）
- **智能收藏**：网易云→远端歌单，本地→本地收藏
- **播放队列**：右侧滑出面板

### 🔧 工程质量
- **50 个 IPC 命令**，11 个 Rust crate
- **竞态防护**：请求序号 + 防抖锁
- **登录态持久化**：AES-256-GCM 加密 + keyring
- **QQ 音乐 CORS 代理**：`orangeradio://` 自定义协议

## 🚀 快速开始

```bash
# 需要 Rust + Node.js
./run.ps1
```

详见 [使用手册](docs/02-使用手册.md)

## 📖 文档

| 文档 | 说明 |
|------|------|
| [01-技术架构](docs/01-技术架构.md) | 系统架构、模块职责、关键技术决策 |
| [02-使用手册](docs/02-使用手册.md) | 功能介绍、操作指南 |
| [03-开发文档](docs/03-开发文档.md) | 开发环境搭建、构建流程 |
| [07-Roadmap](docs/07-Roadmap.md) | 版本路线图 |
| [09-开发计划](docs/09-开发计划.md) | 各版本任务进度 |

## 🏗️ 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 |
| 核心 | Rust（stable-msvc）|
| 前端 | React 18 + TypeScript + Vite |
| 视觉 | Three.js + @react-three/fiber |
| 状态 | Zustand |
| 数据库 | SQLite (rusqlite) |
| 元数据 | lofty 0.21 |

## 📊 项目规模

- **Rust**：~7900 行（52 文件）
- **前端 TS/TSX**：~4400 行（33 文件）
- **CSS**：~2800 行（9 文件）
- **总计**：~15000 行

## 📜 License

MIT
