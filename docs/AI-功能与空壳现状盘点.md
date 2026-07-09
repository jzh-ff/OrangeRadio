# OrangeRadio AI 功能与空壳现状盘点

> 盘点日期：2026-07-09
> 范围：桌面端 + 后端 + 浏览器扩展
> 版本：v0.3（音源生态）

---

## 结论摘要

项目目前并非“完全没有 AI 功能”。**用户画像、懂你模式、AI 歌词译注、AI 音乐生成、AI 写词** 已经有真实后端实现并接入前端。但存在明显限制：

- 推荐候选池只来自本地曲库；
- 用户画像的 BPM 字段前后端不匹配，导致 BPM 偏好展示为空；
- 部分后端已注册能力前端未调用；
- 大量 v0.5+ 规划功能仍是空壳。

---

## 1. AI 功能真实可用性

| 功能 | 状态 | 说明 |
|---|---|---|
| 用户画像 | ✅ 真实可用，但有 bug | Rust 端 `aggregate_user_profile()` 从 SQLite `play_history` 真实聚合；但 `ProfilePanel.tsx` 期望的 BPM 字段是 `{min, max, center, distribution}`，后端返回的是 `{slow, medium, fast, very_fast}`，导致 BPM 偏好显示为空/0。 |
| 懂你模式 / 推荐下一首 | ✅ 真实可用，但候选池受限 | `crates/orange-ai/src/recommend.rs` 实现完整：本地画像打分（artist/genre/BPM/跳过/收藏/听完）+ 可选 LLM 重排；`useAudioEngine.ts` 切歌时真实调用 `recommend_next`。但候选池只来自**本地曲库**，本地无歌曲时返回空。 |
| AI 歌词译注 / 翻译 | ✅ 真实可用 | 后端 `orange-ai/src/lyrics.rs` 调用 LLM 返回翻译 + 注解；前端 `FullPlayerRightDrawer` 已接入，需要配置 MiniMax API Key。 |
| AI 写词 | ✅ 真实可用 | `orange-studio/src/lyrics.rs` 调用 LLM 生成结构化歌词。 |
| AI 音乐生成 | ✅ 真实可用 | `orange-studio/src/minimax.rs` 真实对接 MiniMax `music_generation`，可下载音频到本地。 |
| AI 分轨（STEM） | ⚠️ 半实现 | 通过“同一 prompt 两次生成（带唱 + 纯伴奏）”模拟人声/伴奏分离，不是真正音频分离，且消耗双倍额度。 |
| AI 演唱 / 音色克隆 | ❌ 空壳 | `orange-studio/src/vocal.rs` 直接返回 `AI演唱尚未实现 (v0.6)`、`音色克隆尚未实现 (v0.6)`。 |
| 工程渲染 / 母带导出 | ❌ 空壳 | `orange-studio/src/render.rs` 返回 `工程渲染尚未实现 (v0.8)`。 |
| 语音助手 | ❌ 空壳 | `orange-ai/src/voice.rs` 的 ASR 和指令解析都返回未实现。 |
| 情感分析 | ✅ 后端已实现 | `emotion_analyze` 命令已注册，但前端**没有任何调用点**。 |

---

## 2. 其他空壳 / 假数据 / 占位盘点

### 2.1 后端 Server（一起听 / 社交服务）

| 文件路径 | 函数/变量 | 状态 | 影响 |
|---|---|---|---|
| `server/src/routes.rs` | `auth_placeholder` | 空壳：返回固定 JSON | 用户认证未接入 |
| `server/src/routes.rs` | `playlists_placeholder` | 空壳：返回固定 JSON | 协作歌单未接入 |
| `server/src/routes.rs` | `listen_together_placeholder` | 空壳：返回固定 JSON | 实际 WebSocket 已实现，此路由只是占位 |
| `server/src/routes.rs` | `studio_publish_placeholder` | 空壳：返回固定 JSON | 创作发布/Remix 未接入 |
| `server/src/routes.rs` | `market_placeholder` | 空壳：返回固定 JSON | 创意市场未接入 |

### 2.2 音频引擎

| 文件路径 | 函数/变量 | 状态 | 影响 |
|---|---|---|---|
| `crates/orange-audio/src/decoder.rs` | `StubDecoder` | 空壳：不支持任何格式 | 仅 v0.1 骨架保留，真实解码用 `decode_file` |
| `crates/orange-audio/src/mixer.rs` | `DjMixer::find_mix_point` | 半实现：硬编码返回 `0.85` | 自动 BPM 对齐 / Crossfade 切换点未真实计算 |
| `crates/orange-audio/src/dsp.rs` | `DspChain` | 骨架：定义了 EQ / 空间音频 / 响度归一化结构，无实际处理 | v0.2 才会接入 DSP 实现 |
| `crates/orange-library/src/fingerprint.rs` | `FingerprintRecognizer::recognize` | 空壳：始终返回 `matched: false` | 听歌识曲未实现 |

### 2.3 音源

| 文件路径 | 函数/变量 | 状态 | 影响 |
|---|---|---|---|
| `crates/orange-sources/src/qishui.rs` | `QishuiSource::search` | 空壳：返回空 `SearchResult` | 汽水音乐搜索无结果 |
| `crates/orange-sources/src/qishui.rs` | `QishuiSource::resolve_stream` | 空壳：返回“尚未接入” | 汽水音乐无法播放 |
| `crates/orange-sources/src/spotify.rs` | `SpotifySource::resolve_stream` | 半实现：仅返回 30 秒 preview URL | 非 Premium 用户只能试听 30 秒 |
| `crates/orange-sources/src/kugou.rs` | `current_user` 兜底 | 半实现：接口失败时返回占位 `UserInfo` | 酷狗用户信息可能不准确 |
| `crates/orange-sources/src/web_radio.rs` | 国家名格式化 | 使用国旗占位 `🇫🇷` | 网络电台国家展示为 emoji 占位 |

### 2.4 同步 / 投屏 / 多设备

| 文件路径 | 函数/变量 | 状态 | 影响 |
|---|---|---|---|
| `crates/orange-sync/src/cast.rs` | `DeviceCaster::discover` | 空壳：返回空 `Vec<CastDevice>` | DLNA/AirPlay/Chromecast 未发现设备 |
| `crates/orange-sync/src/cast.rs` | `DeviceCaster::cast` | 空壳：返回“投屏尚未实现 (v0.8)” | 无法投屏 |
| `crates/orange-sync/src/handoff.rs` | `HandoffManager::broadcast` | 空壳：返回 `Ok(())` | 多设备接力未实现 |
| `crates/orange-sync/src/handoff.rs` | `HandoffManager::receive` | 空壳：返回 `Ok(None)` | 无法接收其他设备状态 |

### 2.5 前端 UI

| 文件路径 | 函数/变量 | 状态 | 影响 |
|---|---|---|---|
| `frontend/src/App.tsx` | `demoTrack` | 首启占位曲目 | 本地库为空时播放内置 demo，非真实用户数据 |
| `frontend/src/features/social/SocialView.tsx` | `SocialView` | 空壳组件：只显示“社交功能 v0.7 上线” | 一起听 / 年度回顾 / 创意市场入口无内容 |
| `frontend/src/components/Sidebar.tsx` | 一起听菜单项 | `disabled: true`，status: `v0.7` | 侧栏一起听入口不可点 |
| `frontend/src/features/player/AddToPlaylistDialog.tsx` | `renderQqSection` | QQ 远端添加未实现，仅展示提示 | 无法将歌曲真正添加到 QQ 远端歌单 |
| `frontend/src/features/player/QishuiView.tsx` | 整视图 | 接口待接入，搜索返回空列表 | 汽水音乐视图无真实数据 |
| `frontend/src/features/player/PodcastView.tsx` | `SUGGESTED` | 硬编码 2 个推荐 RSS | 播客推荐仅 2 个固定示例 |
| `frontend/src/features/player/NeteaseView.tsx` | `QUALITY_OPTIONS` | 硬编码音质选项列表 | 正常 UI 常量 |
| `frontend/src/visual/PlaylistShelf.tsx` | `drawVinylPlaceholder` | 无封面时黑胶占位图 | 视觉降级，非逻辑假数据 |

### 2.6 浏览器扩展

| 文件路径 | 函数/变量 | 状态 | 影响 |
|---|---|---|---|
| `extension/background.js` | `RECOGNIZE` 消息处理 | 返回 `status: "pending", stage: "v0.9"` | 识歌扩展未真实识别 |
| `extension/content.js` | 内容脚本 | 仅 `console.log`，无实际媒体提取 | 无法从页面抓取音频 |

---

## 3. 关键 bug（影响真实可用性）

| 问题 | 位置 | 影响 | 建议修复 |
|---|---|---|---|
| BPM 字段不匹配 | `frontend/src/components/ProfilePanel.tsx:10` vs `crates/orange-library/src/database.rs` | BPM 偏好显示为空/0 | 后端补齐 `min/max/center/distribution`，或前端改展示分桶 |
| 懂你模式 LLM 协议不匹配 | 前端设置页“复用 MiniMax” | 推荐 LLM 重排调用失败 | 让该选项走 Anthropic 兼容协议，而非 OpenAI 协议 |
| 情感分析未接入 | `emotion_analyze` 已注册 | 后端能力浪费 | 前端在歌词/播放页增加情绪分析入口 |
| Hue 智能光效未接入 | `crates/orange-hue` 已实现 | 后端已连接 Hue 灯也无法触发 | 前端增加 Hue 发现/配对/开关 UI |
| 推荐候选池仅限本地 | `recommend_next` 调用 `library.all()` | 空库时无推荐 | 接入网络电台/第三方音源搜索作为候选池 |

---

## 4. 真实可用的非 AI 模块

以下模块已经真实实现，不是空壳：

- 本地音乐库：扫描、元数据、SQLite 持久化、播放列表、收藏、播放历史。
- 网易云音乐：二维码登录、歌单、日推、榜单、搜索、取流、歌词、评论、收藏。
- QQ 音乐：cookie/二维码登录、自动刷新、歌单、搜索、取流、歌词、评论。
- 酷狗音乐：搜索、取流、歌词、歌单、用户信息。
- 酷我音乐：搜索、榜单、歌词、取流，免登录。
- 歌曲宝（Gequbao）：HTML 抓取搜索/详情/取流。
- 网络电台：RadioBrowser 搜索/推荐。
- 播客：RSS 2.0 / iTunes 解析。
- 一起听：独立 `server` crate（Axum + WebSocket）已实现房间广播。
- 壁纸 / Wallpaper Engine：扫描、保存、移除、导入。
- 视觉/频谱：WebAudio 真实频谱、节拍图谱、BeatCam、粒子、壁纸层。

---

## 5. 总体评估

- **v0.2 核心体验（本地库 + 多音源 + 播放 + 视觉）**：基本真实可用。
- **v0.3 AI 增强（画像、懂你模式、歌词译注、Studio 生成）**：已实现，但受限于候选池和字段 bug。
- **v0.5+ 规划（语音、社交、投屏、多设备、工程渲染、AI 演唱、识曲）**：大面积空壳或占位，未进入实现阶段。
- **前端 store 没有凑界面假数据**：业务状态均来自 Tauri IPC 或 localStorage 配置，没有 mock service worker。

---

## 6. 建议修复优先级

1. **P0：BPM 字段对齐** — 直接修复用户画像“看起来没数据”的感知。
2. **P0：懂你模式跨源推荐** — 把候选池从本地库扩展到网络电台 / 第三方音源，避免空库无推荐。
3. **P1：MiniMax 推荐协议修复** — 让“复用 MiniMax”真正可用。
4. **P1：前端接入 `emotion_analyze` 和 Hue 后端** — 后端已存在，只需补 UI 调用。
5. **P2：语音/社交/投屏/工程渲染等 v0.5+ 能力** — 按 Roadmap 逐步推进。
