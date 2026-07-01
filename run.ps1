# OrangeRadio launcher
# Usage: .\run.ps1
#
# IMPORTANT: this script prepends WinLibs GCC to PATH so the Rust GNU
# toolchain can find libgcc/libgcc_eh during linking.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "==================================" -ForegroundColor DarkYellow
Write-Host "  OrangeRadio launcher" -ForegroundColor Yellow
Write-Host "==================================" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "Working dir: $Root"
Write-Host ""

# --- Prepend WinLibs GCC to PATH ---
$WinLibsBin = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
$GccExe = Join-Path $WinLibsBin "gcc.exe"
if (Test-Path $GccExe) {
    $env:PATH = "$WinLibsBin;" + $env:PATH
    $gccVer = & $GccExe --version 2>&1 | Select-Object -First 1
    Write-Host "[toolchain] WinLibs GCC enabled: $gccVer" -ForegroundColor Green
} else {
    Write-Host "[WARN] WinLibs GCC not found! Linking may fail." -ForegroundColor Red
    Write-Host "  Expected at: $WinLibsBin" -ForegroundColor Red
    Write-Host "  Install it: winget install BrechtSanders.WinLibs.POSIX.MSVCRT" -ForegroundColor Red
    Write-Host ""
}

# --- Ensure cargo on PATH ---
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path (Join-Path $CargoBin "cargo.exe")) {
    $env:PATH = "$CargoBin;" + $env:PATH
}
$rustcVer = rustc --version 2>&1
Write-Host "[rust] $rustcVer" -ForegroundColor Cyan
Write-Host ""

# --- 1. Build frontend ---
Write-Host "[1/3] Building frontend..." -ForegroundColor Cyan
Push-Location (Join-Path $Root "frontend")
npm run build
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Write-Host "[FAIL] frontend build failed" -ForegroundColor Red; exit 1 }
Write-Host "[OK] frontend built" -ForegroundColor Green
Write-Host ""

# --- 2. Build Rust ---
Write-Host "[2/3] Building Rust desktop app..." -ForegroundColor Cyan
cargo build -p orangeradio-desktop
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Host "[FAIL] Rust build failed" -ForegroundColor Red
    Write-Host "If you see libgcc link errors, make sure WinLibs GCC is installed." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Rust built" -ForegroundColor Green
Write-Host ""

# --- 3. Launch ---
Write-Host "[3/3] Launching OrangeRadio..." -ForegroundColor Cyan
Write-Host "(close the app window to exit)" -ForegroundColor Gray
Write-Host ""
$Exe = Join-Path $Root "target\debug\orangeradio-desktop.exe"
& $Exe
