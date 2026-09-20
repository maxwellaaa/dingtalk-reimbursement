#Requires -Version 5.1
param(
  [switch]$SkipCpolar,
  [int]$Port = 5173,
  [int]$BackendPort = 3000
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BackendDir = Join-Path $Root 'backend'
$FrontendDir = Join-Path $Root 'frontend'
$EnvFile = Join-Path $BackendDir '.env'
$OutDir = Join-Path $PSScriptRoot 'out'
$LogDir = Join-Path $OutDir 'logs'
$StateFile = Join-Path $OutDir 'tunnel-state.json'
$ChecklistFile = Join-Path $OutDir 'dingtalk-mobile-checklist.txt'
$CpolarLog = Join-Path $LogDir 'cpolar.log'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Step($msg) { Write-Host ("`n==> " + $msg) -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host ("  OK  " + $msg) -ForegroundColor Green }
function Write-Warn($msg) { Write-Host ("  !!  " + $msg) -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host ("  XX  " + $msg) -ForegroundColor Red }

function Resolve-CpolarExe {
  $candidates = @(
    $env:CPOLAR_EXE,
    'C:\Program Files\cpolar\cpolar.exe',
    'C:\Program Files (x86)\cpolar\cpolar.exe',
    (Join-Path $env:LOCALAPPDATA 'cpolar\cpolar.exe'),
    (Join-Path $env:USERPROFILE 'cpolar\cpolar.exe')
  )
  $cmd = Get-Command cpolar -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { $candidates = @($cmd.Source) + $candidates }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return (Resolve-Path -LiteralPath $c).Path }
  }
  return $null
}

function Test-PortListen([int]$PortNum) {
  try {
    $c = Get-NetTCPConnection -LocalPort $PortNum -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    return $null -ne $c
  } catch {
    $client = $null
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $async = $client.BeginConnect('127.0.0.1', $PortNum, $null, $null)
      $ok = $async.AsyncWaitHandle.WaitOne(300)
      return ($ok -and $client.Connected)
    } catch {
      return $false
    } finally {
      if ($client) { $client.Close() }
    }
  }
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSec = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }
  return $false
}

function Start-DevWindow([string]$Title, [string]$WorkDir, [string]$Command) {
  $cmd = "Set-Location -LiteralPath '$WorkDir'; `$Host.UI.RawUI.WindowTitle = '$Title'; $Command"
  Start-Process powershell.exe -ArgumentList @('-NoExit', '-NoProfile', '-Command', $cmd) | Out-Null
}

function Update-EnvFrontendUrl([string]$Path, [string]$NewUrl) {
  if (-not (Test-Path $Path)) { throw "Missing $Path" }
  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  if ($raw -notmatch '(?m)^FRONTEND_URL=') {
    $raw = $raw.TrimEnd() + "`r`nFRONTEND_URL=$NewUrl`r`n"
  } else {
    if ($raw -notmatch '(?m)^# FRONTEND_URL_BEFORE_TUNNEL=') {
      if ($raw -match '(?m)^FRONTEND_URL=(.+)$') {
        $old = $Matches[1].Trim()
        $raw = "# FRONTEND_URL_BEFORE_TUNNEL=$old`r`n" + $raw
      }
    }
    $raw = [regex]::Replace($raw, '(?m)^FRONTEND_URL=.*$', "FRONTEND_URL=$NewUrl")
  }
  Set-Content -LiteralPath $Path -Value $raw -Encoding UTF8 -NoNewline
}

function Get-CpolarHttpsUrl {
  # 1) Parse local Web UI window.data (most reliable for cpolar 3.x)
  try {
    $html = (Invoke-WebRequest -Uri 'http://127.0.0.1:4040/' -UseBasicParsing -TimeoutSec 3).Content
    $m = [regex]::Match($html, 'window\.data\s*=\s*JSON\.parse\("(.+?)"\);')
    if ($m.Success) {
      $jsonText = [System.Text.RegularExpressions.Regex]::Unescape($m.Groups[1].Value)
      $data = $jsonText | ConvertFrom-Json
      $tunnels = @()
      if ($data.UiState -and $data.UiState.Tunnels) { $tunnels = @($data.UiState.Tunnels) }
      $https = $null
      $http = $null
      foreach ($t in $tunnels) {
        $u = [string]$t.PublicUrl
        if ($u -match '^https://') { $https = $u.TrimEnd('/') }
        elseif ($u -match '^http://') { $http = $u.TrimEnd('/') }
      }
      if ($https) { return $https }
      if ($http) { return ($http -replace '^http://', 'https://') }
    }
  } catch {}

  # 2) ngrok-style API (sometimes empty on cpolar)
  foreach ($api in @('http://127.0.0.1:4040/api/tunnels', 'http://localhost:4040/api/tunnels')) {
    try {
      $resp = Invoke-WebRequest -Uri $api -UseBasicParsing -TimeoutSec 2
      if (-not $resp.Content) { continue }
      $json = $resp.Content | ConvertFrom-Json
      $list = @()
      if ($json.tunnels) { $list = @($json.tunnels) }
      elseif ($json.Tunnels) { $list = @($json.Tunnels) }
      foreach ($t in $list) {
        foreach ($key in @('public_url', 'PublicUrl', 'url', 'URL')) {
          $u = [string]$t.$key
          if ($u -match '^https://') { return $u.TrimEnd('/') }
        }
      }
    } catch {}
  }

  # 3) log fallback (domains: cpolar.cn / .com / .top)
  if (Test-Path $CpolarLog) {
    $text = Get-Content -LiteralPath $CpolarLog -Raw -ErrorAction SilentlyContinue
    if ($text) {
      $pattern = 'https://[a-zA-Z0-9.-]+\.(?:cpolar\.(?:cn|com|top)|ngrok-free\.app|ngrok\.io|natappfree\.cc)[^\s"]*'
      $m = [regex]::Matches($text, $pattern)
      if ($m.Count -gt 0) { return $m[$m.Count - 1].Value.TrimEnd('/') }
    }
  }
  return $null
}

function Stop-ProcessOnPort([int]$PortNum) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $PortNum -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
      if ($c.OwningProcess -gt 0) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' 钉钉报销 · 手机真机一键启动' -ForegroundColor White
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ("项目: " + $Root)

Write-Step '检查依赖'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Fail '未找到 node，请先安装 Node.js 20 LTS'
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Fail '未找到 npm'
  exit 1
}
Write-Ok ("node " + (node -v))

$CpolarExe = Resolve-CpolarExe
if (-not $SkipCpolar -and -not $CpolarExe) {
  Write-Fail '未找到 cpolar。请安装 https://www.cpolar.com/ 或设置环境变量 CPOLAR_EXE'
  Write-Host '  仅本机调试可加: -SkipCpolar'
  exit 1
}
if ($CpolarExe) { Write-Ok ("cpolar: " + $CpolarExe) }

if (-not (Test-Path $EnvFile)) {
  Write-Fail ("缺少配置文件: " + $EnvFile)
  Write-Host '  请复制 backend\.env.example 为 .env 并填写钉钉凭证'
  exit 1
}
Write-Ok 'backend/.env 已找到'

Write-Step ("启动后端 (:" + $BackendPort + ")")
if (Test-PortListen $BackendPort) {
  Write-Ok ("端口 " + $BackendPort + " 已在监听，复用")
} else {
  Start-DevWindow 'dingtalk-reimb-backend' $BackendDir 'npm run dev'
  Write-Ok '已打开后端窗口'
}

Write-Step ("启动前端 (:" + $Port + ")")
if (Test-PortListen $Port) {
  Write-Ok ("端口 " + $Port + " 已在监听，复用")
} else {
  Start-DevWindow 'dingtalk-reimb-frontend' $FrontendDir 'npm run dev'
  Write-Ok '已打开前端窗口'
}

Write-Step '等待本机服务就绪'
$healthLocal = "http://127.0.0.1:$BackendPort/api/health"
if (-not (Wait-HttpOk $healthLocal 60)) {
  Write-Fail '后端 /api/health 未就绪（请确认 MySQL 已启动、.env 中 DB_* 正确）'
  exit 1
}
try {
  $healthJson = (Invoke-WebRequest -Uri $healthLocal -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
  if ($healthJson.db -eq $true) {
    Write-Ok ("后端 OK · version=" + $healthJson.version + " · db=true")
  } else {
    Write-Warn '后端已启动但 db=false，请检查 MySQL 服务与 DB 密码'
  }
} catch {
  Write-Ok '后端 /api/health OK'
}
if (-not (Wait-HttpOk ("http://127.0.0.1:" + $Port + "/h5/") 60)) {
  Write-Warn '前端 /h5/ 尚未就绪，继续尝试穿透…'
} else {
  Write-Ok '前端 /h5/ OK'
}

$publicBase = $null
$cpolarProcId = $null

if (-not $SkipCpolar) {
  Write-Step ("启动 cpolar 穿透 http " + $Port)
  Get-Process -Name 'cpolar' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

  $publicBase = Get-CpolarHttpsUrl
  if ($publicBase) {
    Write-Ok ("复用已有隧道: " + $publicBase)
  } else {
    # 勿重定向 stdout/stderr，否则部分版本无法创建隧道
    $proc = Start-Process -FilePath $CpolarExe -ArgumentList @('http', "$Port") `
      -PassThru -WindowStyle Minimized
    $cpolarProcId = $proc.Id
    Write-Ok ("cpolar PID=" + $cpolarProcId + "（等待公网 URL，最多 60 秒）")
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 2
      $publicBase = Get-CpolarHttpsUrl
      if ($publicBase) { break }
    }
  }

  if (-not $publicBase) {
    Write-Fail '未能获取 cpolar HTTPS 地址。'
    Write-Host '  浏览器打开 http://127.0.0.1:4040/ 查看 Public URL'
    Write-Host '  或手动: cpolar http 5173'
    exit 1
  }
  Write-Ok ("公网地址: " + $publicBase)

  Write-Step '写入 FRONTEND_URL 并重启后端'
  Update-EnvFrontendUrl -Path $EnvFile -NewUrl $publicBase
  Write-Ok ("FRONTEND_URL=" + $publicBase)
  Stop-ProcessOnPort $BackendPort
  Start-Sleep -Seconds 1
  Start-DevWindow 'dingtalk-reimb-backend' $BackendDir 'npm run dev'
  if (-not (Wait-HttpOk ("http://127.0.0.1:" + $BackendPort + "/api/health") 60)) {
    Write-Fail '后端重启失败'
    exit 1
  }
  Write-Ok '后端已按新域名重启'

  Write-Step '探测穿透（必须带 /h5/，根路径会 404）'
  if (Wait-HttpOk ($publicBase + '/h5/') 30) {
    Write-Ok ($publicBase + '/h5/')
  } else {
    Write-Warn '/h5/ 探测失败（稍后手机再试；确认前端窗口无报错）'
  }
  if (Wait-HttpOk ($publicBase + '/api/health') 30) {
    Write-Ok ($publicBase + '/api/health')
  } else {
    Write-Warn '/api/health 探测失败'
  }
} else {
  $publicBase = 'http://127.0.0.1:' + $Port
  Write-Warn '已跳过 cpolar，仅本机'
}

$homeUrl = ($publicBase.TrimEnd('/') + '/h5/')
$healthUrl = ($publicBase.TrimEnd('/') + '/api/health')
$hostOnly = ([Uri]$publicBase).Host
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$stopCmd = Join-Path $Root 'stop-mobile.cmd'

$lines = @(
  '============================================================'
  ' 钉钉报销 · 手机真机联调清单（自动生成）'
  (" 时间: " + $ts)
  '============================================================'
  ''
  '【本机已就绪】'
  ("  后端     http://127.0.0.1:" + $BackendPort)
  ("  前端     http://127.0.0.1:" + $Port + "/h5/")
  ("  公网     " + $publicBase)
)
if (-not $SkipCpolar) {
  $lines += ("  FRONTEND_URL=" + $publicBase + "（已写入 backend/.env）")
} else {
  $lines += '  FRONTEND_URL 未改（SkipCpolar）'
}
$lines += @(
  ''
  '【钉钉开放平台 · 必改 3 项】（免费 cpolar 域名每次可能变化）'
  '  1) 应用首页（务必带 /h5/，否则蓝屏 404）：'
  ("     " + $homeUrl)
  '  2) 安全域名（只填主机名，无 https://）：'
  ("     " + $hostOnly)
  '  3) 可见范围包含测试员工；电脑保持开机不休眠'
  ''
  '【手机】'
  '  钉钉 → 工作台 → 打开本微应用'
  '  应显示真实姓名（非开发测试员）→ 确认身份后使用'
  ''
  '【快捷链接】'
  ("  H5首页  " + $homeUrl)
  ("  健康检查 " + $healthUrl)
  ("  cpolar面板 http://127.0.0.1:4040/")
  ''
  '【停止】双击项目根目录:'
  ("  " + $stopCmd)
  '============================================================'
)
$checklist = ($lines -join "`r`n")
Set-Content -LiteralPath $ChecklistFile -Value $checklist -Encoding UTF8

@{
  publicBase   = $publicBase
  homeUrl      = $homeUrl
  healthUrl    = $healthUrl
  host         = $hostOnly
  cpolarPid    = $cpolarProcId
  frontendPort = $Port
  backendPort  = $BackendPort
  startedAt    = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8

try {
  Set-Clipboard -Value $homeUrl
  Write-Ok ("已复制首页到剪贴板: " + $homeUrl)
} catch {
  Write-Warn '无法写入剪贴板'
}

Write-Host ''
Write-Host $checklist -ForegroundColor White
Write-Ok ("清单已保存: " + $ChecklistFile)
try { Invoke-Item $ChecklistFile } catch {}
try {
  Start-Process $homeUrl
  Write-Ok '已在浏览器打开 H5 首页（请确认非 404）'
} catch {}
Write-Host ''
Write-Host '就绪：更新钉钉控制台首页/安全域名后，用手机钉钉打开微应用。' -ForegroundColor Green
