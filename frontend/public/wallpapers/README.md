# 内置壁纸资源目录

OrangeRadio 出厂自带的壁纸就放在这里，会被 `wallpaperStore.ts` 的
`loadBuiltinWallpapers()` 通过 `fetch('wallpapers/manifest.json')` 自动加载。

## 当前 manifest 中的条目

| id | 文件名 | 类型 |
|---|---|---|
| `builtin-aurora` | `aurora.jpg` + `aurora-thumb.jpg` | 图片 |
| `builtin-galaxy-webm` | `galaxy.webm` | 视频 |

## 添加新条目

直接往 `manifest.json` 加一项并把文件丢到本目录即可：

```json
{
  "id": "builtin-<唯一>",
  "name": "显示名",
  "type": "image" | "video",
  "src": "相对路径（相对本目录）",
  "thumbnail": "可选，相对路径",
  "addedAt": 0
}
```

视频建议用 `.webm`（VP9）而非 `.mp4`，体积小且 WebView 2 全支持。

## 何时会被 bundle

Vite `public/` 目录在 `npm run build` 时会被整体拷到 `frontend/dist/`,
Tauri 通过 `frontendDist: ../dist`（tauri.conf.json）把它打进安装包，
因此你提交这个目录的改动后，必须跑 `npm run build` 才会反映到桌面端。