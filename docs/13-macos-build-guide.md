# 13 - macOS 构建指南

> 版本：v0.4 · 最后更新：2026-07-07
>
> **给有 Mac 的开发者/用户在 macOS 上出 .app / .dmg 安装包**。
>
> Windows 机器**无法**直接打 macOS 安装包（缺 codesign / hdiutil / lipo / Apple SDK）。本文档假设你已有一台 macOS 主机（Intel 或 Apple Silicon）。

---

## 目录

- [前置依赖](#前置依赖)
- [快速开始](#快速开始)
- [产物说明](#产物说明)
- [架构选择](#架构选择)
- [签名与公证（可选，正式发布必须）](#签名与公证可选正式发布必须)
- [常见问题](#常见问题)
- [代码层的 macOS 适配情况](#代码层的-macos-适配情况)

---

## 前置依赖

### 1. macOS 主机
- macOS 11 (Big Sur) 及以上（构建主机）；运行目标 macOS 10.15+（见 `tauri.conf.json`）
- 推荐：**Apple Silicon (M1/M2/M3/M4)** —— 自家硬件跑自家架构最快
- Intel i5/i7 也完全 OK

### 2. Xcode Command Line Tools
```bash
xcode-select --install
```
提供 `clang`、`codesign`、`lipo`、`hdiutil` 等关键工具。**没装这个 `cargo tauri build` 会在链接/打包阶段报错**。

### 3. Rust + rustup
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# 跟随提示完成安装
```

装好后按需加 target：

```bash
# Apple Silicon
rustup target add aarch64-apple-darwin
# Intel
rustup target add x86_64-apple-darwin
# Universal binary（二者都要装）
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

### 4. Node.js 18+
推荐用 `nvm` 或 `fnm` 装：
```bash
brew install node@20
# 或
nvm install 20 && nvm use 20
```

### 5. 项目代码
```bash
git clone https://github.com/jzh-ff/OrangeRadio.git
cd OrangeRadio
```

---

## 快速开始

### 一行命令（推荐）

脚本自动检测架构（默认 `arm64`），自动装依赖，自动跑：

```bash
./build-installer-mac.sh                  # 默认 Apple Silicon (arm64)
./build-installer-mac.sh x64              # Intel
./build-installer-mac.sh universal        # Universal binary
```

脚本做了什么：
1. 校验 macOS 环境 + Xcode CLI Tools + cargo + node
2. 装缺失的 rust target（如 universal 模式）
3. `npm install`（如需要）+ `npm run build`（前端）
4. `cargo tauri build --target <arch> --bundles app,dmg`
5. 列出产物

### 手动执行（每一步看得见）

```bash
# 1. 装前端依赖 + 构建
cd frontend
npm install
npm run build
cd ..

# 2. 构建 macOS 安装包
cd apps/desktop/src-tauri

# Apple Silicon
cargo tauri build --target aarch64-apple-darwin --bundles app,dmg

# Intel
cargo tauri build --target x86_64-apple-darwin --bundles app,dmg

# Universal binary（双架构合并）
cargo tauri build --target universal-apple-darwin --bundles app,dmg

cd ../..
```

等价 npm 入口（在 frontend 目录）：
```bash
npm run dist:mac            # 当前架构 (arm64/x64 看 Mac 型号)
npm run dist:mac-universal  # Universal binary
```

---

## 产物说明

构建成功后产物在：

```
apps/desktop/src-tauri/target/<arch>/release/bundle/
├── macos/
│   └── OrangeRadio.app           # 双击启动 / 拖到 Applications
└── dmg/
    └── OrangeRadio_0.1.0_<arch>.dmg   # 安装器镜像
```

### `.app` 直接打开

```bash
open apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/OrangeRadio.app
```

首次打开会被 **Gatekeeper** 拦截（因为没签名）：
- 右键 OrangeRadio.app → 「打开」→ 弹窗里再点「打开」
- 仅需一次，之后双击即可

### `.dmg` 安装器

```bash
open apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/OrangeRadio_0.1.0_aarch64.dmg
```

弹出 Finder 窗口，把 OrangeRadio.app 拖到 Applications 文件夹。Gatekeeper 拦截同上。

---

## 架构选择

| 架构 | 何时用 | 优点 | 缺点 |
|------|--------|------|------|
| `arm64` (Apple Silicon) | 给 M1/M2/M3/M4 Mac 用户 | 包小、跑得快 | Intel Mac 跑不了 |
| `x64` (Intel) | 给 Intel Mac 用户 | Intel Mac 兼容 | Apple Silicon 通过 Rosetta 跑（慢 30%） |
| `universal` | 一次出包覆盖全部 | 单 DMG 双架构兼容 | 包大 (~2 倍 arm64) |

**推荐**：
- 个人/内部测试 → `arm64`（你的 Mac 是什么就出什么）
- 公开发布 → `universal`（一份 DMG 覆盖全 Mac 用户）

### Universal Binary 的额外要求

- `cargo tauri build --target universal-apple-darwin` 需先 `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
- 构建时间约 2 倍（两个架构各编一次）
- 包大小约 2 倍
- Tauri 2 默认会自动用 `lipo` 合并

---

## 签名与公证（可选，正式发布必须）

> ⚠ **未签名/未公证的 .app 在 macOS 上首次启动会被 Gatekeeper 拦截**。本指南默认不签名（开发/内部测试足够）。
>
> 正式对外发布（特别是给不熟悉的用户）必须签名 + 公证。

### 1. 申请 Apple Developer ID
- 年费 **99 USD**
- 申请地址：https://developer.apple.com/programs/enroll/
- 拿到 `Developer ID Application: Your Name (TEAM_ID)` 形式的证书

### 2. 导出 .p12 证书
1. 钥匙串访问 → 找到「Developer ID Application」证书
2. 右键 → 「导出…」 → 存为 `.p12`，设密码

### 3. 配 Tauri 自动签名
编辑 `apps/desktop/src-tauri/tauri.conf.json` 的 `bundle.macOS`：

```json
"macOS": {
  "minimumSystemVersion": "10.15",
  "signingIdentity": "Developer ID Application: Your Name (TEAM12345XYZ)",
  "providerShortName": "TEAM12345XYZ",
  "entitlements": null
}
```

环境变量注入 p12 密码：

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM12345XYZ)"
export APPLE_CERTIFICATE="..."           # base64 编码的 .p12 内容
export APPLE_CERTIFICATE_PASSWORD="..."  # p12 密码
```

### 4. 公证（notarize）

```bash
# 1. 提交 DMG 给 Apple 公证
xcrun notarytool submit OrangeRadio_0.1.0_aarch64.dmg \
    --apple-id "your@apple.id" \
    --password "app-specific-password" \
    --team-id "TEAM12345XYZ" \
    --wait

# 2. 公证完成后钉到 DMG（让离线启动也能验证）
xcrun stapler staple OrangeRadio_0.1.0_aarch64.dmg
```

### 5. CI 自动化
把上述环境变量注入 GitHub Actions / GitLab CI 的 secrets，配合 macos-latest runner 自动签名 + 公证。详细配置见 `tauri-action` 文档：https://github.com/tauri-apps/tauri-action

---

## 常见问题

### Q1: 报错 `codesign` failed / xcrun error

**原因**：没装 Xcode Command Line Tools。

**修**：
```bash
xcode-select --install
```
然后重新跑 `./build-installer-mac.sh`。

### Q2: 报错 `error: linker 'cc' not found`

**原因**：同上，Xcode CLI Tools 缺失。

**修**：装 Xcode CLI Tools。

### Q3: 报错 `lipo` not found

**原因**：Universal binary 模式需要 lipo，Apple 自带工具。

**修**：检查 `xcode-select -p` 输出（应该是 `/Applications/Xcode.app/Contents/Developer` 或 `/Library/Developer/CommandLineTools`）。如果不是，跑 `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` 修复。

### Q4: 构建成功了，但 .app 一启动就崩

可能原因：
- macOS 版本太老（构建主机的 macOS 必须 ≥ 目标系统版本）
- 架构不对（Intel Mac 装了 arm64 .app）—— 用 `file OrangeRadio.app/Contents/MacOS/*` 看 Mach-O 架构
- 代码层 macOS 兼容性 bug（看 console：`open -a Console.app`）

### Q5: `.app` 启动后找不到库/封面

我们的代码在 macOS 上用 `app.path().app_data_dir()` 落数据到 `~/Library/Application Support/com.orangeradio.app/`。如果发现数据目录是空的：

- 检查 macOS 沙盒是否启用（`com.apple.security.app-sandbox` entitlement，默认 Tauri 没启用）
- 看 `~/Library/Logs/com.orangeradio.app/` 找日志
- 启动时按住 Option 打开控制台看崩溃日志

### Q6: 全局热键不工作？

macOS 上注册全局热键需要在「系统设置 → 隐私与安全性 → 辅助功能」中授权 OrangeRadio。首次触发全局热键时系统会弹授权提示。

### Q7: 怎么在 Mac 上开发热重载？

```bash
cd apps/desktop/src-tauri && cargo tauri dev
```
首次会下载 + 编译依赖（5-15 分钟），之后增量编译很快。

---

## 代码层的 macOS 适配情况

> 已完成 v0.4 的代码层适配（在 `feat/...` 分支合并前已 push 到 main）。

### 已修的 macOS 兼容性问题
1. **数据目录路径** —— 把 5 处 `std::env::current_dir().join(".orangeradio/...")` 改为 `app.path().app_data_dir().join(...)`，确保在 macOS Finder 双击启动时（`CWD=/`）仍能正确落数据到 `~/Library/Application Support/com.orangeradio.app/`：
   - `crates/orange-tauri/src/lib.rs` 新增 `app_data_root(&AppHandle)` + `app_data_subdir(&AppHandle, name)` 工具函数
   - `crates/orange-tauri/src/commands.rs::log_path` / `analyze_beatmap` / `cover_proxy` / `library_scan` 接收 `AppHandle` 参数
   - `crates/orange-library/src/scanner.rs::LibraryScanner` 新增 `with_covers_dir(covers_dir)` 构造函数
   - `crates/orange-library/src/metadata.rs::read_track` / `extract_cover_to_disk` 新增 `covers_dir` 参数

### 当前未实现 / 不影响 macOS 的项
- **系统托盘** —— 跨平台用 `tauri-plugin-system-tray`，v0.5 计划
- **单实例** —— 跨平台用 `tauri-plugin-single-instance`，v0.5 计划
- **代码签名 / 公证** —— 见上文「签名与公证」章节，需 Apple Developer 账号
- **macOS sandbox entitlements** —— 默认不启用，发布前可选加

### 已确认无 Windows-only 代码
- `crates/orange-tauri/src/wallpaper_engine.rs:178-194` 读 Steam 注册表（Wallpaper Engine 在 macOS 上停更），已用 `#[cfg(target_os = "windows")]` 隔离
- 无 `cmd` / `powershell` / `taskkill` shell-out
- 无 `C:\\` 硬编码（仅注释里举例子）

---

## 进阶参考

- [Tauri 2 macOS 打包文档](https://tauri.app/distribute/sign/macos/)
- [Apple Notarization 流程](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Apple Developer ID 申请](https://developer.apple.com/developer-id/)
- [Tauri GitHub Action（自动签名公证）](https://github.com/tauri-apps/tauri-action)