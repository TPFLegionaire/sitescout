param(
  [int]$Port = 3101
)

$ErrorActionPreference = "Stop"
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$disposablePath = Join-Path $tempRoot ("sitescout-preview-disposable-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $disposablePath | Out-Null
$resolvedDisposable = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $disposablePath).Path)
$safeName = [System.IO.Path]::GetFileName($resolvedDisposable).StartsWith("sitescout-preview-disposable-", [System.StringComparison]::Ordinal)
$insideTemp = $resolvedDisposable.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)
if (-not $insideTemp -or -not $safeName) { throw "Disposable preview path failed safety validation." }

$stdoutPath = Join-Path $resolvedDisposable "server.out.log"
$stderrPath = Join-Path $resolvedDisposable "server.err.log"
$preexistingProcessIds = @(Get-Process -Name node, cmd, workerd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$server = $null

try {
  $env:QUALITY_LOCAL_STATE_PATH = Join-Path $resolvedDisposable "state"
  $env:QUALITY_DISABLE_INSPECTOR = "true"
  $env:MINIFLARE_REGISTRY_PATH = Join-Path $resolvedDisposable "registry"
  $env:WRANGLER_LOG_PATH = Join-Path $resolvedDisposable "logs"
  $env:QUALITY_PUBLIC_DEMO = "true"
  $env:QUALITY_AI_ASSIST_ENABLED = "false"
  $projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $childCommand = "npm.cmd run dev -- --port $Port 1>`"$stdoutPath`" 2>`"$stderrPath`""
  $server = Start-Process -FilePath $env:ComSpec -ArgumentList "/d", "/s", "/c", $childCommand -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/api/health" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) {
    Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
    Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue
    throw "Disposable public preview server did not become healthy."
  }

  $env:QUALITY_TEST_URL = "http://localhost:$Port"
  $env:QUALITY_LIVE_MUTATION_OK = "disposable"
  & node (Join-Path $projectPath "tests\public-preview-live.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Disposable public preview test failed with exit code $LASTEXITCODE." }
} finally {
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $ownedProcesses = @(Get-Process -Name node, cmd, workerd -ErrorAction SilentlyContinue | Where-Object { $preexistingProcessIds -notcontains $_.Id })
    foreach ($ownedProcess in $ownedProcesses) { Stop-Process -Id $ownedProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue }
    $remainingOwned = @(Get-Process -Name node, cmd, workerd -ErrorAction SilentlyContinue | Where-Object { $preexistingProcessIds -notcontains $_.Id })
    if (-not $remainingOwned.Count -and -not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
  }
  Start-Sleep -Milliseconds 750
  for ($attempt = 0; $attempt -lt 12; $attempt++) {
    try {
      if (Test-Path -LiteralPath $resolvedDisposable) { Remove-Item -LiteralPath $resolvedDisposable -Recurse -Force -ErrorAction Stop }
      break
    } catch {
      if ($attempt -eq 11) { throw }
      Start-Sleep -Milliseconds 500
    }
  }
  Write-Output "Disposed isolated public preview state: $resolvedDisposable"
}
