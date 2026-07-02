# OrangeRadio launcher
# Usage: .\run.ps1
#
# 自动配置：把 MSVC 的 link.exe 加到 PATH 最前面（盖过 Git 的 /usr/bin/link），
# 解决 Rust MSVC 工具链链接报错 "link: extra operand"。

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "==================================" -ForegroundColor DarkYellow
Write-Host "  OrangeRadio launcher" -ForegroundColor Yellow
Write-Host "==================================" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "Working dir: $Root"
Write-Host ""

# --- 1. 把 MSVC link.exe 加到 PATH 最前 ---
# 在多个常见位置搜索 MSVC link.exe（VS 可能在 C 盘或 D 盘）
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

# --- 2. 确保 cargo 在 PATH ---
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path (Join-Path $CargoBin "cargo.exe")) {
    $env:PATH = "$CargoBin;$env:PATH"
}
$rustcVer = rustc --version 2>&1
Write-Host "[rust] $rustcVer" -ForegroundColor Cyan
Write-Host ""

# --- 3. Build frontend ---
Write-Host "[1/3] Building frontend..." -ForegroundColor Cyan
Push-Location (Join-Path $Root "frontend")
npm run build
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Write-Host "[FAIL] frontend build failed" -ForegroundColor Red; exit 1 }
Write-Host "[OK] frontend built" -ForegroundColor Green
Write-Host ""

# --- 4. Build Rust ---
Write-Host "[2/3] Building Rust desktop app..." -ForegroundColor Cyan
cargo build -p orangeradio-desktop
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Host "[FAIL] Rust build failed" -ForegroundColor Red
    Write-Host "If link error, ensure Visual Studio (C++ workload) is installed." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Rust built" -ForegroundColor Green
Write-Host ""

# --- 5. Launch ---
Write-Host "[3/3] Launching OrangeRadio..." -ForegroundColor Cyan
Write-Host "(close the app window to exit)" -ForegroundColor Gray
Write-Host ""
$Exe = Join-Path $Root "target\debug\orangeradio-desktop.exe"
& $Exe
