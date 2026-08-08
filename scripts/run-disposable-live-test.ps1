param(
  [int]$Port = 3100
)

$ErrorActionPreference = "Stop"
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$disposablePath = Join-Path $tempRoot ("sitescout-disposable-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $disposablePath | Out-Null
$resolvedDisposable = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $disposablePath).Path)
$safeName = [System.IO.Path]::GetFileName($resolvedDisposable).StartsWith("sitescout-disposable-", [System.StringComparison]::Ordinal)
$insideTemp = $resolvedDisposable.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)
if (-not $insideTemp -or -not $safeName) { throw "Disposable state path failed safety validation." }

$stdoutPath = Join-Path $resolvedDisposable "server.out.log"
$stderrPath = Join-Path $resolvedDisposable "server.err.log"
$preexistingProcessIds = @(Get-Process -Name node, cmd, workerd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$server = $null

try {
  $env:QUALITY_LOCAL_STATE_PATH = Join-Path $resolvedDisposable "state"
  $env:QUALITY_DISABLE_INSPECTOR = "true"
  $env:QUALITY_AUTH_MODE = "local-test"
  $env:MINIFLARE_REGISTRY_PATH = Join-Path $resolvedDisposable "registry"
  $env:WRANGLER_LOG_PATH = Join-Path $resolvedDisposable "logs"
  $env:QUALITY_REPORTER_EMAILS = "reporter1@pilot.invalid,reporter2@pilot.invalid,reporter3@pilot.invalid,reporter4@pilot.invalid,reporter5@pilot.invalid"
  $env:QUALITY_VALIDATOR_EMAILS = "validator1@pilot.invalid,validator2@pilot.invalid"
  $env:QUALITY_FINDING_OWNER_EMAILS = "owner1@pilot.invalid,owner2@pilot.invalid"
  $env:QUALITY_ADMIN_EMAILS = "admin1@pilot.invalid,admin2@pilot.invalid"
  $env:QUALITY_SECURITY_REVIEWER_EMAILS = "security1@pilot.invalid,security2@pilot.invalid"
  $env:QUALITY_SECURITY_IMPORT_TARGET_IDS = "sample-shop-staging"
  $env:QUALITY_SECURITY_ARTIFACT_RETENTION_DAYS = "30"
  $projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $childCommand = "npm.cmd run dev -- --port $Port 1>`"$stdoutPath`" 2>`"$stderrPath`""
  $server = Start-Process -FilePath $env:ComSpec -ArgumentList "/d", "/s", "/c", $childCommand -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/api/health" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) {
    Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
    Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue
    throw "Disposable Site Scout server did not become healthy."
  }

  $env:QUALITY_TEST_URL = "http://localhost:$Port"
  $env:QUALITY_LIVE_MUTATION_OK = "disposable"
  & node (Join-Path $projectPath "tests\live-api-smoke.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Disposable live API test failed with exit code $LASTEXITCODE." }
  & node (Join-Path $projectPath "tests\synthetic-pilot.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Disposable ten-user pilot failed with exit code $LASTEXITCODE." }
  & node (Join-Path $projectPath "tests\security-import-live.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Disposable Strix import workflow failed with exit code $LASTEXITCODE." }
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
  Write-Output "Disposed isolated Site Scout test state: $resolvedDisposable"
}
