#Requires -Version 5.1
<#
.SYNOPSIS
  打包 backend/uploads 目录（发票附件）
.EXAMPLE
  .\scripts\backup\backup-uploads.ps1
  .\scripts\backup\backup-uploads.ps1 -DryRun
#>
param(
    [string]$UploadsDir = "",
    [string]$BackupDir = "",
    [int]$RetentionDays = 0,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path $PSScriptRoot -Parent) "lib\env-loader.ps1")

$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$envPath = Join-Path $Root "backend\.env"
$fileEnv = if (Test-Path $envPath) { Import-EnvFile -Path $envPath } else { @{} }

if (-not $UploadsDir) {
    $rel = Get-EnvValue $fileEnv "UPLOAD_DIR" "uploads"
    $UploadsDir = Join-Path $Root "backend\$rel"
}
if (-not $BackupDir) {
    $BackupDir = Get-EnvValue $fileEnv "BACKUP_DIR" (Join-Path $Root "backups\uploads")
}
if ($RetentionDays -le 0) {
    $RetentionDays = [int](Get-EnvValue $fileEnv "BACKUP_RETENTION_DAYS" "14")
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zipFile = Join-Path $BackupDir "uploads-$stamp.zip"

Write-Host "[backup-uploads] source=$UploadsDir"
Write-Host "[backup-uploads] output=$zipFile retention=${RetentionDays}d"

if (-not (Test-Path $UploadsDir)) {
    Write-Host "[backup-uploads] uploads dir missing, creating empty backup marker"
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
        New-Item -ItemType File -Path (Join-Path $BackupDir "uploads-$stamp.empty") -Force | Out-Null
    }
    exit 0
}

if ($DryRun) {
    Write-Host "[backup-uploads] DRY RUN"
    exit 0
}

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
Compress-Archive -Path (Join-Path $UploadsDir "*") -DestinationPath $zipFile -Force
Write-Host "[backup-uploads] done size=$([math]::Round((Get-Item $zipFile).Length/1MB,2))MB"

$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem $BackupDir -Filter "uploads-*" | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
    Write-Host "[backup-uploads] prune $($_.Name)"
    Remove-Item $_.FullName -Force
}
