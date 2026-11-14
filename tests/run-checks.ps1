param()
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runDirectory = Join-Path $PSScriptRoot ('artifacts/run-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$gatewayProcess = $null
$previousGatewayUrl = $env:S7_GATEWAY_URL
Push-Location $workspaceRoot
try {
    & dotnet build backend/WcsGateway/WcsGateway.csproj -p:UseAppHost=false -o "$runDirectory/gateway"
    if ($LASTEXITCODE -ne 0) { throw 'Gateway build failed.' }
    & dotnet run --project tests/WcsGateway.Checks/WcsGateway.Checks.csproj
    if ($LASTEXITCODE -ne 0) { throw 'Profile/storage checks failed.' }
    & node tests/validate-layout.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Scene regression checks failed.' }
    & node tests/validate-rendering.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Rendering lifecycle checks failed.' }

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $testPort = $listener.LocalEndpoint.Port
    $listener.Stop()
    $env:S7_GATEWAY_URL = "http://127.0.0.1:$testPort"
    $assemblyFile = Join-Path $runDirectory 'gateway/WcsGateway.dll'
    $storeFile = Join-Path $runDirectory 'connections.json'
    $profileFile = Join-Path $workspaceRoot 'backend/WcsGateway/config/plc-profiles.json'
    $gatewayArguments = @(
        ('"' + $assemblyFile + '"'),
        "--Gateway:ListenUrl=$env:S7_GATEWAY_URL",
        ('"--Gateway:ConfigFile=' + $storeFile + '"'),
        ('"--Gateway:ProfilesFile=' + $profileFile + '"')
    )
    $gatewayProcess = Start-Process -FilePath dotnet -ArgumentList $gatewayArguments -PassThru -WindowStyle Hidden `
        -WorkingDirectory (Join-Path $workspaceRoot 'backend/WcsGateway') `
        -RedirectStandardOutput (Join-Path $runDirectory 'gateway.out.log') `
        -RedirectStandardError (Join-Path $runDirectory 'gateway.err.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($gatewayProcess.HasExited) { throw "Gateway exited; see $runDirectory" }
        try {
            $health = Invoke-RestMethod "$env:S7_GATEWAY_URL/api/health" -TimeoutSec 1
            if ($health.status -eq 'ok') { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 100 }
    }
    if (!$ready) { throw "Gateway did not become ready; see $runDirectory" }
    & node tests/validate-s7-api.cjs
    if ($LASTEXITCODE -ne 0) { throw 'S7 API checks failed.' }
    & node tests/validate-s7-profiles.cjs
    if ($LASTEXITCODE -ne 0) { throw 'S7 protocol integration checks failed.' }
    & node tests/validate-s7-simulator.cjs $env:S7_GATEWAY_URL
    if ($LASTEXITCODE -ne 0) { throw 'Local S7 simulator checks failed.' }
    & node tests/validate-s7-simulator-fleet.cjs $env:S7_GATEWAY_URL
    if ($LASTEXITCODE -ne 0) { throw 'Local S7 simulator fleet checks failed.' }
    & node tests/validate-s7-conveyor.cjs $env:S7_GATEWAY_URL
    if ($LASTEXITCODE -ne 0) { throw 'Conveyor S7 simulation checks failed.' }
    Write-Host "All checks passed. Isolated logs: $runDirectory"
} finally {
    if ($gatewayProcess -and !$gatewayProcess.HasExited) { Stop-Process -Id $gatewayProcess.Id }
    $env:S7_GATEWAY_URL = $previousGatewayUrl
    Pop-Location
}

