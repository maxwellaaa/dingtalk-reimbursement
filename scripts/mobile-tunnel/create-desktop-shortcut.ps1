#Requires -Version 5.1
# Create desktop shortcut -> start-mobile.cmd
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Target = Join-Path $Root 'start-mobile.cmd'
if (-not (Test-Path -LiteralPath $Target)) { throw "Missing: $Target" }

$Desktop = [Environment]::GetFolderPath('Desktop')
$LnkPath = Join-Path $Desktop 'DingTalk-Reimburse-Mobile.lnk'
$Wsh = New-Object -ComObject WScript.Shell
$Sc = $Wsh.CreateShortcut($LnkPath)
$Sc.TargetPath = $Target
$Sc.WorkingDirectory = $Root
$Sc.WindowStyle = 1
$Sc.Description = 'DingTalk reimburse mobile: backend + frontend + cpolar'
$Sc.Save()
Write-Host ('Desktop shortcut OK: ' + $LnkPath) -ForegroundColor Green
