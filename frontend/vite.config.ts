import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 期望前端构建产物在 ../apps/desktop/src-tauri 对应的 dist 目录
// 这里把前端源码放在 frontend/，devServer 供 Tauri 调用
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 不监听 Rust 端变化
      ignored: ["**/src-tauri/**", "**/crates/**", "**/server/**"],
    },
  },
  // Tauri 2: production 用相对路径，dev 用 devUrl（不显式设 base，让 Tauri 处理）
  // 注意：不设 base 时 vite 默认 "/"，构建出的 index.html 用绝对路径 /assets/...
  // 在 Tauri 的 http://tauri.localhost/ 下可正常工作
  build: {
    // 产物输出到 desktop 应用的 dist 目录
    outDir: "../apps/desktop/dist",
    emptyOutDir: true,
    target: "esnext",
  },
});
