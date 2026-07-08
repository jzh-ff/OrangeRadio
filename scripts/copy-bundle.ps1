# OrangeRadio 安装包搬运脚本
# 把 cargo tauri build 产物从 target/release/bundle/ 复制到 dist/release/{Platform}/
# 便于上传 GitHub Release / 内部分发

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

$Source = Join-Path $Root "target\release\bundle"
$Dest = Join-Path $Root "dist\release"

if (-not (Test-Path $Source)) {
    Write-Host "[FAIL] 找不到 $Source，请先跑 cargo tauri build" -ForegroundColor Red
    exit 1
}

$Platforms = @{
    "nsis"  = "Windows"
    "msi"   = "Windows"
    "dmg"   = "macOS"
    "app"   = "macOS"
    "deb"   = "Linux"
    "rpm"   = "Linux"
    "appimage" = "Linux"
}

foreach ($sub in @("nsis", "msi", "dmg", "app", "deb", "rpm", "appimage")) {
    $srcSub = Join-Path $Source $sub
    if (Test-Path $srcSub) {
        $target = Join-Path $Dest $Platforms[$sub]
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Write-Host "[$sub] -> $target" -ForegroundColor Cyan
        Copy-Item -Path (Join-Path $srcSub "*") -Destination $target -Force -Recurse
        Get-ChildItem $target | ForEach-Object {
            $size = "{0:N2} MB" -f ($_.Length / 1MB)
            Write-Host "  $($_.Name)  ($size)" -ForegroundColor Green
        }
    }
}

Write-Host ""
Write-Host "[OK] 产物已复制到 $Dest" -ForegroundColor Green
Write-Host ""
Write-Host "下一步:" -ForegroundColor Yellow
Write-Host "  - 验证安装: .\dist\release\Windows\OrangeRadio_0.1.0_x64-setup.exe"
Write-Host "  - 上传 Release: gh release create v0.1.0 .\dist\release\**\*"
