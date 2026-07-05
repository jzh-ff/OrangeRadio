# OrangeRadio — Shared Team Memory

Curated notes the whole harness team can reference. Write durable lessons here, one entry per topic, with date.

---

## Build & toolchain (2026-07-04)

- **MSVC `link.exe` PATH collision on Windows**: Git Bash ships a `/usr/bin/link.exe` that breaks MSVC link. `run.ps1` prepends the real MSVC link dir to PATH — when running `cargo build` outside the script, either invoke `.\run.ps1` first or manually prepend `%ProgramFiles%\Microsoft Visual Studio\<ver>\VC\Tools\MSVC\<ver>\bin\Hostx64\x64`.
- **Node deps**: `frontend/` already has `node_modules/` populated. Re-run `npm install` only if deps drift.
- **Cargo workspace members are 11**: 9 in `crates/` + `apps/desktop/src-tauri` + `server`. Add new crates to `[workspace] members` in root `Cargo.toml`.
- **No CI configured yet** — `.github/` is empty. Pre-merge verification is manual: `cargo build -p orangeradio-desktop` + `cd frontend && npm run build`.

## Current architecture state (v0.3 完成 / v0.4 进行中)

- **v0.2 playback path is hybrid**: Rust `orange-audio` has trait skeletons but actual playback goes through frontend Web Audio API (`useAudioEngine.ts`) using `convertFileSrc()` for local files. Do NOT remove the trait scaffolding — it's the v0.4+ target.
- **v0.3 sources (全部完成 ✅)**: Netease (扫码 + Cookie login, weapi 加密), QQ Music (mirrors Netease surface), Spotify (OAuth2, 30s preview), RadioBrowser (4万+ 电台), Podcast RSS, 聚合 `search_all` (5 sources 并发 + 5s timeout).
- **v0.4 视觉 (🔨 30%)**: Three.js particle + beat detection + dynamic lyrics already shipped in `frontend/src/visual/` and `features/player/useBeatDetector.ts`. Open work: 真实频谱 (条形/圆/波), 粒子流体, 歌词舞台, 桌面歌词 (multi-window), 3D 歌单架, Shader 系统.
- **v0.5/v0.6/v0.7/v0.8**: not started. See `docs/09-开发计划.md` for task breakdown.

## Conventions to preserve

- **Tauri command registration**: only `crates/orange-tauri/src/commands.rs::register_all`. No command registration elsewhere.
- **Single source of truth for IPC payload types**: `crates/orange-core/`. Don't redefine `Track`, `SearchQuery`, etc. inside `orange-tauri` or sources.
- **No new top-level `Cargo.toml`**. Workspace member or nothing.
- **Frontend doesn't talk to third-party music APIs directly**. All Netease / QQ / Spotify calls route through Rust IPC. CORS + cookie handling depend on this.
- **中文 OK in**: user-facing strings, docs, commit bodies, comments explaining intent. **English required** for: code identifiers, crate names, Tauri command names, public API names.

## Source-integration gotchas (as of 2026-07-03)

- **Netease 风控 (-110)**: requires `os=pc` cookie. Cookie login path is the stable workaround; QR scan needs `type=1` and Set-Cookie preservation (don't follow redirects).
- **Netease weapi**: AES + RSA + base64 encryption lives in `orange-sources/src/weapi.rs`. Don't reimplement inline.
- **QQ Music CDN has CORS limits**: `qqmusic_stream` uses `resolve_to_file` (Rust-side download) instead of returning a URL. Don't change this without re-checking CORS.
- **Spotify playback**: 30-second preview only without Premium SDK. Don't promise full-track playback in UI.

## Data location

- **SQLite library**: `.orangeradio/library.sqlite` (gitignored). Schema lives in `crates/orange-library/src/database.rs`.
- **Logs**: `.orangeradio/logs/` (gitignored). Tauri command `log_path()` returns the absolute path for the frontend "Open Logs Folder" button.
- **Test audio**: `test-music/` (gitignored). Used for Hi-Res / DSP smoke tests.