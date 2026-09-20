#Requires -Version 5.1
<#
.SYNOPSIS
  生产/本地 MySQL 初始化：建库建表 + seed-prod（不含 dev 测试数据）
.EXAMPLE
  .\scripts\deploy\init-production.ps1 -EnvFile backend\.env
#>
param(
    [string]$EnvFile = "",
    [switch]$SkipSeed
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $EnvFile) {
    foreach ($candidate in @(
        Join-Path $Root ".env",
        Join-Path $Root "backend\.env",
        Join-Path $Root ".env.production"
    )) {
        if (Test-Path $candidate) { $EnvFile = $candidate; break }
    }
}

Write-Host "[init-production] project root: $Root"
if ($EnvFile) {
    Write-Host "[init-production] env file: $EnvFile"
    Copy-Item $EnvFile (Join-Path $Root "backend\.env") -Force -ErrorAction SilentlyContinue
}

Push-Location (Join-Path $Root "backend")
try {
    Write-Host "[init-production] npm run db:init"
    npm run db:init
    if (-not $SkipSeed) {
        Write-Host "[init-production] npm run db:seed-prod"
        npm run db:seed-prod
    }
    Write-Host "[init-production] done. Next: start backend + frontend, run health-check.ps1"
}
finally {
    Pop-Location
}
