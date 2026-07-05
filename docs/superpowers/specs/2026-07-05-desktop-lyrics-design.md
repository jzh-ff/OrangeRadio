# 桌面歌词悬浮窗 · 设计

- **日期**:2026-07-05
- **状态**:Draft(待用户 review)
- **版本目标**:v0.4 沉浸式视觉 #6(桌面歌词,P1)

## 1. 背景与目标

v0.4 沉浸式视觉已完成 5/9,剩 P1×1(桌面歌词)+ P2×3。本设计实现 P1 的桌面歌词悬浮窗:在主应用之外提供一个**独立置顶**的悬浮窗,实时跟随播放显示歌词,让用户切到其他应用时也能看词。对标 Mineradio 的桌面歌词体验。

成功标准:网易云/QQ 歌曲播放时,悬浮窗双行显示当前歌词并跟随进度;可拖动、可锁定(鼠标穿透)、位置记忆;主窗口最小化时悬浮窗保留。

## 2. 范围

### 包含
- 独立 Tauri 悬浮窗(置顶、透明、无边框、可拖动、位置记忆)
- 双行卡拉 OK 样式(当前行高亮 + 下一行次亮,整行高亮,非逐字)
- 控件:播放/暂停、锁定(鼠标穿透)、关闭
- 网易云 + QQ 音乐歌词接入(顺带补 `FullPlayer` 未接的 QQ 歌词分支)
- 跨窗口状态同步(主窗口 → 悬浮窗 via Tauri event)
- 复用现有 `useLyrics` hook(LRC 解析 + 二分查找当前行)

### 不包含(非目标)
- 本地内嵌歌词提取(lofty 读 USLT/LRC 填 `TrackMeta.lyrics`)—— 独立后续任务,本设计只让本地曲目显示"暂无歌词"
- 全局快捷键(锁定态解锁的备选)—— 后续可加 `tauri-plugin-global-shortcut`
- 卡拉 OK **逐字**进度(逐字 LRC)—— 当前按整行高亮,逐字后续
- 歌词翻译切换 —— 沿用 `useLyrics` 现有翻译逻辑(若有则显示)

## 3. 架构

独立 Tauri 窗口 `label="lyric-overlay"`,与主窗口(`label="main"`)通过 Tauri event 双向通信。两个窗口加载同一个前端 bundle(`index.html`),由 `main.tsx` 按窗口 label 分流渲染。

```
主窗口 (main)                       悬浮窗 (lyric-overlay)
┌───────────────────────┐          ┌─────────────────────────┐
│ playerStore            │  emit    │ 本地 position 状态        │
│  - currentTrack        │ ───────► │  (setInterval 推进)       │
│  - position            │ lyric    │         │                │
│  - isPlaying           │ :state   │         ▼                │
│  - duration            │ (节流)   │ useLyrics → activeIndex   │
│                        │          │         │                │
│ WebviewWindow 管理      │ ◄─────── │         ▼                │
│ (创建/显示/隐藏/解锁)    │ listen   │ 双行渲染 + 控件           │
│                        │ lyric:cmd│                          │
│ PlayerBar 「桌面歌词」 │          │ 拉词:invoke lyric 命令     │
│   按钮(切锁定态)       │          │ (按 source_kind 分发)      │
└───────────────────────┘          └─────────────────────────┘
```

## 4. 组件

### 4.1 主窗口侧

- **`PlayerBar.tsx`(修改)**:底部播放栏加「桌面歌词」图标按钮
  - 首次点击:创建悬浮窗 + 显示
  - 再次点击:切换显示/隐藏(不销毁,保留位置)
  - 锁定态:按钮显示「已锁定·点此解锁」,点击 → `emit("lyric:cmd", {cmd:"unlock"})`
- **`useLyricBridge.ts`(新 hook,挂载在 App.tsx)**:订阅 `playerStore`,变化时 emit
  - `emit("lyric:state", {track, position, isPlaying, duration})`
  - `position` 节流 200ms;`track`/`isPlaying`/`duration` 变化立即 emit
  - `listen("lyric:cmd")` 执行 toggle(播放/暂停)/ close / unlock
- **`lib/lyricWindow.ts`(新)**:窗口管理工具,封装 `WebviewWindow` 调用
  - `openLyricOverlay()` / `toggleLyricOverlay()` / `closeLyricOverlay()` / `setLyricLock(bool)`

### 4.2 悬浮窗侧(新目录 `frontend/src/lyric-overlay/`)

- **`LyricOverlay.tsx`(新)**:根组件
  - mount 时 `listen("lyric:state")`,维护本地 `position`
  - 本地 `setInterval`(250ms)推进 `position`(仅 `isPlaying` 时前进 0.25s)
  - 收到新 `position` 校正(消除漂移)
  - `track` 变化时按 `source_kind` 拉歌词 → `useLyrics({lines, activeIndex})` → 渲染双行
  - 控件 `emit("lyric:cmd", {cmd:"toggle"|"close"})`
  - 拖动:歌词容器 `data-tauri-drag-region`;拖动结束记窗口位置到 localStorage
- **`LyricOverlay.css`(新)**:双行样式(当前行大字高亮、下一行次亮)、控件 hover 浮现、透明背景、描边/阴影保证深浅背景都可读

### 4.3 入口分流

- **`main.tsx`(修改)**:`getCurrentWebviewWindow().label === "lyric-overlay"` ? `<LyricOverlay/>` : `<App/>`
  - 避免悬浮窗加载整个主 App(性能 + 副作用)

## 5. 数据流

### 5.1 主 → 悬浮(状态推送)
- 事件名:`"lyric:state"`
- payload:`{ track: Track, position: number, isPlaying: boolean, duration: number }`
- 频率:`position` 节流 200ms;`track`/`isPlaying`/`duration` 变化时立即
- 实现:主窗口全局 `emit`(Tauri 2 默认广播到所有窗口);悬浮窗 `listen`

### 5.2 悬浮 → 主(控件命令)
- 事件名:`"lyric:cmd"`
- payload:`{ cmd: "toggle" | "close" | "unlock" }`
- 主窗口 `useLyricBridge` `listen` 执行

### 5.3 歌词拉取(悬浮窗自主)
- `track` 变化时,按 `track.source_kind`:
  - `netease_cloud_music` → `invoke("netease_lyric", { songId: track.source_track_id })`
  - `qq_music` → `invoke("qqmusic_lyric", { songId: track.source_track_id })`
  - 其他(`local`/`web_radio`/`podcast`/`spotify`)→ 显示"暂无歌词"
- 拿到 `{raw_lrc, translated_lrc}` → `useLyrics` 解析

### 5.4 position 本地推进(悬浮窗)
- 收到 `position` 后,本地 `setInterval` 每 250ms 前进 0.25s(仅 `isPlaying`)
- 收到新 `position` 时校正到主窗口真值(消除漂移)
- 主窗口 emit 断流 >3s:本地继续推进,歌词不卡

## 6. 窗口配置

运行时 `WebviewWindow` 构造(`lib/lyricWindow.ts`),不写死在 `tauri.conf.json`(便于动态控制显隐与位置):

```ts
new WebviewWindow("lyric-overlay", {
  // url 省略 → 默认加载应用入口(dev: devUrl localhost:1420，prod: frontendDist)
  // 复用主 bundle，由 main.tsx 按 window label 分流渲染
  width: 900, height: 140,
  decorations: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  x, y,                          // localStorage 记忆 / 默认屏幕底部居中
});
```

> ⚠️ 已知坑:`transparent: true` 在 **Windows dev 模式下可能不生效**(Tauri/WebView2 限制),如遇边框残影回退为「半透明纯色背景」(body 用 `rgba(0,0,0,0.4)` 等)。prod 构建通常正常。

## 7. 锁定实现(鼠标穿透)

- **锁定**:`getCurrentWindow().setIgnoreCursorEvents(true)` —— 整窗鼠标事件穿透到下层应用
- **解锁**:锁定后悬浮窗自身不接收点击,通过**主窗口的「桌面歌词」按钮**解锁(锁定态按钮显示「已锁定·点此解锁」)
- 锁定态可选持久化到 localStorage(下次开窗保持锁定)

## 8. 权限

`apps/desktop/src-tauri/capabilities/default.json`:
- `windows: ["main", "lyric-overlay"]`(从 `["main"]` 扩展)
- 补 `permissions`:
  - `core:webview:allow-create-webview-window`(创建悬浮窗)
  - `core:window:allow-set-ignore-cursor-events`(锁定穿透)
  - `core:window:allow-set-position` / `set-size` / `show` / `hide` / `close` / `set-focus`
  - `core:window:allow-start-dragging`(拖动)

## 9. 错误处理 / 边界

| 场景 | 处理 |
|------|------|
| 拉词失败 / 无词 | 显示"暂无歌词" |
| 主窗口 emit 断流 >3s | 悬浮窗本地 setInterval 继续推进 position |
| 悬浮窗创建失败 | 主窗口 toast 提示「桌面歌词启动失败」 |
| 窗口位置越界(分辨率/显示器变更) | 检测并回默认屏幕底部居中 |
| 最小化主窗口 | 悬浮窗保留(桌面歌词意义所在) |
| 关闭主窗口 | 退出应用,悬浮窗随之销毁 |

## 10. 测试

手动端到端:
- 网易云切歌 → 歌词跟随
- QQ 切歌 → 歌词跟随(验证新接入的 QQ 歌词)
- 拖动进度条 → `activeIndex` 跳转正确
- 拖动悬浮窗位置 → 刷新应用后位置记忆
- 锁定 → 鼠标穿透(能点中歌词下方的桌面图标);主窗口按钮解锁
- 最小化主窗口 → 悬浮窗仍在
- 关主窗口 → 悬浮窗一起关
- 本地曲目 → 显示"暂无歌词"

合并门槛:`npm run build` + `cargo build -p orangeradio-desktop` 双绿。

## 11. 关键文件

**新增**:
- `frontend/src/lyric-overlay/LyricOverlay.tsx`
- `frontend/src/lyric-overlay/LyricOverlay.css`
- `frontend/src/features/player/useLyricBridge.ts`
- `frontend/src/lib/lyricWindow.ts`

**修改**:
- `frontend/src/main.tsx`(窗口 label 分流)
- `frontend/src/features/player/PlayerBar.tsx`(「桌面歌词」按钮 + 锁定态切换)
- `frontend/src/features/player/FullPlayer.tsx`(顺带补 QQ 歌词分支,与悬浮窗共用拉词逻辑)
- `apps/desktop/src-tauri/capabilities/default.json`(权限 + windows 扩展)

## 12. 复用与依赖

- **复用**:`useLyrics` hook(`frontend/src/features/player/useLyrics.ts`)、`netease_lyric` / `qqmusic_lyric` 命令、`playerStore` 字段
- **新依赖**:无(`@tauri-apps/api` 已含 `WebviewWindow` / `getCurrentWindow` / event API)
