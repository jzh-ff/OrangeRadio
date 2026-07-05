/**
 * 把后端返回的播放源/文件 URL 转成 webview 实际能加载的 URL。
 *
 * 三种情况:
 * 1. http(s):// 直链 —— 原样返回。
 * 2. 自定义协议 <scheme>://localhost/... (orangeradio:// 用于 QQ 流 / Wallpaper Engine 文件)——
 *    Tauri 2 在 Windows/Android 路由成 http://<scheme>.localhost/...。
 * 3. 本地文件路径 —— convertFileSrc(asset 协议)。
 */
import { convertFileSrc } from "@tauri-apps/api/core";

export function toWebviewUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const m = raw.match(/^([a-z][a-z0-9+.-]*):\/\/localhost\//i);
  if (m) {
    const scheme = m[1].toLowerCase();
    const rest = raw.slice(m[0].length);
    const isWinLike =
      navigator.userAgent.includes("Windows") || /Android/i.test(navigator.userAgent);
    return isWinLike
      ? `http://${scheme}.localhost/${rest}`
      : `${scheme}://localhost/${rest}`;
  }
  return convertFileSrc(raw);
}
