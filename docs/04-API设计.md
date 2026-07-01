# 04 - OrangeRadio API 设计

> IPC 命令 + 后端 REST API 参考 · v0.1

## 一、IPC 命令（前端 ↔ Rust）

前端通过 `invoke("command_name", { params })` 调用 Rust 命令。

### 通用

#### `ping`
健康检查。
```typescript
const msg: string = await invoke("ping");
// → "OrangeRadio v0.1.0 运行中"
```

#### `app_info`
获取应用信息。
```typescript
interface AppInfo { name: string; version: string; stage: string; }
const info = await invoke<AppInfo>("app_info");
```

### 播放器

#### `player_play`
播放指定曲目。
```typescript
await invoke("player_play", { trackId: "uuid" });
```

#### `player_pause` / `player_resume`
```typescript
await invoke("player_pause");
```

#### `player_next` / `player_previous`
```typescript
await invoke("player_next");
```

#### `player_seek`
```typescript
await invoke("player_seek", { positionSecs: 120.5 });
```

#### `player_set_volume`
```typescript
await invoke("player_set_volume", { volume: 0.8 });  // 0.0 - 1.0
```

#### `player_set_mode`
```typescript
type PlaybackMode = "sequence" | "list_loop" | "single_loop" | "shuffle" | "understand_you";
await invoke("player_set_mode", { mode: "understand_you" });
```

### 音源 / 搜索

#### `search`
多源聚合搜索。
```typescript
interface SearchResult { tracks: Track[]; total: number; hasMore: boolean; }
const result = await invoke<SearchResult>("search", { keyword: "周杰伦" });
```

#### `sources_list`
列出所有已注册音源。
```typescript
interface SourceInfo { id: string; kind: string; name: string; ready: boolean; }
const sources = await invoke<SourceInfo[]>("sources_list");
```

### 本地库

#### `library_scan`
扫描本地音乐。
```typescript
await invoke("library_scan", { rootDirs: ["D:/Music"], recursive: true });
```

#### `library_tracks`
获取本地库曲目列表。
```typescript
const tracks = await invoke<Track[]>("library_tracks", { page: 1, pageSize: 50 });
```

### AI

#### `ai_recommend`
获取推荐。
```typescript
const tracks = await invoke<Track[]>("ai_recommend", { limit: 20, scene: "work" });
```

#### `ai_voice_command`
语音指令。
```typescript
await invoke("ai_voice_command", { text: "播放轻音乐" });
```

#### `ai_translate_lyrics`
歌词译注。
```typescript
const annotated = await invoke<AnnotatedLyrics>("ai_translate_lyrics", { lyrics: "...", lang: "en" });
```

### 创作工作室

#### `studio_generate`
AI 生成音乐。
```typescript
interface GenerationRequest {
  stylePrompt: string;
  lyrics?: string;
  needStems: boolean;
}
const result = await invoke<GenerationResult>("studio_generate", { request: {...} });
```

#### `studio_save_project`
保存创作工程。
```typescript
await invoke("studio_save_project", { project: StudioProject });
```

### 投屏 / 光效

#### `cast_discover`
```typescript
const devices = await invoke<CastDevice[]>("cast_discover");
```

#### `hue_update`
```typescript
await invoke("hue_update", { mode: "beat_pulse" });
```

## 二、事件（Rust → 前端）

Rust 通过 Tauri event 系统向前端推送事件，前端用 `listen` 监听。

```typescript
import { listen } from "@tauri-apps/api/event";

listen("player://event", (e) => { /* e.payload: PlayerEvent */ });
listen("spectrum://frame", (e) => { /* e.payload: SpectrumData, ~60fps */ });
```

### 事件清单
| 事件 | payload | 频率 |
|---|---|---|
| `player://event` | `PlayerEvent` | 状态变化时 |
| `spectrum://frame` | `SpectrumData` | ~60fps |
| `library://scanned` | `{ count: number }` | 扫描完成 |
| `studio://progress` | `{ taskId, status, percent }` | 生成进度 |

## 三、Track 数据结构

```typescript
interface Track {
  id: string;
  sourceId: string;
  sourceTrackId: string;
  meta: {
    title: string;
    artist: string;
    album?: string;
    durationSecs?: number;
    bpm?: number;
    lyrics?: string;
    artwork?: { source: ArtworkSource; palette: [number, number, number][] };
  };
  format: AudioFormat;       // flac | wav | mp3 ...
  quality: Quality;          // standard | high | lossless | hires | master
  liked: boolean;
  playCount: number;
}
```

## 四、社交后端 REST API

Base URL: `http://localhost:3847`

### 认证
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/auth/me` | 当前用户 |

### 歌单
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/playlists` | 我的歌单 |
| POST | `/api/playlists` | 创建歌单 |
| POST | `/api/playlists/:id/tracks` | 添加曲目（协作） |
| PATCH | `/api/playlists/:id` | 编辑歌单 |

### 一起听
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/listen-together/rooms` | 创建房间 |
| GET | `/api/listen-together/rooms/:id` | 加入房间 |
| WS | `/api/listen-together/rooms/:id/ws` | 实时同步 |

WebSocket 消息：
```json
{ "type": "play", "trackId": "...", "position": 0 }
{ "type": "pause" }
{ "type": "chat", "text": "这首歌好听！" }
```

### 创作发布
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/studio/publish` | 发布创作 |
| GET | `/api/studio/feed` | 创作动态流 |
| POST | `/api/studio/:id/remix` | Remix 他人作品 |

### 创意市场
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/market` | 浏览市场 |
| POST | `/api/market` | 发布作品（皮肤/歌单/视觉场景） |
| POST | `/api/market/:id/install` | 安装 |

### 听歌报告
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/report/yearly` | 年度回顾 |
| GET | `/api/report/profile` | 听歌画像 |
