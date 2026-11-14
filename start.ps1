param(
    [string]$ListenUrl = 'http://127.0.0.1:5080',
    [switch]$SkipWebBuild,
    [switch]$ForceRestart,
    [string]$NpmRegistry = 'https://registry.npmjs.org/'
)
# 控制台统一用 UTF-8 输出，避免中文在 ConPTY、Windows Terminal、VS Code 里乱码。
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

$ErrorActionPreference = 'Stop'

$projectFile = Join-Path $PSScriptRoot 'backend/WcsGateway/WcsGateway.csproj'
$webDir = Join-Path $PSScriptRoot 'web'
$appEntry = Join-Path $PSScriptRoot 'app/index.html'

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-PortOwners([int]$Port) {
    try {
        return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
    }
    catch {
        $lines = netstat -ano | Select-String ":$Port\s" | Select-String 'LISTENING'
        return @($lines | ForEach-Object { ($_ -split '\s+')[-1] } | Where-Object { $_ -match '^\d+$' } | Select-Object -Unique)
    }
}

# 端口预检：旧实例没停就启动，dotnet 会因端口占用直接报错退出，窗口一闪而过看不到原因。
$port = ([uri]$ListenUrl).Port
if ($port -le 0) { $port = 5080 }
$owners = Get-PortOwners $port
if ($owners -and $owners.Count -gt 0) {
    $names = @($owners | ForEach-Object {
        $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($proc) { "$($proc.ProcessName)(PID $_)" } else { "PID $_" }
    }) -join '、'
    if ($ForceRestart) {
        Write-Host "端口 $port 已被 $names 占用，-ForceRestart：先结束旧实例..."
        $owners | ForEach-Object { Stop-Process -Id $_ -Force -Confirm:$false -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 800
    }
    else {
        Write-Host ''
        Write-Warning "端口 $port 已被 $names 占用，本次启动已取消（否则会因端口冲突直接退出）。"
        Write-Host '  结束旧实例 : .\stop.ps1'
        Write-Host '  自动重启   : .\start.ps1 -ForceRestart'
        Write-Host "  换端口启动 : .\start.ps1 -ListenUrl http://127.0.0.1:$($port + 1)"
        exit 1
    }
}

# 前端构建：web/（Vite + Vue 3）-> app/，由网关作为站点首页托管。
$webStatus = '跳过（-SkipWebBuild）'
if (-not $SkipWebBuild) {
    if (-not (Test-Path (Join-Path $webDir 'package.json'))) {
        $webStatus = '跳过（未找到 web/package.json）'
    }
    elseif (-not (Test-Command 'npm')) {
        $webStatus = '跳过（未安装 Node.js/npm）'
        Write-Warning '未找到 npm，跳过前端构建，将使用 app/ 中已有产物；没有产物时回退旧版页面。'
    }
    else {
        Push-Location $webDir
        try {
            if (-not (Test-Path (Join-Path $webDir 'node_modules'))) {
                Write-Host '安装前端依赖（首次运行，需要能访问 npm 源）...'
                & npm install --no-audit --no-fund "--registry=$NpmRegistry"
                if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
            }
            Write-Host '构建三维页面：web/ -> app/'
            & npm run build
            if ($LASTEXITCODE -ne 0) { throw 'npm run build 失败' }
            $webStatus = '成功'
        }
        catch {
            $webStatus = "失败（$($_.Exception.Message)）"
            Write-Warning "前端构建失败，继续使用已有 app/ 产物；没有产物时回退旧版页面。$($_.Exception.Message)"
        }
        finally { Pop-Location }
    }
}

if (-not (Test-Path $appEntry)) {
    Write-Warning '未找到 app/index.html，网关首页将回退到旧版单页 index.html。'
}

$base = $ListenUrl.TrimEnd('/')
Write-Host ""
Write-Host "前端构建 : $webStatus"
Write-Host "三维现场 : $base/index.html"
Write-Host "旧版单页 : $base/legacy.html"
Write-Host "设备配置 : $base/devices"
Write-Host "模拟 PLC : $base/simulator"
Write-Host "首次登录 : 超级账号 sa（初始密码见 README，请登录后立即修改）"
Write-Host ""
Write-Host "停止服务 : 本窗口按 Ctrl+C，或另开窗口执行 .\stop.ps1"
Write-Host "提示     : 本地模拟 PLC 未启动时，控制台会周期性打印 S7 connection failed，"
Write-Host "           这是网关在重连，不影响三维页面打开和演示。"
Write-Host ""

& dotnet run --project $projectFile -- "--Gateway:ListenUrl=$ListenUrl"
exit $LASTEXITCODE
