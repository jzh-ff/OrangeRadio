# 壁纸视觉重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让全局壁纸真正可见 —— 4 个前景组件(侧栏/底栏/主视图/全屏页)各自透明度可调,全屏页非 cinema tab 共用全局壁纸。

**Architecture:** `visualParams` 加 4 个透明度字段 → 各组件根容器设 inline CSS 变量 `--ui-opacity` → 各 CSS 根选择器的 `background` alpha 用 `var(--ui-opacity, 默认)`(渐变 stop / 单色统一跟随)→ VisualConsole 加 4 滑块实时调。

**Tech Stack:** React 18 + TypeScript 严格模式 + Zustand(playerStore.visualParams)+ 纯 CSS 变量

## Global Constraints

> 摘自 spec + 项目约束,每个任务默认遵守。

- **严格 TS 禁 `any`**:自定义 CSS 属性用类型断言 `as React.CSSProperties`(或 import `CSSProperties`),不要 `as any`
- **CSS 文件与组件同目录同命名**(本项目约定)
- **状态走 Zustand store**:`visualParams` 持久化(localStorage `orangeradio_visual_params`,`loadVisualParams` 用 `{ ...def, ...parsed }` merge,新字段自动兼容旧数据)
- **`npm run build` = `tsc -b && vite build`,别拆开跑**
- **前端无单测框架**:每个任务验证靠 `npx tsc -b --noEmit` + `npm run build`;最后手动验收
- **中文注释 OK,代码标识符英文**;Conventional Commits(`feat(frontend): ...`)

## File Structure

| 文件 | 责任 | 改动 |
|------|------|------|
| `frontend/src/stores/playerStore.ts` | `VisualParams` 接口 + 默认值 | 加 4 字段 + 默认 |
| `frontend/src/styles/global.css` | `:root` CSS 变量 | 加 `--glass-rgb` |
| `frontend/src/styles/sidebar.css` | `.sidebar` 背景 | 渐变 stop alpha 用 `var(--ui-opacity)` |
| `frontend/src/styles/player-bar.css` | `.playerbar` 背景 | `var(--glass-bg)` → 单色 + `var(--ui-opacity)` |
| `frontend/src/styles/full-player.css` | `.fp-overlay` 背景 | `rgba(3,4,9,0.94)` → alpha 用 `var(--ui-opacity)` |
| `frontend/src/styles/app.css` | `.app__main` | 加半透明 background(alpha 用变量) |
| `frontend/src/components/Sidebar.tsx` | 根 `<aside>` | 读 sidebarOpacity,设 `--ui-opacity` |
| `frontend/src/features/player/PlayerBar.tsx` | 根 `<div className="playerbar">` | 读 playerBarOpacity,设 `--ui-opacity` |
| `frontend/src/App.tsx` | `<main className="app__main">` | 读 mainOpacity,设 `--ui-opacity` |
| `frontend/src/features/player/FullPlayer.tsx` | 根 `<div className="fp-overlay">` + fp-blur-bg | 读 fullPlayerOpacity 设变量;非 cinema 删 fp-blur-bg |
| `frontend/src/features/player/VisualConsole.tsx` | 4 个透明度 `Slider` | 加 4 滑块 |

---

## Task 1: playerStore VisualParams 加 4 透明度字段

**Files:**
- Modify: `frontend/src/stores/playerStore.ts`(VisualParams 接口 ~line 101 + def ~line 134)

**Interfaces:**
- Produces:`visualParams.sidebarOpacity` / `playerBarOpacity` / `mainOpacity` / `fullPlayerOpacity`(number,0–1)。Task 3/5 依赖。

- [ ] **Step 1: 接口加字段**

在 `VisualParams` 接口末尾(`wallpaperDim: number;` 之后,`}` 之前)追加:

```ts
  // ===== 前景组件透明度（壁纸视觉重构）=====
  /** 侧栏透明度（0-1，调低让全局壁纸透出） */
  sidebarOpacity: number;
  /** 底部播放栏透明度 */
  playerBarOpacity: number;
  /** 主视图透明度 */
  mainOpacity: number;
  /** 全屏播放页透明度（非 cinema tab；略高保歌词可读） */
  fullPlayerOpacity: number;
```

- [ ] **Step 2: 默认值加字段**

在 `loadVisualParams` 的 `def` 对象末尾(`wallpaperDim: 0.3,` 之后,`};` 之前)追加:

```ts
    sidebarOpacity: 0.8,
    playerBarOpacity: 0.8,
    mainOpacity: 0.8,
    fullPlayerOpacity: 0.85,
```

> `loadVisualParams` 的 `return { ...def, ...JSON.parse(raw) }` 自动 merge,旧 localStorage 缺这些字段时取默认,无需额外兼容代码。

- [ ] **Step 3: 类型检查**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 无错误(新字段有默认,merge 兼容)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/playerStore.ts
git commit -m "feat(frontend): VisualParams 加 4 个前景透明度字段"
```

---

## Task 2: CSS 变量 + 各容器背景 alpha 用 var(--ui-opacity)

**Files:**
- Modify: `frontend/src/styles/global.css`(`:root` ~line 72)
- Modify: `frontend/src/styles/sidebar.css`(`.sidebar` background ~line 13)
- Modify: `frontend/src/styles/player-bar.css`(`.playerbar` background ~line 12)
- Modify: `frontend/src/styles/full-player.css`(`.fp-overlay` background ~line 8)
- Modify: `frontend/src/styles/app.css`(`.app__main` ~line 59)

**Interfaces:**
- Consumes: 无(纯 CSS)
- Produces:`--glass-rgb` 变量(供 player-bar/app.css 用);各容器 background alpha 跟随各自容器的 `--ui-opacity`(Task 3 在容器设值)

**机制**:CSS 变量继承 —— 组件根容器(Task 3)设 `--ui-opacity: 0.8`,该容器内的 `.sidebar`/`.playerbar`/`.fp-overlay`/`.app__main` 的 background alpha 用 `var(--ui-opacity, <默认>)` 自动跟随。

- [ ] **Step 1: global.css 加 `--glass-rgb`**

在 `:root` 块里 `--glass-bg:` 那一行附近(line 72 前后)加一行:

```css
  --glass-rgb: 24, 27, 30;
```

> 从现有 `--glass-bg` 渐变中间色提取的 rgb(供单色玻璃用)。

- [ ] **Step 2: sidebar.css 渐变 stop alpha 用变量**

把 `.sidebar` 的 `background:`(`sidebar.css:13-15`,当前):

```css
  background:
    radial-gradient(circle at 0% 0%, rgba(255, 107, 26, 0.06), transparent 40%),
    linear-gradient(168deg, rgba(14, 16, 28, 0.97) 0%, rgba(4, 5, 10, 0.92) 100%);
```

改为(两个 linear-gradient stop 的 alpha 换成变量;radial 那层是橙色装饰光斑,保持):

```css
  background:
    radial-gradient(circle at 0% 0%, rgba(255, 107, 26, 0.06), transparent 40%),
    linear-gradient(168deg, rgba(14, 16, 28, var(--ui-opacity, 0.8)) 0%, rgba(4, 5, 10, var(--ui-opacity, 0.8)) 100%);
```

- [ ] **Step 3: player-bar.css 单色玻璃 + 变量**

把 `.playerbar` 的 `background: var(--glass-bg);`(`player-bar.css:12`)改为:

```css
  background: rgba(var(--glass-rgb), var(--ui-opacity, 0.8));
```

> 原 `var(--glass-bg)` 是不透明渐变,会挡壁纸。改单色 + alpha 变量。`backdrop-filter`(下一行)保留,玻璃模糊感不丢。

- [ ] **Step 4: full-player.css alpha 用变量**

把 `.fp-overlay` 的 `background: rgba(3, 4, 9, 0.94);`(`full-player.css:8`)改为:

```css
  background: rgba(3, 4, 9, var(--ui-opacity, 0.85));
```

- [ ] **Step 5: app.css .app__main 加半透明背景**

`.app__main`(`app.css:59-64`)当前无 background。在块内加一行(让主视图区有可调半透明覆盖,壁纸透出但内容可读):

```css
.app__main {
  flex: 1;
  overflow-y: auto;
  padding: 30px 38px 118px;
  scroll-behavior: smooth;
  background: rgba(var(--glass-rgb), var(--ui-opacity, 0.8));
}
```

- [ ] **Step 6: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建通过(CSS 改动不影响 tsc;vite build 不报错)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/styles/global.css frontend/src/styles/sidebar.css frontend/src/styles/player-bar.css frontend/src/styles/full-player.css frontend/src/styles/app.css
git commit -m "feat(frontend): 各前景容器背景 alpha 用 --ui-opacity 变量控制"
```

---

## Task 3: 4 个组件根容器读 store + 设 --ui-opacity

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`(`<aside>` ~line 112)
- Modify: `frontend/src/features/player/PlayerBar.tsx`(`<div className="playerbar">` ~line 89)
- Modify: `frontend/src/App.tsx`(`<main className="app__main">` ~line 255)
- Modify: `frontend/src/features/player/FullPlayer.tsx`(`<div className="fp-overlay">` ~line 212)

**Interfaces:**
- Consumes: Task 1 的 `visualParams.sidebarOpacity` 等
- Produces: 各根容器 inline `style={{ "--ui-opacity": <opacity> }}`,驱动 Task 2 的 CSS。

**机制**:每个组件用 `usePlayerStore` 读自己的 opacity,通过 inline style 设 `--ui-opacity`(CSS 变量继承到该容器所有 background)。TS 严格模式:自定义 CSS 属性需 `as React.CSSProperties`(禁 `any`)。

- [ ] **Step 1: Sidebar 设 sidebarOpacity**

`Sidebar.tsx` 顶部已 `import { usePlayerStore }`(line 3)。在组件函数体里(其他 `usePlayerStore` 调用附近)加:

```ts
  const sidebarOpacity = usePlayerStore((s) => s.visualParams.sidebarOpacity);
```

把根 `<aside className={\`sidebar ${isPlaying ? "sidebar--live" : ""}\`}>`(line 112)改为加 style:

```tsx
    <aside
      className={`sidebar ${isPlaying ? "sidebar--live" : ""}`}
      style={{ "--ui-opacity": sidebarOpacity } as React.CSSProperties}
    >
```

> 若 `React` 未在该文件作用域内,用 `import type { CSSProperties } from "react"` 然后 `as CSSProperties`。

- [ ] **Step 2: PlayerBar 设 playerBarOpacity**

`PlayerBar.tsx` 已 `import { usePlayerStore ... }`(line 1)。组件函数体加:

```ts
  const playerBarOpacity = usePlayerStore((s) => s.visualParams.playerBarOpacity);
```

把根 `<div className={\`playerbar ${currentTrack ? "playerbar--visible" : ""}\`}>`(line 89)改为:

```tsx
    <div
      className={`playerbar ${currentTrack ? "playerbar--visible" : ""}`}
      style={{ "--ui-opacity": playerBarOpacity } as React.CSSProperties}
    >
```

- [ ] **Step 3: App.tsx 的 app__main 设 mainOpacity**

`App.tsx` 已用 `usePlayerStore`(参考现有用法)。在 App 组件函数体加:

```ts
  const mainOpacity = usePlayerStore((s) => s.visualParams.mainOpacity);
```

把 `<main className="app__main">`(line 255)改为:

```tsx
        <main
          className="app__main"
          style={{ "--ui-opacity": mainOpacity } as React.CSSProperties}
        >
```

- [ ] **Step 4: FullPlayer 设 fullPlayerOpacity**

`FullPlayer.tsx` 已 `import { usePlayerStore ... }`(line 3)。组件函数体加:

```ts
  const fullPlayerOpacity = usePlayerStore((s) => s.visualParams.fullPlayerOpacity);
```

把根 `<div className={\`fp-overlay fp-overlay--editorial fp-overlay--${fullLayout}\`}>`(line 212)改为:

```tsx
    <div
      className={`fp-overlay fp-overlay--editorial fp-overlay--${fullLayout}`}
      style={{ "--ui-opacity": fullPlayerOpacity } as React.CSSProperties }
    >
```

- [ ] **Step 5: 类型检查 + 构建**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 无错误(若 `React.CSSProperties` 报 React 未定义,改 `import type { CSSProperties } from "react"` + `as CSSProperties`)

Run: `cd frontend && npm run build`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/features/player/PlayerBar.tsx frontend/src/App.tsx frontend/src/features/player/FullPlayer.tsx
git commit -m "feat(frontend): 4 组件根容器设 --ui-opacity 驱动背景透明"
```

---

## Task 4: FullPlayer 非 cinema tab 去 fp-blur-bg(接全局壁纸)

**Files:**
- Modify: `frontend/src/features/player/FullPlayer.tsx`(fp-blur-bg 块 ~line 222)

**Interfaces:**
- Consumes: 无
- Produces: 非 cinema tab 不再有 accent 模糊背景 → `.fp-overlay` 的半透明 background(Task 2/3)让 App 根 `WallpaperLayer` 透出。

- [ ] **Step 1: 删除 fp-blur-bg 块**

`FullPlayer.tsx` 里找到这段(`fullLayout !== "cinema"` 分支的模糊背景,line 222 附近):

```tsx
      {fullLayout !== "cinema" && (
        <div className="fp-blur-bg" style={accentStyle} />
      )}
```

**整段删除**。

> cinema 分支的 `fp-particles-bg`(粒子背景)保留不动 —— 用户明确"电影 tab 例外"。
> `accentStyle` 变量若删除后变成未使用,tsc 会报 unused —— 把它的声明也删掉(搜 `const accentStyle` 或 `accentStyle =`,整行删除)。

- [ ] **Step 2: 类型检查 + 构建**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 无错误(若报 `accentStyle` unused,删其声明)

Run: `cd frontend && npm run build`
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/player/FullPlayer.tsx
git commit -m "feat(frontend): FullPlayer 非 cinema tab 去自带背景,接全局壁纸"
```

---

## Task 5: VisualConsole 加 4 个透明度滑块

**Files:**
- Modify: `frontend/src/features/player/VisualConsole.tsx`(壁纸区 ~line 247)

**Interfaces:**
- Consumes: Task 1 的 `visualParams.*Opacity` + 现有 `Slider` 组件(`VisualConsole.tsx:293`,签名 `{ label, value, min, max, step, onChange, fmt? }`)+ 现有 `setVisualParams`

- [ ] **Step 1: 加 4 个 Slider**

在 VisualConsole 的"壁纸"区附近(line 247 `<div className="vc-section__title vc-section__title--sub">壁纸</div>` 之前,即"界面与背景"区里)加一个"前景透明度"子区:

```tsx
            <div className="vc-section__title vc-section__title--sub">前景透明度</div>
            <Slider label="侧栏" value={visualParams.sidebarOpacity} min={0} max={1} step={0.05}
              onChange={(v) => setVisualParams({ sidebarOpacity: v })} />
            <Slider label="底栏" value={visualParams.playerBarOpacity} min={0} max={1} step={0.05}
              onChange={(v) => setVisualParams({ playerBarOpacity: v })} />
            <Slider label="主视图" value={visualParams.mainOpacity} min={0} max={1} step={0.05}
              onChange={(v) => setVisualParams({ mainOpacity: v })} />
            <Slider label="全屏页" value={visualParams.fullPlayerOpacity} min={0} max={1} step={0.05}
              onChange={(v) => setVisualParams({ fullPlayerOpacity: v })} />
```

> 插在"界面与背景"区(`tab === "visual"` 分支内,line 240 那个 `vc-section__title--sub` 之后、`壁纸` 子区之前)。`Slider` 与 `setVisualParams` 在该作用域已存在。

- [ ] **Step 2: 类型检查 + 构建**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: 无错误

Run: `cd frontend && npm run build`
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/player/VisualConsole.tsx
git commit -m "feat(frontend): VisualConsole 加 4 个前景透明度滑块"
```

---

## Task 6: 手动验收

**Files:** 无(运行应用验收)

- [ ] **Step 1: 双绿**

Run: `cd frontend && npx tsc -b --noEmit && npm run build`
Expected: 全过

- [ ] **Step 2: 启动应用**

Run: `.\run.ps1`

- [ ] **Step 3: 验收清单**

先设一张壁纸为背景(壁纸库选一张),然后:

- [ ] 打开 VisualConsole → "界面与背景" → 看到「前景透明度」4 滑块(侧栏/底栏/主视图/全屏页)
- [ ] 调「侧栏」→ 侧栏实时变透明,壁纸从左侧透出
- [ ] 调「底栏」→ 底部播放栏透明,壁纸透出
- [ ] 调「主视图」→ 主内容区透明,壁纸透出
- [ ] 调「全屏页」→ 全屏播放页(沉浸/歌词 tab)透明,壁纸透出
- [ ] 重启应用 → 4 个透明度保持(localStorage 持久化)
- [ ] 全屏页切「沉浸」/「歌词」tab → 看到全局壁纸(不再 accent 模糊)
- [ ] 切「电影」tab → 仍粒子背景(例外保留)
- [ ] 壁纸在所有透明区域可见(全局铺满)

- [ ] **Step 4: 验收通过,无需 commit(本任务无代码改动)**

---

## Definition of Done

- `npx tsc -b --noEmit` + `npm run build` 双绿
- 验收清单(Task 6 Step 3)全过
- Conventional Commits,新分支或延续 `feat/wallpaper-engine-scanner`

## Self-Review 记录

(规划阶段已对照 spec 逐节核对:Task 1=visualParams 字段、Task 2=CSS 变量机制、Task 3=容器设变量、Task 4=各 tab 一致(去 fp-blur-bg)、Task 5=滑块 UI、Task 6=验收。类型签名跨任务一致(sidebarOpacity 等命名),无 TBD/占位。实现者执行时按 checkbox 跟踪。)
