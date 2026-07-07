# Electron 版 OrangeMusic 架构设计

> 状态：草案，已吸收 MineRadio 视觉/音频核心精华，待用户 review 后定稿。

## 1. 背景与目标

### 1.1 项目定位
OrangeRadio 当前是基于 **Tauri 2 + Rust workspace + React/Vite** 的桌面音乐播放器，已支持本地曲库、网易云、QQ 音乐、酷狗、汽水、电台、播客、AI 创作、Wallpaper Engine 视觉等能力。MineRadio 是一款成熟的 Electron 音乐播放器，其 Three.js 粒子系统、电影镜头运镜、歌词渲染、音律震动、AI 节拍分析等视觉/音频实现具有极高参考价值。

### 1.2 本次目标
在**新仓库** `D:\ZCodeWP\OrangeMusic` 中独立开发一套 **Electron 版 OrangeMusic**：
- **保留现有 Tauri 版 OrangeRadio 不动**，两版长期并行。
- 功能上**完全对齐当前 Tauri 版**，并在视觉沉浸感、音频分析、用户体验上**全面超越 MineRadio**。
- 后端核心用 **TypeScript/Node 重写**，不依赖现有 Rust crates。
- 前端采用 **Vue 3 + Vite + TypeScript + Pinia**，全新 UI 设计。
- 深度吸收 MineRadio 精华：粒子系统、电影镜头、歌词渲染、频谱震动、AI 节拍图谱、黑胶动画、主题色提取、毛玻璃质感。

### 1.3 成功标准
- [ ] 能播放本地音乐、网易云、QQ 音乐、酷狗、汽水、电台、播客。
- [ ] 支持登录态持久化、本地库扫描、歌单/收藏/播放历史。
- [ ] 支持桌面歌词、全局热键、自定义标题栏、多窗口。
- [ ] 支持 Wallpaper Engine 视觉、AI 创作、一起听（一期包含）。
- [ ] 沉浸式视觉：Three.js 粒子 + 电影镜头 + 频谱联动 + 黑胶动画 + 主题色提取。
- [ ] AI 音频分析：离线 beatmap、多频段 onset、长音频分段采样、播客 DJ 节拍锁定。
- [ ] 构建产物可安装、可自动更新，一期 Windows，后续扩展 macOS/Linux。
- [ ] 性能指标：冷启动 ≤ 3s，本地库 10 万首扫描 ≤ 30s，播放切换 ≤ 500ms。

---

## 2. 高层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron 主进程                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  App Core    │  │  Source      │  │  Protocol / CORS     │  │
│  │  (生命周期)   │  │  Engines     │  │  Proxy               │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────────┴──────────┐  │
│  │  Library     │  │  AuthStore   │  │  Media / Cover      │  │
│  │  Service     │  │  (safeStorage)│  │  Cache Service      │  │
│  └──────────────┘  └──────────────┘  └─────────────────────┘  │
│         │                 │                      │              │
│         └─────────────────┼──────────────────────┘              │
│                           ▼                                     │
│                  ┌─────────────────┐                           │
│                  │  SQLite / LevelDB │                          │
│                  │  + 文件系统      │                           │
│                  └─────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
                              │ IPC (contextBridge)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Electron 渲染进程                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    全新前端应用                            │  │
│  │  (技术栈待定：Vue/React/Svelte + 全新设计系统)            │  │
│  │                                                          │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────┐  │  │
│  │  │ Player  │ │ Library │ │ Sources │ │ AI Studio     │  │  │
│  │  │ Engine  │ │ /Playlist│ │ Views   │ │ / Settings    │  │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └───────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 关键决策

### 3.1 后端：TS/Node 重写核心
| 模块 | 说明 |
|------|------|
| `app-core` | 主进程生命周期、窗口管理、配置、日志、自动更新。 |
| `source-engine` | 音源抽象层 + 各平台实现（网易云、QQ、酷狗、汽水、Spotify、电台、播客）。 |
| `library-service` | 本地库扫描、SQLite 持久化、歌单/收藏/历史/用户画像。 |
| `auth-store` | 登录态加密持久化，使用 Electron `safeStorage`。 |
| `protocol-service` | 注册 `orangeradio://` 自定义协议，处理 QQ 音乐 CORS 代理、本地文件代理。 |
| `media-cache` | 封面、歌词、音频缓存管理。 |
| `recommender` | 推荐引擎、AI 歌词/情绪分析接口。 |
| `sync-service` | 一起听 WebSocket 服务端（二期）。 |

### 3.2 前端：Vue 3 + Vite + TypeScript + Pinia，全新沉浸式视觉
- **框架**：Vue 3 + Vite + TypeScript + Pinia。
  - 理由：与 Electron 主进程配合成熟，生态完善，性能优异，适合长生命周期桌面应用。
- **设计系统**：全新设计语言，参考 MineRadio 的沉浸感，但更现代、更轻量、更可扩展。
- **音频播放**：原生 `<audio>` + Web Audio API，沿用 Tauri 版的 `captureStream` 频谱方案，同时吸收 MineRadio 的 `MediaElementSource + AnalyserNode` 双 analyser 方案。
- **视觉核心**：Three.js 粒子系统 + 电影镜头运镜 + 频谱联动 + 黑胶动画 + 毛玻璃质感 + 主题色提取。

### 3.3 进程模型
- **单主进程 + 单渲染进程**（主窗口）。
- **歌词悬浮窗**：独立 BrowserWindow，透明、无边框、置顶。
- **可选 Worker**：音频分析、本地库扫描走 Node worker_threads，避免阻塞主进程。

### 3.4 数据持久化
- **本地库**：SQLite（`better-sqlite3`）或 `libsql`。路径：`{userData}/library.sqlite`。
- **配置**：`electron-store` 或 JSON 文件。
- **登录态**：`safeStorage.encryptString` / `decryptString`。
- **缓存**：封面、歌词、音频片段存 `{userData}/cache/`。

### 3.5 自定义协议
- 注册 `orangeradio://` protocol handler。
- `/qqstream?url=...`：代理 QQ CDN，透传 `Range` 头，加 `Referer` + UA，返回 `Access-Control-Allow-Origin: *`。
- `/wefile?path=...`：读取 Wallpaper Engine 文件，校验 `we_roots` 白名单。
- `/asset?path=...`：本地文件代理（替代 Tauri 的 `convertFileSrc`）。
- 自定义协议同时作为 `<audio>` 与 WebGL 纹理的跨域代理，与 MineRadio 的 `/api/audio`、`/api/cover` 形成互补。

---

## 4. 模块详细设计

### 4.1 音源抽象层
```ts
// src/main/sources/source.ts
export interface Track {
  id: string;
  sourceKind: SourceKind;
  title: string;
  artists: string[];
  album?: string;
  durationSec?: number;
  coverUrl?: string;
  sourceTrackId: string;
}

export interface AudioSource {
  readonly kind: SourceKind;
  search(query: string, page: number): Promise<Track[]>;
  getStreamUrl(track: Track): Promise<string>;
  getLyrics(track: Track): Promise<LyricLine[] | null>;
  getPlaylists?(): Promise<Playlist[]>;
  login?(): Promise<boolean>;
  refreshSession?(): Promise<void>;
}
```

各音源实现为独立文件：`netease.ts`、`qqmusic.ts`、`kugou.ts`、`qishui.ts`、`webRadio.ts`、`podcast.ts`、`spotify.ts`。

### 4.2 IPC 设计
所有能力通过 `contextBridge` 暴露给渲染进程：
```ts
// src/preload/api.ts
export interface ElectronAPI {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
  platform: 'win32' | 'darwin' | 'linux';
}
```

主进程 handlers 与 Tauri 命令一一映射，命名保持兼容以便前端迁移思路：
- `library_scan`、`library_tracks`、`library_search`
- `search_all`、`netease_search`、`qqmusic_search`、...
- `netease_stream`、`qqmusic_stream`、`kugou_stream`、...
- `cover_proxy`、`analyze_beatmap`、`wallpaper_scan`
- `auth_login`、`auth_logout`、`auth_status`

### 4.3 窗口管理
- 主窗口：1280x800，无边框、透明背景。
- 歌词窗口：`lyric-overlay`，独立 BrowserWindow。
- 壁纸窗口：`wallpaper`，独立 BrowserWindow，支持 attach 到 Windows `WorkerW`。
- 窗口控制：最小化/最大化/关闭通过 IPC 调用主进程。
- 拖拽区：`-webkit-app-region: drag`。

### 4.4 安全策略
- `contextIsolation: true`，`nodeIntegration: false`。
- 自定义协议仅允许白名单路径。
- 网络请求只在主进程发起，渲染进程不直接访问外部 API。
- 登录态、密钥不进入渲染进程，不记录到日志。

---

## 5. 沉浸式视觉与音频分析系统

### 5.1 Three.js 粒子系统
- 使用 `THREE.Points` 点精灵，单 `BufferGeometry` + 顶点 Shader 内实现多套预设。
- 预设（参考 MineRadio 扩展）：
  - `SILK`：xy 平面 + z 向噪声 + 涟漪
  - `TUNNEL`：圆柱隧道，bass 收缩半径
  - `ORBIT`：球面分布，自转 yaw
  - `VOID`：点缩到远处，纯背景
  - `VINYL`：Shader 内生成唱片，内圈封面 + 外圈 groove，随 `uVinylSpin` 旋转
  - `WALLPAPER`：极坐标螺旋带 + 星空 dust
- **性能优化**：
  - 叠加两层 Points：NormalBlending 实体层 + AdditiveBlending 泛光层，替代后处理 Bloom。
  - DPR 动态封顶：`RENDER_DPR_CAP = 1.35`，像素预算 `5_200_000`。
  - 封面纹理动态尺寸：256/384/512。
  - `frustumCulled = false`。

### 5.2 电影镜头运镜
- 双层轨道：
  - `userTheta/userPhi/userRadius`：用户拖拽/滚轮目标，永久保留。
  - `cineTheta/cinePhi/cineRadius`：电影模式微偏移，叠加在用户目标上。
- 电影漂移：低频正弦 + 节拍 kick 叠加。
- Beat 运镜：事件队列 + attack/hold/release 三段包络 + smoothstep。
- 焦点区：hover 0.26s 后缓推到预设位，退出 120ms 回正。
- FOV 联动缓动。

### 5.3 频谱与音律震动
- **双 AnalyserNode**：
  - 主 analyser：`fftSize=2048`，`smoothingTimeConstant=0.58`（视觉平滑）。
  - Beat analyser：`fftSize=2048`，`smoothingTimeConstant=0.10`（瞬态检测）。
- 频段分组：kick 0–6、vocal 7–139、mid 140–279、treble 280+。
- 动态峰值归一化 + 不对称 attack/release 包络。
- 映射到：粒子大小/颜色、歌词闪光、黑胶转速、封面缩略图缩放。

### 5.4 歌词渲染与扫描
- LRC 解析：`\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]`。
- YRC 解析：`[ms,dur](ms,dur,0)word(...)`，注意相对/绝对时间修正。
- 字级进度映射到 UV x 轴，Shader 内 `smoothstep` 渐变。
- 桌面歌词：CSS `background-clip:text` + `linear-gradient` 实现 Karaoke。
- 中文/英文混排统一用 `Array.from(text).length` 计算 `charCount`。

### 5.5 AI 音频分析 / 节拍图谱
- **离线分析**：
  - `OfflineAudioContext` 分四段渲染：38–155Hz、130–420Hz、420–2600Hz、1800–9000Hz。
  - 10ms 窗口 RMS 能量 → 多频段 onset 检测。
  - 可选 Web Worker BPM 估计，与能量 onset 相位对齐。
- **服务端 DJ 分析**（长音频/播客）：
  - `mpg123-decoder` 流式解码。
  - 双二阶滤波器：高通 32Hz + 低通 178Hz 提取 kick。
  - 节拍锁定：直方图投票 + 相位扫描。
  - 长播客分段采样（8/10/12 段），每段 82–96 秒，插值拼接。
- **beatmap 数据结构**：`kicks/beats/pulseBeats/cameraBeats/gridStep/tempoSource/duration`。
- **缓存策略**：内存 → localStorage → 后端磁盘缓存 → 队列预取。

### 5.6 其他视觉细节
- **毛玻璃**：`backdrop-filter: blur(12px) saturate(1.8) brightness(1.16)` + SVG `feDisplacementMap` 做 RGB 色差。
- **主题色提取**：封面 8×8 采样，色度×1.6 + 亮度居中×0.45 评分。
- **黑胶动画**：Shader 内生成，`recordR=2.46, coverR=1.18`，转速受 `smoothBass` 影响。

### 5.1 目录结构（新仓库）
```
D:\ZCodeWP\OrangeMusic\
├── package.json
├── electron-builder.yml
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 入口：窗口创建、服务启动、协议注册
│   │   ├── core/
│   │   │   ├── app.ts           # 生命周期、单例、配置
│   │   │   ├── window-manager.ts # BrowserWindow 管理
│   │   │   ├── protocol.ts      # orangeradio:// 协议注册
│   │   │   ├── hotkeys.ts       # 全局热键
│   │   │   └── updater.ts       # 自动更新
│   │   ├── server/              # 内嵌 Node HTTP 服务
│   │   │   ├── index.ts         # express/fastify 服务入口
│   │   │   ├── router.ts        # /api 路由汇总
│   │   │   ├── sources/         # 音源实现
│   │   │   │   ├── index.ts     # provider 注册表
│   │   │   │   ├── netease.ts
│   │   │   │   ├── qqmusic.ts
│   │   │   │   ├── kugou.ts
│   │   │   │   ├── qishui.ts
│   │   │   │   ├── web-radio.ts
│   │   │   │   ├── podcast.ts
│   │   │   │   └── spotify.ts
│   │   │   ├── library/
│   │   │   │   ├── service.ts
│   │   │   │   ├── scanner.ts
│   │   │   │   └── schema.sql
│   │   │   ├── auth/
│   │   │   │   ├── store.ts
│   │   │   │   ├── netease-login.ts
│   │   │   │   └── qqmusic-login.ts
│   │   │   ├── proxy/
│   │   │   │   ├── audio.ts     # /api/audio CORS 代理
│   │   │   │   ├── cover.ts     # /api/cover CORS 代理
│   │   │   │   └── qqstream.ts  # orangeradio://qqstream 处理
│   │   │   ├── media/
│   │   │   │   ├── cache.ts
│   │   │   │   ├── lyrics.ts
│   │   │   │   └── beatmap.ts
│   │   │   └── ai/
│   │   │       ├── lyrics.ts
│   │   │       ├── mood.ts
│   │   │       └── creation.ts
│   │   └── preload/
│   │       └── index.ts         # contextBridge 暴露 API
│   └── renderer/                # Vue 3 前端
│       ├── main.ts
│       ├── App.vue
│       ├── router.ts
│       ├── stores/
│       ├── components/
│       ├── views/
│       ├── features/
│       │   ├── player/
│       │   ├── library/
│       │   ├── sources/
│       │   ├── studio/
│       │   └── sync/
│       ├── visuals/             # 沉浸式视觉系统
│       │   ├── scene.ts         # Three.js 场景初始化
│       │   ├── particles.ts     # 粒子系统 + 6 套预设
│       │   ├── camera.ts        # 电影镜头运镜
│       │   ├── spectrum.ts      # 频谱分析 + 双 analyser
│       │   ├── beatmap.ts       # 离线 beatmap 分析
│       │   ├── lyrics-render.ts # 3D 舞台歌词
│       │   ├── vinyl.ts         # 黑胶动画
│       │   └── palette.ts       # 主题色提取
│       ├── styles/
│       └── workers/
│           └── beat-analyzer.ts # beatmap Web Worker
├── resources/
│   ├── icons/
│   ├── wallpapers/
│   └── default-fx-archive.json
├── build/
│   ├── installer.nsh            # NSIS 安装脚本
│   └── after-pack.js
├── scripts/
│   ├── dev.ts                   # 开发启动脚本
│   └── build.ts
└── tests/
    ├── unit/
    └── e2e/
```

### 5.2 开发命令
```bash
npm install
npm run dev          # Vite dev + Electron 启动
npm run build        # 前端构建 + Electron 打包
npm run dist         # 生成安装包
npm run lint
npm run typecheck
```

### 5.3 打包工具
- **electron-builder**：生成 `.exe`、`.dmg`、`.AppImage`，支持自动更新。
- 可选 **electron-forge** 做开发体验更好的插件生态。

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| TS 重写音源工作量大 | 高 | 分阶段实现：先网易云/QQ/本地库 MVP，再补齐酷狗/汽水/电台/播客。 |
| 加密登录态迁移 | 高 | 使用 `safeStorage`，与 Tauri 版不互通，用户需重新登录。 |
| 自定义协议 Range 透传 | 中 | 参考 Tauri 版实现，单元测试覆盖 seek 场景。 |
| 前端全新设计延迟 | 中 | 先搭通用组件库，再逐页迁移；可用临时 UI 验证功能。 |
| 两版并行维护成本 | 中 | 共享产品需求文档和 API 契约，避免能力分叉。 |
| 性能不如 Rust 版 | 中 | 本地库用 better-sqlite3 + 索引；扫描走 worker；缓存 aggressively；视觉 DPR 封顶。 |
| 视觉系统复杂度高 | 高 | 按 preset 拆分 shader；双 Points 替代 Bloom；beatmap 按需分析；长音频走服务端。 |
| 实时频谱与粒子性能 | 中 | DPR 动态封顶；低频 RAF 降载；最小化暂停渲染；worker 化音频分析。 |
| beatmap 分析覆盖所有歌曲 | 中 | 本地文件离线分析；在线歌曲按需分析；长播客走服务端分段；队列预取。 |

---

## 7. 里程碑

### Milestone 1：Electron 壳 + 本地播放 + 视觉骨架（第 1-3 周）
- [ ] 创建 `D:\ZCodeWP\OrangeMusic` 仓库，初始化 `package.json`（name: `orangemusic`）。
- [ ] 配置 TypeScript、Vite、Vue 3、Pinia、Electron、electron-builder。
- [ ] 实现主进程入口 `src/main/index.ts`：创建无边框透明主窗口、自定义标题栏、最小化/最大化/关闭。
- [ ] 实现 preload 脚本 `src/main/preload/index.ts`，通过 `contextBridge` 暴露窗口控制、平台信息。
- [ ] 实现渲染进程 Vue 3 入口与基础布局（标题栏、侧边栏、主内容区）。
- [ ] 实现 Three.js 视觉场景骨架 `src/renderer/visuals/scene.ts`：场景、相机、渲染器初始化，DPR 动态封顶。
- [ ] 实现音频播放引擎 `src/renderer/features/player/audio-engine.ts`：`<audio>` + `MediaElementSource` + 双 AnalyserNode。
- [ ] 实现频谱分析模块 `src/renderer/visuals/spectrum.ts`：频段分组、动态峰值归一化、输出给视觉系统。
- [ ] 配置开发脚本 `npm run dev` 和生产构建 `npm run build`。

**验证**：`npm run dev` 能启动无边框窗口并显示 Vue 应用；Three.js 场景正常渲染；`<audio>` 能播放本地文件并输出频谱数据；`npm run build` 能生成可运行 exe。

### Milestone 2：本地库 + 沉浸式视觉基础（第 4-6 周）
- [ ] 接入 `better-sqlite3`，设计 `library.sqlite` schema（tracks、playlists、history、favorites、user_profile）。
- [ ] 实现本地目录扫描器 `src/main/server/library/scanner.ts`，支持 mp3/flac/wav/ogg/m4a，读取 ID3 元数据。
- [ ] 实现本地库 HTTP API：`/api/library/scan`、`/api/library/tracks`、`/api/library/search`。
- [ ] 实现 Vue 本地库视图：扫描入口、歌曲列表、歌单管理。
- [ ] 实现 Three.js 粒子系统 `src/renderer/visuals/particles.ts`：6 套 preset（SILK/TUNNEL/ORBIT/VOID/VINYL/WALLPAPER），双层 Points 泛光。
- [ ] 实现黑胶动画 `src/renderer/visuals/vinyl.ts`：Shader 内生成唱片，转速联动 bass。
- [ ] 实现主题色提取 `src/renderer/visuals/palette.ts`：封面 8×8 采样，色度 + 亮度评分。
- [ ] 实现毛玻璃组件库：backdrop-filter + SVG `feDisplacementMap` 色差玻璃。

**验证**：本地库扫描入库后能播放；粒子系统可切换 preset；黑胶动画随音乐旋转；主题色从封面正确提取。

### Milestone 3：网易云与 QQ 音乐（第 7-10 周）
- [ ] 接入 `NeteaseCloudMusicApi`，实现 provider `src/main/server/sources/netease.ts`。
- [ ] 实现网易云登录：扫码登录窗口（独立 BrowserWindow + 持久 partition），cookie 用 `safeStorage` 加密保存。
- [ ] 实现 QQ 音乐 provider `src/main/server/sources/qqmusic.ts`，参考 MineRadio 的 `musicu.fcg` 实现。
- [ ] 实现 QQ 音乐登录窗口与 cookie 加密存储。
- [ ] 实现 CORS 代理：`/api/audio`、`/api/cover`，加域名白名单与 referer 校验。
- [ ] 实现 `orangeradio://qqstream` 自定义协议代理，透传 Range 头。
- [ ] 实现播放限制分类：`login_required`、`vip_required`、`trial_only`、`copyright_unavailable`，前端据此提示或自动换源。
- [ ] 实现网易云/QQ 音乐搜索、歌单、排行榜、红心、评论视图。

**验证**：网易云/QQ 音乐登录后能搜索、播放 VIP/高音质歌曲、拖动进度、显示歌词。

### Milestone 4：歌词、电影镜头、beatmap（第 11-13 周）
- [ ] 实现 LRC / YRC 解析器 `src/renderer/features/player/lyrics-parser.ts`。
- [ ] 实现 3D 舞台歌词 `src/renderer/visuals/lyrics-render.ts`：字级进度映射到 UV，Shader 渐变。
- [ ] 实现桌面歌词窗口 `lyric-overlay`：透明、无边框、置顶、鼠标穿透、CSS `background-clip:text` Karaoke。
- [ ] 实现电影镜头运镜 `src/renderer/visuals/camera.ts`：双层轨道、低频漂移、Beat 三段包络、焦点区。
- [ ] 实现离线 beatmap 分析 `src/renderer/workers/beat-analyzer.ts`：多频段 RMS、onset 检测、BPM 相位对齐。
- [ ] 实现 beatmap 缓存策略：内存 → localStorage → 后端磁盘缓存 → 队列预取。
- [ ] 实现播放切换淡入淡出。

**验证**：桌面歌词同步显示且 Karaoke 效果正确；电影镜头随节拍自然晃动；beatmap 分析后镜头/粒子精准卡点。

### Milestone 5：酷狗、汽水、电台、播客、长音频 DJ 分析（第 14-16 周）
- [ ] 实现酷狗 provider `src/main/server/sources/kugou.ts`。
- [ ] 实现汽水 provider `src/main/server/sources/qishui.ts`。
- [ ] 实现网络电台 provider `src/main/server/sources/web-radio.ts`。
- [ ] 实现播客 provider `src/main/server/sources/podcast.ts`（复用网易云播客 API）。
- [ ] 实现服务端 DJ 长音频分析 `src/main/server/media/beatmap-server.ts`：`mpg123-decoder` 流式解码、双二阶滤波、分段采样。
- [ ] 实现各平台对应 Vue 视图。
- [ ] 统一 provider 注册表 `src/main/server/sources/index.ts`。

**验证**：所有在线音源能搜索、取流、播放；长播客能生成 beatmap 且镜头不卡；切换音源不闪退。

### Milestone 6：桌面歌词、壁纸、热键、设置（第 17-19 周）
- [ ] 完善桌面歌词窗口：中键锁定、位置记忆、多显示器适配。
- [ ] 实现 Wallpaper Engine 扫描与 `orangeradio://wefile` 白名单代理。
- [ ] 实现壁纸模式：独立窗口 + WorkerW attach（Windows）。
- [ ] 实现全局热键：播放/暂停、下一首、上一首、显示/隐藏歌词、显示/隐藏窗口。
- [ ] 实现设置面板：主题、音频输出、缓存清理、登录管理、热键配置、视觉 preset 选择。
- [ ] 实现用户视觉存档导出/导入 JSON。

**验证**：桌面歌词可锁定、壁纸模式能设为桌面背景、热键全局生效、设置持久化。

### Milestone 7：AI 创作与一起听（第 20-23 周）
- [ ] 实现 AI 歌词译注/情绪分析接口。
- [ ] 实现 AI 音乐创作工作流：歌词生成、音乐生成、分轨预览、输出目录选择。
- [ ] 实现一起听 WebSocket 服务端 `src/main/server/sync/`。
- [ ] 实现一起听 UI：创建房间、加入房间、同步播放、聊天。

**验证**：AI 创作能生成并预览；一起听两客户端能同步播放进度。

### Milestone 8：构建、发布、 polish（第 24-26 周）
- [ ] 配置 `electron-builder.yml`：NSIS 安装包、图标、版本信息。
- [ ] 编写 `build/installer.nsh`：安装目录保护、阻止 C 盘安装、卸载安全。
- [ ] 编写 `build/after-pack.js`：图标/版本注入。
- [ ] 实现自动更新：GitHub Releases + 国内镜像 + 补丁 JSON。
- [ ] 性能优化：本地库扫描 worker 化、大数据列表虚拟滚动、启动时间优化、视觉系统降载策略。
- [ ] 安全加固：asar 开启、代理白名单、补丁签名校验。
- [ ] 补单元测试与 E2E 测试。

**验证**：生成安装包可安装/卸载；自动更新流程可检测并下载；测试覆盖核心播放与登录链路。

---

## 8. 待确认事项

1. 前端框架已确认 **Vue 3 + Vite + TypeScript + Pinia**。
2. 一期平台已确认 **Windows**，macOS/Linux 后续扩展。
3. 一期范围已确认包含 **AI 创作 / 一起听**。
4. 仓库路径已确认 `D:\ZCodeWP\OrangeMusic`，package name 为 `orangemusic`。
5. 与 Tauri 版数据不互通，独立用户数据目录与登录态。
