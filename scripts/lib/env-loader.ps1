# 从 .env 加载键值（忽略注释与空行）
function Import-EnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) { return @{} }
    $map = @{}
    Get-Content $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $idx = $line.IndexOf('=')
        if ($idx -lt 1) { return }
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        if ($val.StartsWith('"') -and $val.EndsWith('"')) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        $map[$key] = $val
    }
    return $map
}

function Get-EnvValue {
    param(
        [hashtable]$FileEnv,
        [string]$Name,
        [string]$Default = ''
    )
    $fromProcess = [Environment]::GetEnvironmentVariable($Name)
    if ($fromProcess) { return $fromProcess }
    if ($FileEnv.ContainsKey($Name)) { return $FileEnv[$Name] }
    return $Default
}
