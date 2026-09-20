#Requires -Version 5.1
param(
  [switch]$All,
  [switch]$RestoreFrontendUrl
)

$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile = Join-Path $Root 'backend\.env'
$OutDir = Join-Path $PSScriptRoot 'out'
$StateFile = Join-Path $OutDir 'tunnel-state.json'

function Write-Step($msg) { Write-Host ("`n==> " + $msg) -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host ("  OK  " + $msg) -ForegroundColor Green }

function Stop-ProcessOnPort([int]$PortNum) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $PortNum -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
      if ($c.OwningProcess -gt 0) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Ok ("stopped port " + $PortNum + " pid=" + $c.OwningProcess)
      }
    }
  } catch {}
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' 钉钉报销 · 停止手机真机服务' -ForegroundColor White
Write-Host '========================================' -ForegroundColor Cyan

$state = $null
if (Test-Path $StateFile) {
  try { $state = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
}

Write-Step '停止 cpolar'
if ($state -and $state.cpolarPid) {
  Stop-Process -Id ([int]$state.cpolarPid) -Force -ErrorAction SilentlyContinue
  Write-Ok ("已停 cpolar pid=" + $state.cpolarPid)
}
Get-Process -Name 'cpolar' -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  Write-Ok ("已停 cpolar pid=" + $_.Id)
}

if ($RestoreFrontendUrl -and (Test-Path $EnvFile)) {
  Write-Step '恢复 FRONTEND_URL'
  $raw = Get-Content -LiteralPath $EnvFile -Raw -Encoding UTF8
  if ($raw -match '(?m)^# FRONTEND_URL_BEFORE_TUNNEL=(.+)$') {
    $old = $Matches[1].Trim()
    $raw = [regex]::Replace($raw, '(?m)^FRONTEND_URL=.*$', "FRONTEND_URL=$old")
    $raw = [regex]::Replace($raw, '(?m)^# FRONTEND_URL_BEFORE_TUNNEL=.*\r?\n', '')
    Set-Content -LiteralPath $EnvFile -Value $raw -Encoding UTF8 -NoNewline
    Write-Ok ("FRONTEND_URL=" + $old)
  } else {
    Write-Host '  无备份项 FRONTEND_URL_BEFORE_TUNNEL，跳过'
  }
}

if ($All) {
  Write-Step '停止后端 / 前端'
  $bp = 3000
  $fp = 5173
  if ($state) {
    if ($state.backendPort) { $bp = [int]$state.backendPort }
    if ($state.frontendPort) { $fp = [int]$state.frontendPort }
  }
  Stop-ProcessOnPort $bp
  Stop-ProcessOnPort $fp
}

if (Test-Path $StateFile) { Remove-Item $StateFile -Force -ErrorAction SilentlyContinue }
Write-Host ''
if ($All) {
  Write-Host '已全部停止（穿透 + 前后端）。' -ForegroundColor Green
} else {
  Write-Host '穿透已停。前后端窗口仍在；要一并关掉请用「一键停止-手机真机-含前后端.cmd」。' -ForegroundColor Green
}