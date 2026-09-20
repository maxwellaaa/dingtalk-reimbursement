#Requires -Version 5.1
<#
.SYNOPSIS
  从 mysqldump 备份恢复数据库（支持 .sql / .sql.gz）
.EXAMPLE
  .\scripts\backup\mysql-restore.ps1 -BackupFile backups\mysql\reimbursement-20260701-120000.sql.gz
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupFile,
    [string]$EnvFile = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path $PSScriptRoot -Parent) "lib\env-loader.ps1")

if (-not (Test-Path $BackupFile)) {
    throw "Backup file not found: $BackupFile"
}

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
$mysqlBin = Get-EnvValue $fileEnv "MYSQL_BIN" "mysql"
if (-not (Get-Command $mysqlBin -ErrorAction SilentlyContinue)) {
    $candidates = @(
        "C:\Program Files\MySQL\MySQL Server 9.7\bin\mysql.exe",
        "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe",
        "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $mysqlBin = $c; break }
    }
}
if (-not (Get-Command $mysqlBin -ErrorAction SilentlyContinue) -and -not (Test-Path $mysqlBin)) {
    throw "mysql client not found. Set MYSQL_BIN in .env or add MySQL bin to PATH."
}

Write-Host "[mysql-restore] target=$dbHost:$dbPort/$dbName from=$BackupFile"
if (-not $Force) {
    $confirm = Read-Host "This will overwrite database [$dbName]. Type YES to continue"
    if ($confirm -ne "YES") {
        Write-Host "[mysql-restore] aborted"
        exit 1
    }
}

$env:MYSQL_PWD = $dbPass
try {
    $sqlText = $null
    if ($BackupFile.EndsWith(".gz")) {
        $fs = [System.IO.File]::OpenRead($BackupFile)
        $gzip = New-Object System.IO.Compression.GZipStream($fs, [IO.Compression.CompressionMode]::Decompress)
        $reader = New-Object System.IO.StreamReader($gzip, [Text.Encoding]::UTF8)
        $sqlText = $reader.ReadToEnd()
        $reader.Close()
    }
    else {
        $sqlText = Get-Content $BackupFile -Raw -Encoding UTF8
    }

    $sqlText | & $mysqlBin -h $dbHost -P $dbPort -u $dbUser $dbName
    Write-Host "[mysql-restore] done"
}
finally {
    Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
}
