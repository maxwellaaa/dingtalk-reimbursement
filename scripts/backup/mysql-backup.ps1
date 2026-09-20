#Requires -Version 5.1
<#
.SYNOPSIS
  MySQL 逻辑备份（mysqldump + 可选 gzip），按天数保留
.PARAMETER DryRun
  仅打印将执行的命令，不写入文件
.EXAMPLE
  .\scripts\backup\mysql-backup.ps1 -EnvFile backend\.env
  .\scripts\backup\mysql-backup.ps1 -DryRun
#>
param(
    [string]$EnvFile = "",
    [string]$BackupDir = "",
    [int]$RetentionDays = 0,
    [switch]$NoCompress,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path $PSScriptRoot -Parent) "lib\env-loader.ps1")

$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $EnvFile) {
    foreach ($c in @(
        Join-Path $Root ".env",
        Join-Path $Root "backend\.env"
    )) {
        if (Test-Path $c) { $EnvFile = $c; break }
    }
}
$fileEnv = if ($EnvFile -and (Test-Path $EnvFile)) { Import-EnvFile -Path $EnvFile } else { @{} }

$dbHost = Get-EnvValue $fileEnv "DB_HOST" "127.0.0.1"
$dbPort = Get-EnvValue $fileEnv "DB_PORT" "3306"
$dbUser = Get-EnvValue $fileEnv "DB_USER" "reimb"
$dbPass = Get-EnvValue $fileEnv "DB_PASSWORD" ""
$dbName = Get-EnvValue $fileEnv "DB_NAME" "reimbursement"
if (-not $BackupDir) {
    $BackupDir = Get-EnvValue $fileEnv "BACKUP_DIR" (Join-Path $Root "backups\mysql")
}
if ($RetentionDays -le 0) {
    $RetentionDays = [int](Get-EnvValue $fileEnv "BACKUP_RETENTION_DAYS" "14")
}
$dumpBin = Get-EnvValue $fileEnv "MYSQLDUMP_BIN" "mysqldump"
if (-not (Get-Command $dumpBin -ErrorAction SilentlyContinue)) {
    $candidates = @(
        "C:\Program Files\MySQL\MySQL Server 9.7\bin\mysqldump.exe",
        "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
        "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $dumpBin = $c; break }
    }
}
if (-not (Get-Command $dumpBin -ErrorAction SilentlyContinue) -and -not (Test-Path $dumpBin)) {
    throw "mysqldump not found. Set MYSQLDUMP_BIN in .env or add MySQL bin to PATH."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $BackupDir "${dbName}-${stamp}.sql"
if (-not $NoCompress) { $outFile += ".gz" }

Write-Host "[mysql-backup] host=$dbHost port=$dbPort db=$dbName user=$dbUser"
Write-Host "[mysql-backup] output=$outFile retention=${RetentionDays}d"

if ($DryRun) {
    Write-Host "[mysql-backup] DRY RUN — no files written"
    exit 0
}

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$env:MYSQL_PWD = $dbPass
try {
    $dumpArgs = @(
        "-h", $dbHost,
        "-P", $dbPort,
        "-u", $dbUser,
        "--single-transaction",
        "--routines",
        "--triggers",
        "--set-gtid-purged=OFF",
        "--no-tablespaces",
        $dbName
    )

    if ($NoCompress) {
        & $dumpBin @dumpArgs | Set-Content -Path $outFile -Encoding UTF8
    }
    else {
        $sqlPath = Join-Path $BackupDir "${dbName}-${stamp}.sql"
        & $dumpBin @dumpArgs | Set-Content -Path $sqlPath -Encoding UTF8
        $bytes = [System.IO.File]::ReadAllBytes($sqlPath)
        $ms = New-Object System.IO.MemoryStream
        $gzip = New-Object System.IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
        $gzip.Write($bytes, 0, $bytes.Length)
        $gzip.Close()
        [System.IO.File]::WriteAllBytes($outFile, $ms.ToArray())
        Remove-Item $sqlPath -Force
    }

    $sizeKb = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
    Write-Host "[mysql-backup] done size=${sizeKb}KB"

    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem $BackupDir -Filter "${dbName}-*" | Where-Object {
        $_.LastWriteTime -lt $cutoff
    } | ForEach-Object {
        Write-Host "[mysql-backup] prune $($_.Name)"
        Remove-Item $_.FullName -Force
    }
}
finally {
    Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
}
