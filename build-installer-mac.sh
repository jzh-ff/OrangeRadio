#!/usr/bin/env bash
# OrangeRadio macOS installer builder
# Usage (on macOS only):
#   ./build-installer-mac.sh                # default: arm64 (Apple Silicon)
#   ./build-installer-mac.sh x64            # Intel
#   ./build-installer-mac.sh universal      # Universal binary (aarch64 + x86_64)
#   ./build-installer-mac.sh arm64          # Apple Silicon (alias for default)
#
# Prerequisites (macOS host only):
#   - Xcode Command Line Tools: xcode-select --install
#   - Rust + rustup: https://rustup.rs
#   - Node.js 18+
#   - For universal: rustup target add aarch64-apple-darwin x86_64-apple-darwin
#
# Outputs (under apps/desktop/src-tauri/target/...):
#   release/bundle/macos/OrangeRadio.app
#   release/bundle/dmg/OrangeRadio_0.1.0_aarch64.dmg (or _x64 / _universal)

set -euo pipefail

# ----- Args -----
ARCH="${1:-arm64}"
case "$ARCH" in
    arm64|aarch64)  RUST_TARGET="aarch64-apple-darwin"; ARTIFACT_TAG="aarch64" ;;
    x64|x86_64)     RUST_TARGET="x86_64-apple-darwin";  ARTIFACT_TAG="x64" ;;
    universal)      RUST_TARGET="universal-apple-darwin"; ARTIFACT_TAG="universal" ;;
    *)
        echo "[FAIL] Unknown arch: $ARCH (use arm64 / x64 / universal)" >&2
        exit 1
        ;;
esac

# ----- Sanity checks -----
if [[ "$(uname)" != "Darwin" ]]; then
    echo "[FAIL] This script MUST run on macOS (not $(uname))." >&2
    echo "       macOS toolchain (codesign / hdiutil / lipo) is not available on other OSes." >&2
    exit 1
fi

if ! command -v xcode-select >/dev/null 2>&1; then
    echo "[FAIL] xcode-select not found. Install Command Line Tools: xcode-select --install" >&2
    exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
    echo "[FAIL] cargo not found. Install Rust: https://rustup.rs" >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "[FAIL] node not found. Install Node.js 18+." >&2
    exit 1
fi

if [[ "$ARCH" == "universal" ]]; then
    echo "[targets] Checking universal-apple-darwin..."
    rustup target add aarch64-apple-darwin x86_64-apple-darwin || true
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=================================="
echo "  OrangeRadio macOS installer builder"
echo "=================================="
echo "Working dir : $ROOT"
echo "Architecture: $ARCH ($RUST_TARGET)"
echo ""

# ----- 1. Frontend build -----
echo "[1/3] Building frontend..."
pushd frontend
if [[ ! -d node_modules ]]; then
    echo "      Running npm install..."
    npm install
fi
npm run build
popd

# ----- 2. Tauri build -----
echo ""
echo "[2/3] Running cargo tauri build --target $RUST_TARGET --bundles app,dmg ..."
pushd apps/desktop/src-tauri
if [[ "$ARCH" == "universal" ]]; then
    cargo tauri build --target universal-apple-darwin --bundles app,dmg
else
    cargo tauri build --target "$RUST_TARGET" --bundles app,dmg
fi
popd

# ----- 3. List artifacts -----
echo ""
echo "[3/3] Output artifacts:"
BUNDLE_DIR="$ROOT/apps/desktop/src-tauri/target/$RUST_TARGET/release/bundle"
for sub in macos dmg; do
    if [[ -d "$BUNDLE_DIR/$sub" ]]; then
        for f in "$BUNDLE_DIR/$sub"/*; do
            [[ -e "$f" ]] || continue
            size=$(du -h "$f" | cut -f1)
            echo "  -> $f ($size)"
        done
    fi
done

echo ""
echo "Done. Untested .app bundle — first launch on macOS will trigger Gatekeeper"
echo "(right-click the .app -> Open -> Open to bypass; or sign + notarize before distribution)."
echo "See docs/13-macos-build-guide.md for code-signing/notarization instructions."