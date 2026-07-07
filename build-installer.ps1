# OrangeRadio installer builder
# Usage:
#   ./build-installer.ps1                # default: NSIS + MSI
#   ./build-installer.ps1 nsis           # NSIS only
#   ./build-installer.ps1 msi            # MSI only
#   ./build-installer.ps1 all            # same as default
#
# Auto-configures MSVC link.exe on PATH (overrides Git Bash /usr/bin/link),
# then runs `cargo tauri build` to produce Windows installers.
#
# Outputs:
#   target/release/orangeradio-desktop.exe
#   target/release/bundle/nsis/OrangeRadio_*_x64-setup.exe
#   target/release/bundle/msi/OrangeRadio_*_x64_en-US.msi

$Targets = "all"
if ($args.Count -gt 0) {
    switch ($args[0].ToLower()) {
        "nsis" { $Targets = "nsis" }
        "msi"  { $Targets = "msi" }
        "all"  { $Targets = "all" }
        default {
            Write-Host "[FAIL] Unknown target: $($args[0]) (use nsis / msi / all)" -ForegroundColor Red
            exit 1
        }
    }
}

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "==================================" -ForegroundColor DarkYellow
Write-Host "  OrangeRadio installer builder" -ForegroundColor Yellow
Write-Host "==================================" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "Working dir : $Root"
Write-Host "Targets     : $Targets"
Write-Host ""

# --- 1. Put MSVC link.exe at the front of PATH ---
$MsvcPatterns = @(
    "$env:ProgramFiles\Microsoft Visual Studio\*\*\VC\Tools\MSVC\*\bin\Hostx64\x64",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\*\*\VC\Tools\MSVC\*\bin\Hostx64\x64",
    "D:\Microsoft Visual Studio\*\*\VC\Tools\MSVC\*\bin\Hostx64\x64"
)
$MsvcLink = $null
foreach ($pattern in $MsvcPatterns) {
    $found = Get-ChildItem -Path $pattern -Filter "link.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $MsvcLink = $found.FullName; break }
}
if ($MsvcLink) {
    $MsvcBin = Split-Path $MsvcLink
    $env:PATH = "$MsvcBin;$env:PATH"
    Write-Host "[toolchain] MSVC link.exe: $MsvcLink" -ForegroundColor Green
} else {
    Write-Host "[toolchain] MSVC link.exe not found, using default PATH" -ForegroundColor Yellow
}

# --- 2. Ensure cargo on PATH ---
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path (Join-Path $CargoBin "cargo.exe")) {
    $env:PATH = "$CargoBin;$env:PATH"
}
$rustcVer = rustc --version 2>&1
Write-Host "[rust] $rustcVer" -ForegroundColor Cyan

# --- 3. Locate Tauri CLI ---
$TauriBin = Join-Path $Root "frontend/node_modules/.bin"
$TauriCmd = Join-Path $TauriBin "tauri.cmd"
if (-not (Test-Path $TauriCmd)) {
    Write-Host "[FAIL] Tauri CLI not found: $TauriCmd" -ForegroundColor Red
    Write-Host "       Run: cd frontend && npm install" -ForegroundColor Red
    exit 1
}
Write-Host "[tauri] $TauriCmd" -ForegroundColor Cyan
Write-Host ""

# --- 4. Run tauri build ---
# tauri CLI 2.x --bundles accepts comma- or space-separated values: msis, nsis, etc.
# "all" is only valid in tauri.conf.json bundle.targets, NOT on the CLI flag.
$BundleArg = switch ($Targets) {
    "all"  { "nsis,msi" }
    default { $Targets }
}
Write-Host "[1/2] Running cargo tauri build --bundles $BundleArg ..." -ForegroundColor Cyan
Push-Location (Join-Path $Root "apps/desktop/src-tauri")
try {
    & $TauriCmd build --bundles $BundleArg
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($code -ne 0) {
    Write-Host "[FAIL] tauri build failed (exit $code)" -ForegroundColor Red
    exit $code
}
Write-Host "[OK] tauri build done" -ForegroundColor Green
Write-Host ""

# --- 5. List artifacts ---
Write-Host "[2/2] Output artifacts:" -ForegroundColor Cyan
$patterns = @(
    "target/release/orangeradio-desktop.exe",
    "target/release/bundle/nsis/*.exe",
    "target/release/bundle/msi/*.msi"
)
foreach ($rel in $patterns) {
    $items = Get-Item (Join-Path $Root $rel) -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        $size = "{0:N2} MB" -f ($item.Length / 1MB)
        Write-Host "  -> $($item.FullName) ($size)" -ForegroundColor Green
    }
}
Write-Host ""
Write-Host "Done." -ForegroundColor Green