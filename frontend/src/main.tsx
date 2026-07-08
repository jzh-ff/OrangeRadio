import React from "react";
import ReactDOM from "react-dom/client";
import { useState } from "react";
import App from "./App";
import { LyricOverlay } from "./lyric-overlay/LyricOverlay";
import { Splash } from "./features/player/Splash";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./styles/global.css";
import "./styles/glass.css";

// ErrorBoundary：捕获 React 渲染错误并显示
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[OrangeRadio 渲染错误]", error);
  }
  render() {
    if (this.state.error) {
      const box = document.getElementById("boot-error");
      if (box) {
        box.style.display = "block";
        box.textContent =
          "[渲染错误] " +
          (this.state.error.stack || this.state.error.message);
      }
      return null;
    }
    return this.props.children;
  }
}

// 按窗口 label 分流：lyric-overlay 窗口只渲染悬浮歌词，其余渲染主 App。
// 非 Tauri 环境（纯浏览器调试）走主 App。
let windowLabel = "main";
try {
  windowLabel = getCurrentWebviewWindow().label;
} catch {
  windowLabel = "main";
}

// lyric-overlay 窗口：去掉 #root 的"卡片化"背景/圆角/阴影,
// 否则 global.css 给主窗口加的 #root { background: var(--bg-0); border-radius: 34px; clip-path; box-shadow }
// 会被这个窗口继承,导致悬浮窗背景是深色实心,无法透出桌面。
if (windowLabel === "lyric-overlay") {
  document.body.classList.add("window-lyric-overlay");
}

// 主窗口入口：App 始终挂载，Splash 叠在上层淡出（淡出过程露出 App，视觉连续）
function AppEntry() {
  const [entered, setEntered] = useState(false);
  return (
    <>
      <App />
      {!entered && <Splash onEnter={() => setEntered(true)} />}
    </>
  );
}

try {
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        {windowLabel === "lyric-overlay" ? <LyricOverlay /> : <AppEntry />}
      </ErrorBoundary>
    </React.StrictMode>
  );
} catch (e) {
  const box = document.getElementById("boot-error");
  if (box) {
    box.style.display = "block";
    box.textContent =
      "[启动失败] " + (e instanceof Error ? e.stack || e.message : String(e));
  }
}
