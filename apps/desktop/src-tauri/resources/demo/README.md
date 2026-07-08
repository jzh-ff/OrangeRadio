# 内置 demo 曲资源目录

OrangeRadio 首启自动播放的演示曲目就放在这里。

## 文件清单

| 文件 | 用途 | 备注 |
|---|---|---|
| `track.mp3` | 30 秒以内的轻量 demo 曲 | **必填**，MP3 最稳 |
| `track.lrc` | 标准 `[mm:ss.xx]` LRC 歌词 | **必填**，UTF-8 无 BOM |
| `cover.jpg` | 封面（≥ 1024×1024 优先） | **必填**，≤ 500KB 推荐 |

## 打包流程

`tauri.conf.json` 的 `bundle.resources = ["resources/**"]` 会把这三个文件打进
安装包（MSI/NSIS/dmg），dev 模式下 Tauri 2 的 `app.path().resolve_resource()`
会自动找到对应绝对路径。

## 替换

直接覆盖这三个文件即可，不需要改任何代码；如要改标题/艺人/封面，
去 `crates/orange-tauri/src/commands.rs` 的 `builtin_track_meta` 函数里改元数据。