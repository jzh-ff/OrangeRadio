# 内置壁纸资源目录

OrangeRadio 出厂自带的壁纸就放在这里，会被 `wallpaperStore.ts` 的
`loadBuiltinWallpapers()` 通过 `fetch('wallpapers/manifest.json')` 自动加载。

## 当前 manifest 中的条目

| id | 显示名 | 文件名 | 类型 |
|---|---|---|---|
| `builtin-kid-goku-flying-nimbus` | 小悟空·筋斗云 | `PREVIEW-Kid-Goku-Flying-Nimbus.mp4` | 视频 |
| `builtin-megumi-fushiguro` | 伏黑惠 | `PREVIEW-Megumi-Fushiguro-1.mp4` | 视频 |
| `builtin-night-blade` | 夜刃 | `PREVIEW-Night-Blade.mp4` | 视频 |
| `builtin-ninja-full-moon` | 忍者·满月 | `PREVIEW-Ninja-Full-Moon.mp4` | 视频 |
| `builtin-snorlax-night-sleep` | 卡比兽·夜眠 | `PREVIEW-Snorlax-Night-Sleep.mp4` | 视频 |
| `builtin-the-shade-and-the-knight` | 暗影与骑士 | `PREVIEW-The-Shade-and-the-Knight.mp4` | 视频 |

## 缩略图约定

视频条目**不需要**手动提供 `thumbnail`——`WallpaperPicker.tsx`
在缺省时会显示 `▶` 占位图标。`src` 即实际播放文件，`type: "video"`
由 `<video autoplay loop muted>` 渲染。

如要给视频加封面快照（改善壁纸选择器视觉），可：

```bash
# 用 ffmpeg 抽首帧生成 jpg（每张几十 KB）
ffmpeg -i PREVIEW-Xxx.mp4 -ss 0 -frames:v 1 -q:v 4 PREVIEW-Xxx-thumb.jpg
```

然后在 manifest 加 `"thumbnail": "PREVIEW-Xxx-thumb.jpg"`。

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