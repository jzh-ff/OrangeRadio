# 音源补全与 Studio 增强（v0.3.2）

> 本次改动覆盖三大领域：音源前端补全、酷我音源增强（flac.music.hi.cn 镜像）、AI 音乐创作台完整增强。

## 一、音源前端补全

### 1.1 问题背景

调研发现，音源后端实现程度远高于前端接入程度：

| 音源 | 后端能力 | 前端接入差距 |
|---|---|---|
| 网易云 | 登录/搜索/歌词/评论/歌单/收藏 | ✅ 完整 |
| QQ 音乐 | 登录/搜索/歌词/**评论**/歌单 | ⚠️ 后端有 `qqmusic_comments`，但前端 `CommentList` 硬编码只调网易云 |
| 酷狗 | 登录/搜索/歌词/歌单 | ✅ 歌词已接 |
| 酷我 | 搜索/播放/歌词/排行榜 | ✅ 已接 |
| 歌曲宝 | 搜索/播放/**歌词**（在 `enrich_track_detail`） | ⚠️ 无独立歌词命令，FullPlayer 歌词分发未覆盖 |
| Spotify | 搜索/30s 预览 | ❌ 无歌词（官方 API 已移除歌词端点） |
| 汽水音乐 | 纯桩代码 | ❌ 无公开 API |

### 1.2 改动内容

#### 新增 `gequbao_lyric` 命令

**文件**: `crates/orange-tauri/src/commands.rs`

歌曲宝的歌词在详情页 `appData` JSON 的 `mp3_lrc` 字段里，原来只在 `enrich_track_detail` 中副带获取写入 `meta.lyrics`。新增独立歌词命令，统一返回 `{raw_lrc, translated_lrc}` 标准格式：

```rust
#[tauri::command]
pub async fn gequbao_lyric(
    state: tauri::State<'_, AppState>,
    song_path: String,
) -> Result<serde_json::Value, String> {
    // 调用 gequbao::enrich_track_detail 提取歌词
    // 返回 { raw_lrc, translated_lrc: null }
}
```

#### 歌词分发扩展

**文件**: `frontend/src/features/player/FullPlayer.tsx`、`ImmersiveView.tsx`、`lyric-overlay/LyricOverlay.tsx`

三个歌词消费点都扩展了 `source_kind` 分发，新增 `gequbao` 和 `spotify` 映射：

```ts
const cmd =
  kind === "netease_cloud_music" ? "netease_lyric"
  : kind === "qq_music" ? "qqmusic_lyric"
  : kind === "kugou" ? "kugou_lyric"
  : kind === "kuwo" ? "kuwo_lyric"
  : kind === "gequbao" ? "gequbao_lyric"
  : kind === "spotify" ? "spotify_lyric"  // 跨源匹配，传 title/artist
  : null;
```

Spotify 走跨源歌词匹配，参数从 `{songId}` 改为 `{title, artist}`。

#### 评论多源分发

**文件**: `frontend/src/features/player/CommentList.tsx`

原来 `CommentList` 硬编码 `netease_comments`，且有 `/^\d+$/` 正则守卫只接受纯数字 ID（QQ 的 `song_mid` 含字母会被过滤）。

改造后增加 `sourceKind?: string` prop，按音源分发评论命令：

```tsx
const cmd =
  sourceKind === "netease_cloud_music" ? "netease_comments"
  : sourceKind === "qq_music" ? "qqmusic_comments"
  : null;  // 其他音源暂不支持评论
```

`FullPlayer.tsx` 调用 `CommentList` 时传入 `sourceKind={sourceKind}`。

### 1.3 Spotify 跨源歌词匹配

**文件**: `crates/orange-tauri/src/commands.rs` — 新增 `spotify_lyric` 命令

Spotify 官方 Web API 已移除歌词端点（2022 年底），Client Credentials 也不足以访问内部 spclient 歌词端点。因此采用**跨源匹配**方案：

1. 用曲名+歌手在酷我搜索（曲库大，无需登录）
2. 取第一条结果的歌词
3. 酷我无结果则尝试网易云
4. 网易云无结果则尝试酷狗
5. 所有源都无结果则返回 `{raw_lrc: null}`

```rust
#[tauri::command]
pub async fn spotify_lyric(
    state: tauri::State<'_, AppState>,
    title: String,
    artist: String,
) -> Result<serde_json::Value, String> {
    // 构造关键词：曲名 + 歌手
    // 依次在酷我 → 网易云 → 酷狗搜索并取歌词
}
```

---

## 二、酷我音源增强

### 2.1 flac.music.hi.cn 备用镜像

**文件**: `crates/orange-sources/src/kuwo.rs`

flac.music.hi.cn 是对接酷我音乐接口的第三方站点，提供 FLAC 无损音质下载。由于项目已有完整的酷我音源，该站作为**取流末档回退**集成：

```
取流三档回退：
1. 主方案：playUrl JSON 接口（按音质选 br）
2. 回退 1：antiserver 302 重定向（免 cookie）
3. 回退 2：镜像站 flac.music.hi.cn（带 anti-cc JS 防护，尽力尝试）
```

#### anti-cc JS 防护处理

镜像站首页返回 JS 跳转页面（`anticc_redirect`），需解析 `cbk_var` 字符串拼接出 token URL：

```rust
fn parse_anticc_token(html: &str, base: &str) -> Option<String> {
    // 提取所有 cbk_var='...' 赋值中的字符串
    // 从右到左拼接（每次赋值都是 prepend）
    // 拼接出完整 URL
}
```

#### 镜像取流逻辑

```rust
async fn fetch_from_mirror(&self, rid: &str, quality: KuwoQuality) -> Result<String> {
    // 1. 请求播放接口
    // 2. 检查是否是 anti-cc 跳转页
    // 3. 如果是，解析 token 并带 cookie 重试
    // 4. 从响应中提取播放 URL
    // 5. 回退到下载页接口
}
```

### 2.2 FLAC 无损音质

新增 `KuwoQuality` 枚举，支持三档音质：

```rust
pub enum KuwoQuality {
    Standard,  // 128k mp3
    High,      // 320k mp3（默认）
    Lossless,  // 2000kflac
}
```

- `set_quality()` / `quality()` 方法切换音质
- `fetch_stream_url` 按音质选 `br` 参数
- 新增 `kuwo_set_quality` / `kuwo_get_quality` Tauri 命令
- 前端 `KuwoView.tsx` 增加音质选择 UI（标准/高品/无损 FLAC）

### 2.3 汽水音乐处理

汽水音乐（抖音系）无公开 API，web 端需要复杂的签名加密和设备指纹。将 `is_ready()` 改为返回 `false`，`search` 返回 `Unsupported` 错误，前端 `QishuiView` 展示"接口开发中"提示。

---

## 三、AI 音乐创作台增强

### 3.1 核心问题

| 问题 | 原因 | 解决方案 |
|---|---|---|
| 生成音乐不在播放详情页播放 | `studio_generate_music` 返回纯字符串，用独立 `<audio>` 播放，未构造 `Track` 推入队列 | 返回值增加 `track` 字段，前端推入 `playerStore` 队列 |
| 歌词无法和 AI 讨论修改 | 每次从零生成，无迭代修改能力 | 新增 `studio_revise_lyrics` 命令 + 聊天界面 |
| 歌词展示无分段预览 | 只有纯文本 textarea | 解析 `[Verse]/[Chorus]` 标签，按段落渲染卡片 |
| 分轨只有 2 个独立 `<audio>` | 无音量/静音/同步 | 新建 `MultiTrackPlayer` 组件，Web Audio API 混音 |
| 工程保存/加载是死代码 | 后端有命令，前端从未调用 | StudioView 工具栏增加保存/加载按钮 |

### 3.2 生成音乐接入主播放器

**后端** (`commands.rs`): `studio_generate_music` 返回值增加 `track` 字段：

```rust
let studio_track = Track::new(
    SourceId(uuid::Uuid::new_v4()),
    audio_path.clone(),  // source_track_id = 本地文件路径
    TrackMeta {
        title: track_title,
        artist: "OrangeStudio".into(),
        album: Some("AI 创作".into()),
        lyrics: final_lyrics.clone(),
        ..Default::default()
    },
);
// track.source_kind 默认为 Local
```

**前端** (`studioStore.ts`): `doGenerateMusic` 成功后存储 `generatedTrack`，`playInPlayer()` 方法推入播放队列：

```ts
playInPlayer: () => {
    const track = get().generatedTrack;
    const playerStore = usePlayerStore.getState();
    playerStore.setQueue([track]);
    playerStore.setCurrent(track, 0);
    playerStore.setView("player");
    playerStore.setFullPlayer(true);
}
```

**播放流程**: Studio 曲目 `source_kind = "local"`，`source_track_id = 文件路径`。App.tsx 取流分发默认分支 `playUrl = track.source_track_id`，`playPath` 调用 `toWebviewUrl` → `convertFileSrc` 把本地路径转成 `asset.localhost` URL。

### 3.3 歌词 AI 对话式修改

**后端** (`lyrics.rs`): 新增 `LyricsGenerator::revise()` 方法：

```rust
pub async fn revise(
    &self,
    current_lyrics: &str,
    instruction: &str,
) -> Result<(String, String)>  // (修改后歌词, AI说明)
```

- 接收当前歌词文本（MiniMax 格式）+ 用户自然语言修改指令
- system prompt 要求保持 `[Verse]/[Chorus]` 段落标签格式
- 返回修改后的完整歌词 + AI 简短说明

**Tauri 命令** (`commands.rs`): `studio_revise_lyrics` 无状态命令，每次传入当前歌词 + 修改指令。

**前端** (`StudioView.tsx`): 聊天界面：
- 对话历史存储在 `studioStore.chatHistory`
- 用户输入修改意见 → AI 返回修改后歌词 → 自动更新歌词编辑器 → 可继续修改
- 支持回车发送

### 3.4 歌词分段展示

**前端** (`StudioView.tsx`): `parseLyricSections()` 函数解析 MiniMax 格式歌词：

```ts
function parseLyricSections(text: string): { tag: string; lines: string[] }[] {
    // 匹配 [Verse] [Chorus] [Bridge] [Pre-Chorus] [Intro] [Outro] [Hook] 标签
    // 按段落拆分，每段含标签 + 歌词行数组
}
```

- 歌词编辑器左侧，分段预览右侧（可折叠）
- 段落标签显示中文（主歌/副歌/桥段等）
- 编辑 textarea → 实时更新分段预览

### 3.5 多轨播放器

**新文件**: `frontend/src/features/studio/MultiTrackPlayer.tsx`

基于 Web Audio API 的多轨同步播放器：

- 每个轨道一个 `<audio>` 元素 → `createMediaElementSource` → `GainNode`（控制音量）→ `destination`
- 统一播放/暂停/进度条（同步所有轨道的 `currentTime`）
- 每轨独立音量滑块 + 静音(M) + 独奏(S)按钮
- 静音/独奏逻辑：独奏时其他轨道音量设为 0

```tsx
// Web Audio API 连接
const source = ctx.createMediaElementSource(audio);
const gain = ctx.createGain();
source.connect(gain);
gain.connect(ctx.destination);
```

### 3.6 工程保存/加载

**前端** (`StudioView.tsx`): 顶部工具栏增加：
- 工程名输入框
- "保存"按钮 → 调用 `studio_project_save`，保存为 `.orp` 文件
- "加载"按钮 → 文件选择器 → `studio_project_load`
- "新建"按钮 → `reset()` 清空状态

工程数据包含：`name`、`prompt`、`lyrics`、`audio_path`、`stems`、`created_at`。

---

## 四、新增 Tauri 命令清单

| 命令 | 功能 | 所在文件 |
|---|---|---|
| `gequbao_lyric` | 歌曲宝歌词 | `commands.rs` |
| `kuwo_set_quality` | 设置酷我音质 | `commands.rs` |
| `kuwo_get_quality` | 获取酷我音质 | `commands.rs` |
| `spotify_lyric` | Spotify 跨源歌词匹配 | `commands.rs` |
| `studio_revise_lyrics` | AI 修改歌词 | `commands.rs` |

## 五、改动文件清单

### Rust 后端
- `crates/orange-sources/src/kuwo.rs` — 镜像回退 + 音质档位 + anti-cc 解析
- `crates/orange-sources/src/qishui.rs` — `is_ready()` 改为 false
- `crates/orange-sources/src/lib.rs` — 导出 `KuwoQuality`
- `crates/orange-studio/src/lyrics.rs` — 新增 `revise()` 方法
- `crates/orange-tauri/src/commands.rs` — 5 个新命令 + Track 构造
- `crates/orange-tauri/Cargo.toml` — 新增 uuid 依赖

### 前端
- `frontend/src/lib/studio.ts` — `track` 字段 + `reviseLyrics` 封装
- `frontend/src/stores/studioStore.ts` — 重写，增加对话/工程/播放器集成
- `frontend/src/features/studio/StudioView.tsx` — 重写，5 大新功能
- `frontend/src/features/studio/MultiTrackPlayer.tsx` — **新文件**
- `frontend/src/features/player/FullPlayer.tsx` — 歌词/评论多源分发
- `frontend/src/features/player/ImmersiveView.tsx` — 歌词分发扩展
- `frontend/src/features/player/CommentList.tsx` — 多源评论
- `frontend/src/features/player/KuwoView.tsx` — 音质选择 UI
- `frontend/src/features/player/QishuiView.tsx` — "开发中"提示
- `frontend/src/lyric-overlay/LyricOverlay.tsx` — 歌词分发扩展
- `frontend/src/styles/studio.css` — 新增工具栏/歌词区/对话/混音器样式

---

## 六、验证结果

- ✅ `cargo fmt --all` — 格式化通过
- ✅ `cargo clippy -p orange-sources -p orange-tauri -p orange-studio -- -D warnings` — 无警告
- ✅ `cargo build -p orangeradio-desktop` — 编译通过
- ✅ `npm run build` — 前端构建通过
- ✅ `npx tsc -b --noEmit` — TypeScript 类型检查通过

## 七、风险与限制

1. **anti-cc 绕过**：flac.music.hi.cn 的 JS 防护可能随站点更新变化，镜像回退是"尽力尝试"方案，失败不影响主流程
2. **Spotify 跨源歌词匹配精度**：依赖曲名+歌手搜索匹配，可能匹配到不同版本的歌词
3. **多轨同步精度**：Web Audio API 的多 `<audio>` 同步可能有 ±50ms 偏差，对试听用途可接受
4. **Studio 曲目持久性**：生成的 mp3 在 `{app_data_dir}/studio/` 目录，用户清理后收藏的 Track 会失效
5. **汽水音乐**：无可用接口，标注为"开发中"
