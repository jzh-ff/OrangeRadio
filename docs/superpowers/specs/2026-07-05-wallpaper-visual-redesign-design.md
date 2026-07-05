# 壁纸视觉重构 — 前景透明 + 各 tab 共用全局壁纸 设计文档

- **日期**:2026-07-05
- **状态**:设计草案,待用户审阅 → 转 writing-plans
- **范围**:让全局壁纸真正可见(前景组件可调透明)+ 全屏播放页各 tab(除 cinema)共用全局壁纸
- **关联**:`frontend/src/visual/WallpaperLayer.tsx`(全局壁纸层,已就位)、`frontend/src/styles/glass.css`、`frontend/src/features/player/FullPlayer.tsx`、`frontend/src/features/player/VisualConsole.tsx`、`frontend/src/stores/playerStore.ts`

---

## 1. 背景

壁纸层 `WallpaperLayer` **已经是全局的**(App 根 z-index 0,`App.tsx:252`)—— 这点不用改。问题在两层:

1. **前景挡住壁纸**:侧栏 / 底部播放栏 / 主视图 / 全屏播放页都用 `.glass` 玻璃态背景(`backdrop-filter: blur` + 不透明的 `--glass-bg`),把壁纸盖住了。
2. **现有透明度参数只管壁纸自身**:`visualParams.wallpaperOpacity` 控制的是 `WallpaperLayer` 的透明度,没有"前景组件透明度"。
3. **全屏页各 tab 自带背景**:`cinema` tab 用粒子(`fp-particles-bg`),其他 tab 用 `fp-blur-bg`(基于 accent 色的模糊背景),都不接全局壁纸层。

用户反馈:「背景壁纸应该是全局的,包括侧边栏」「壁纸要能看见」「所有组件的透明度应该可以调整」「播放详情里除了电影 tab,其他壁纸背景都应该一致」。

## 2. 目标 / 非目标

### 目标
1. 4 个前景组件(侧栏 / 底栏 / 主视图 / 全屏页)**各自**有透明度滑块,调低时壁纸透出
2. 全屏页非 `cinema` tab 去掉自带背景,接全局壁纸层
3. 滑块在 `VisualConsole`(复用现有 `Slider`),`visualParams` 持久化(重启保留)

### 非目标(YAGNI)
- 改壁纸层本身(z0 全局已对)
- `cinema` tab 的粒子背景(保留,用户明确例外)
- TitleBar 顶栏透明(用户未选,保持现状)
- 新增壁纸来源(WE 扫描 / 收藏已实现)

## 3. 设计

### 3.1 分组件透明度(4 滑块)

**`VisualParams` 接口加 4 字段**(`frontend/src/stores/playerStore.ts`):
```ts
sidebarOpacity: number;     // 侧栏
playerBarOpacity: number;   // 底部播放栏
mainOpacity: number;        // 主视图 app__main
fullPlayerOpacity: number;  // 全屏播放页(非 cinema)
// 默认:0.8 / 0.8 / 0.8 / 0.85(fullPlayer 略高,歌词可读性)
```
`loadVisualParams` 已是 `{ ...defaults, ...parsed }` merge,新字段自动兼容旧 localStorage。

**CSS 变量传递**:
- 各组件**根容器**读自己的 opacity,设 inline CSS 变量:`style={{ "--ui-opacity": opacity } as React.CSSProperties}`(TS 严格模式禁 `any`,自定义 CSS 属性用类型断言;或全局扩展 `CSSProperties`)
- `.glass` 的 `background` alpha 改用 `var(--ui-opacity, 0.8)`(CSS 变量继承:容器设值 → 子 `.glass` 自动跟随)
- 当前 `.glass { background: var(--glass-bg); }`(固定 alpha)→ 改为分离颜色与 alpha:
  - 在 `:root`(global.css)定义 `--glass-rgb: 20, 22, 30;`(从现有 `--glass-bg` 提取的 rgb)
  - `.glass { background: rgba(var(--glass-rgb), var(--ui-opacity, 0.8)); }`
  - `backdrop-filter` 保留(模糊让前景内容在透明时仍可读)

**4 个组件容器**(挂 `--ui-opacity`):
- `Sidebar` 根 `<aside>`
- `PlayerBar` 根 `<footer>`/`<div>`
- `App.tsx` 的 `<main className="app__main">`(从 store 读 mainOpacity 设变量)
- `FullPlayer` 根容器(读 fullPlayerOpacity)

### 3.2 各 tab 一致(非 cinema 接全局壁纸)

`FullPlayer.tsx`:
- `fullLayout !== "cinema"` 分支:删除 `<div className="fp-blur-bg" style={accentStyle} />`(那个 accent 模糊背景)
- `cinema` 分支:保留 `fp-particles-bg`(粒子,用户明确例外)
- `FullPlayer` 根容器变透明(背景由 3.1 的 `--ui-opacity` 控制),让 App 根的 `WallpaperLayer` 透出

### 3.3 滑块 UI(`VisualConsole`)

在 VisualConsole 现有壁纸/视觉参数区,加 4 个 `Slider`(复用组件,与 `wallpaperOpacity`/`bloom` 等并列):
- 侧栏透明(0–1,step 0.05)
- 底栏透明
- 主视图透明
- 全屏页透明

每个滑块 `onChange` → `setVisualParams({ sidebarOpacity: v })`。

## 4. 数据流

```
[VisualConsole 滑块]
  ↓ setVisualParams({ sidebarOpacity: 0.5 })
[playerStore.visualParams 更新 + localStorage 持久化]
  ↓ 各组件 usePlayerStore(s => s.visualParams.sidebarOpacity)
[组件根容器设 --ui-opacity: 0.5]
  ↓ CSS 变量继承
[.glass background: rgba(var(--glass-rgb), 0.5)]
  ↓ 壁纸层(App 根 z0)透出
```

全屏页:`FullPlayer` 非 cinema tab 去 `fp-blur-bg` + 容器透明 → App 根 `WallpaperLayer` 透出。

## 5. 实现落点(文件)

| 文件 | 改动 |
|------|------|
| `frontend/src/stores/playerStore.ts` | `VisualParams` 加 4 字段 + 默认值 |
| `frontend/src/components/Sidebar.tsx` | 根容器读 sidebarOpacity,设 `--ui-opacity` |
| `frontend/src/features/player/PlayerBar.tsx` | 根容器读 playerBarOpacity,设 `--ui-opacity` |
| `frontend/src/App.tsx` | `<main className="app__main">` 读 mainOpacity,设 `--ui-opacity` |
| `frontend/src/features/player/FullPlayer.tsx` | 根容器读 fullPlayerOpacity 设 `--ui-opacity`;非 cinema tab 删 `fp-blur-bg` |
| `frontend/src/styles/glass.css` | `.glass` background 改 `rgba(var(--glass-rgb), var(--ui-opacity, 0.8))` |
| `frontend/src/styles/global.css`(或 :root 定义处) | 加 `--glass-rgb: 20, 22, 30;` |
| `frontend/src/features/player/VisualConsole.tsx` | 加 4 个透明度 `Slider` |

## 6. 测试

项目无前端测试框架,验证靠:
- `cd frontend && npx tsc -b --noEmit` 无错误
- `cd frontend && npm run build` 通过
- **手动验收**(`.\run.ps1`):
  - 设一张壁纸为背景
  - VisualConsole 调「侧栏透明」→ 侧栏变透明,壁纸从左侧透出(实时)
  - 同理验证底栏 / 主视图 / 全屏页 4 个滑块各自生效
  - 重启应用 → 透明度保持(localStorage 持久化)
  - 全屏页切到「沉浸」/「歌词」tab → 看到全局壁纸(非 accent 模糊);切「电影」→ 仍粒子

## 7. 风险与权衡

- **可读性**:透明度调太低,前景文字在壁纸上可能难读。靠 `backdrop-filter: blur` + 默认 0.8 兜底;用户可按壁纸调。
- **CSS 变量继承**:容器设 `--ui-opacity`,必须确保 `.glass` 在该容器**子树**内(继承链)。若某组件的 `.glass` 不在挂变量的容器内,需在该 `.glass` 自身或更近祖先挂变量。实现时逐一核对。
- **`.glass` 改动影响面**:`.glass` 是通用类(Sidebar/PlayerBar/HomeView 卡片/VisualConsole 都用)。改其 background alpha 计算方式,所有 `.glass` 都跟随各自容器的 `--ui-opacity`(无变量则用默认 0.8,行为不变)。需确认无破坏。

## 8. 未来扩展(本期不做)
- 全局一个"UI 透明度"主滑块(一键调所有)+ 组件级覆盖
- 壁纸亮度/暗角随前景透明度联动(自动保证可读)
- TitleBar 也透明(用户未选)
