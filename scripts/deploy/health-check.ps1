#Requires -Version 5.1
<#
.SYNOPSIS
  检查后端 /api/health 与可选前端 /healthz
.EXAMPLE
  .\scripts\deploy\health-check.ps1 -BackendUrl http://localhost:3000 -FrontendUrl http://localhost:8080
#>
param(
    [string]$BackendUrl = "http://localhost:3000",
    [string]$FrontendUrl = ""
)

$ErrorActionPreference = "Stop"
$failed = $false

function Test-Endpoint {
    param([string]$Name, [string]$Url, [scriptblock]$Validate)
    try {
        $resp = Invoke-RestMethod -Uri $Url -TimeoutSec 10
        & $Validate $resp
        Write-Host "[health-check] OK $Name -> $Url"
    }
    catch {
        Write-Host "[health-check] FAIL $Name -> $Url : $($_.Exception.Message)" -ForegroundColor Red
        $script:failed = $true
    }
}

Test-Endpoint -Name "backend" -Url "$BackendUrl/api/health" -Validate {
    param($r)
    if (-not $r.ok) { throw "ok=false" }
    if (-not $r.db) { throw "db=false" }
    Write-Host "  phase=$($r.phase) db=$($r.db)"
}

if ($FrontendUrl) {
    try {
        $r = Invoke-WebRequest -Uri "$FrontendUrl/healthz" -TimeoutSec 10 -UseBasicParsing
        if ($r.StatusCode -ne 200) { throw "status $($r.StatusCode)" }
        Write-Host "[health-check] OK frontend -> $FrontendUrl/healthz"
    }
    catch {
        Write-Host "[health-check] FAIL frontend -> $FrontendUrl/healthz : $($_.Exception.Message)" -ForegroundColor Red
        $failed = $true
    }
}

if ($failed) { exit 1 }
Write-Host "[health-check] all passed"
