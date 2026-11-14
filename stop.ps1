param(
    [string]$ListenUrl = 'http://127.0.0.1:5080'
)
# 控制台统一用 UTF-8 输出，避免中文在 ConPTY、Windows Terminal、VS Code 里乱码。
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

$ErrorActionPreference = 'Stop'

$port = ([uri]$ListenUrl).Port
if ($port -le 0) { $port = 5080 }

function Get-PortOwners([int]$Port) {
    try {
        return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
    }
    catch {
        # 老系统没有 Get-NetTCPConnection 时退回 netstat 解析。
        $lines = netstat -ano | Select-String ":$Port\s" | Select-String 'LISTENING'
        return @($lines | ForEach-Object { ($_ -split '\s+')[-1] } | Where-Object { $_ -match '^\d+$' } | Select-Object -Unique)
    }
}

$owners = Get-PortOwners $port
if (-not $owners -or $owners.Count -eq 0) {
    Write-Host "端口 $port 没有在监听，服务已经停了。"
}
else {
    foreach ($ownerPid in $owners) {
        $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { 'unknown' }
        try {
            Stop-Process -Id $ownerPid -Force -Confirm:$false
            Write-Host "已停止 $name (PID $ownerPid)"
        }
        catch {
            Write-Warning "停止 PID $ownerPid 失败：$($_.Exception.Message)"
        }
    }
    Start-Sleep -Milliseconds 500
    $left = Get-PortOwners $port
    if ($left -and $left.Count -gt 0) {
        Write-Warning "端口 $port 仍被占用（PID $($left -join ', ')），请用管理员身份再执行一次。"
        exit 1
    }
    Write-Host "端口 $port 已释放。"
}

Write-Host "重新启动：.\start.ps1"
