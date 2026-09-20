# 打包服务器托管发布包（不含 node_modules / .env / uploads / backups）
# 用法：在项目根目录
#   powershell -File .\scripts\pack-release.ps1
#   或 npm run pack:release

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

$VersionFile = Join-Path $Root 'VERSION'
if (-not (Test-Path $VersionFile)) { throw '缺少 VERSION 文件' }
$Version = (Get-Content $VersionFile -Raw).Trim()
if (-not $Version) { throw 'VERSION 为空' }

$Stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$OutDir = Join-Path $Root 'releases'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$StageName = "dingtalk-reimbursement-$Version"
$Stage = Join-Path $env:TEMP $StageName
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$ExcludeDirNames = @(
  'node_modules', 'dist', '.git', 'uploads', 'backups', 'logs',
  'releases', '.cursor', 'agent-transcripts'
)
$ExcludeFileNames = @('.env', '.env.production', '.DS_Store')
$ExcludeExt = @('.log')

function ShouldSkip([System.IO.FileSystemInfo]$Item, [string]$Relative) {
  $parts = $Relative -split '[\\/]'
  foreach ($p in $parts) {
    if ($ExcludeDirNames -contains $p) { return $true }
  }
  if ($Item -is [System.IO.FileInfo]) {
    if ($ExcludeFileNames -contains $Item.Name) { return $true }
    if ($ExcludeExt -contains $Item.Extension) { return $true }
  }
  return $false
}

Write-Host "Staging $StageName ..."
Get-ChildItem -Path $Root -Force | ForEach-Object {
  if ($_.Name -eq 'releases') { return }
  $rel = $_.Name
  if (ShouldSkip $_ $rel) { return }
  $dest = Join-Path $Stage $_.Name
  if ($_.PSIsContainer) {
    robocopy $_.FullName $dest /E /NFL /NDL /NJH /NJS /nc /ns /np `
      /XD node_modules dist .git uploads backups logs releases .cursor `
      /XF .env .env.production | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $($_.Name) code=$LASTEXITCODE" }
  } else {
    Copy-Item $_.FullName $dest -Force
  }
}

# 发布清单
$Manifest = @"
name=dingtalk-reimbursement
version=$Version
builtAt=$Stamp
phase=P5
hosting=docker-compose.prod.yml | PM2+Nginx
docs=docs/版本与服务器托管准备-v1.0.0.md
checklist=
  1. unzip to /opt/dingtalk-reimbursement (or Windows path)
  2. cp .env.production.example .env  # fill secrets
  3. docker compose -f docker-compose.prod.yml up -d --build
  4. init db + seed-prod
  5. HTTPS reverse proxy; set FRONTEND_URL
  6. DingTalk homepage + security domain
"@
Set-Content -Path (Join-Path $Stage 'RELEASE.txt') -Value $Manifest -Encoding UTF8

$ZipPath = Join-Path $OutDir "$StageName.zip"
$ZipStamp = Join-Path $OutDir "$StageName-$Stamp.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
if (Test-Path $ZipStamp) { Remove-Item -Force $ZipStamp }

Write-Host "Compressing..."
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $ZipPath -Force
Copy-Item $ZipPath $ZipStamp -Force

# SHA256
$hash = (Get-FileHash -Algorithm SHA256 $ZipPath).Hash.ToLowerInvariant()
$hashFile = Join-Path $OutDir "$StageName.sha256"
Set-Content -Path $hashFile -Value "$hash  $StageName.zip" -Encoding ASCII
Copy-Item $hashFile (Join-Path $OutDir "$StageName-$Stamp.sha256") -Force

Remove-Item -Recurse -Force $Stage

$sizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "OK version=$Version"
Write-Host "  $ZipPath ($sizeMb MB)"
Write-Host "  $ZipStamp"
Write-Host "  SHA256=$hash"
Write-Host "Upload the zip to the server, then follow docs/版本与服务器托管准备-v1.0.0.md"
