import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

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

try {
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
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
