<#
.SYNOPSIS
    Set up and start the whole application. One command, from a fresh clone.

.DESCRIPTION
    Checks prerequisites, creates the Python virtual environment, installs both
    halves' dependencies, starts the backend, waits for it to answer, then
    starts the frontend and opens a browser. Ctrl-C stops both.

    Everything is idempotent -- run it again and it skips whatever is already
    done, so this is both the first-run setup and the everyday launcher.

.PARAMETER Offline
    Serve chain data from committed fixtures instead of calling mempool.space.

    Live mode (the default) analyses any address. Offline mode only has chain
    data for the addresses in backend\data\demo_addresses.json, so anything else
    returns its list hits with an empty profile and an empty graph -- correct,
    but it looks broken. Use -Offline on demo day, after running
    scripts\warm_cache.py to bake in the addresses you plan to show.

.PARAMETER SkipInstall
    Skip dependency installation. Faster restarts once everything is in place.

.EXAMPLE
    .\start.ps1
    Live lookups. What you want while developing or exploring real addresses.

.EXAMPLE
    .\start.ps1 -Offline
    Fixture-backed. No network calls at all. What you want on stage.
#>

[CmdletBinding()]
param(
    [switch]$Offline,
    [switch]$SkipInstall,
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Write-Step { param($m) Write-Host "`n=== $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "  OK   $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  WARN $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "  FAIL $m" -ForegroundColor Red }

$backend = Join-Path $PSScriptRoot 'backend'
$frontend = Join-Path $PSScriptRoot 'frontend'
$venv = Join-Path $backend '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
$backendProcess = $null

# ---------------------------------------------------------------- prerequisites
Write-Step '1. Prerequisites'

# `python` on a machine without Python is a Microsoft Store stub that prints a
# help message and exits 9009 rather than failing loudly, so Get-Command finding
# something is not proof Python exists. Actually run it and check the output.
$pythonCmd = $null
foreach ($candidate in @('python', 'python3', 'py')) {
    $found = Get-Command $candidate -ErrorAction SilentlyContinue
    if (-not $found) { continue }
    $version = & $candidate --version 2>&1 | Out-String
    if ($version -match 'Python (\d+)\.(\d+)') {
        if ([int]$Matches[1] -ge 3 -and [int]$Matches[2] -ge 10) {
            $pythonCmd = $candidate
            Write-Ok "$($version.Trim()) ($candidate)"
            break
        }
        Write-Warn "$($version.Trim()) is too old; 3.10+ required"
    }
}

if (-not $pythonCmd) {
    Write-Err 'Python 3.10+ not found'
    Write-Host @'

  Install from https://www.python.org/downloads/ -- NOT the Microsoft Store --
  and tick "Add python.exe to PATH" on the first installer screen. That
  checkbox is off by default and is the usual cause of this.

  Then close this window and open a new one; PATH changes do not reach a
  terminal that is already running.

  If it still fails, turn off the Store alias:
    Settings > Apps > Advanced app settings > App execution aliases
    > toggle off python.exe and python3.exe

'@ -ForegroundColor Gray
    exit 1
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Err 'Node.js not found'
    Write-Host "`n  Install the LTS build from https://nodejs.org/`n" -ForegroundColor Gray
    exit 1
}
$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion -split '\.')[0]
$nodeMinor = [int]($nodeVersion -split '\.')[1]
# Vite 7 needs 20.19+ or 22.12+. Anything older fails during `npm install` with
# an error that does not mention the version, so check it here instead.
$nodeOk = ($nodeMajor -eq 20 -and $nodeMinor -ge 19) -or ($nodeMajor -eq 22 -and $nodeMinor -ge 12) -or ($nodeMajor -gt 22)
if ($nodeOk) {
    Write-Ok "Node $nodeVersion"
} else {
    Write-Warn "Node $nodeVersion may be too old for Vite 7 (needs 20.19+ or 22.12+)"
}

# ---------------------------------------------------------------- backend setup
Write-Step '2. Backend environment'

if (-not (Test-Path $venvPython)) {
    Write-Host '  Creating virtual environment (one-off, ~15s)...'
    & $pythonCmd -m venv $venv
    if (-not (Test-Path $venvPython)) {
        Write-Err "venv creation failed - no interpreter at $venvPython"
        exit 1
    }
    Write-Ok 'virtual environment created'
} else {
    Write-Ok 'virtual environment present'
}

if (-not $SkipInstall) {
    Write-Host '  Installing Python dependencies...'
    & $venvPython -m pip install --quiet --upgrade pip
    & $venvPython -m pip install --quiet -r (Join-Path $backend 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { Write-Err 'pip install failed'; exit 1 }
    Write-Ok 'fastapi, uvicorn, httpx, pydantic, pytest'
} else {
    Write-Ok 'dependency install skipped'
}

# ---------------------------------------------------------------- frontend setup
Write-Step '3. Frontend environment'

if (-not $SkipInstall -and -not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host '  Installing npm packages (one-off, ~60s)...'
    Push-Location $frontend
    try {
        & npm install --silent
        if ($LASTEXITCODE -ne 0) { Write-Err 'npm install failed'; exit 1 }
    } finally { Pop-Location }
    Write-Ok 'node_modules installed'
} elseif (Test-Path (Join-Path $frontend 'node_modules')) {
    Write-Ok 'node_modules present'
} else {
    Write-Ok 'dependency install skipped'
}

# ---------------------------------------------------------------- start backend
Write-Step '4. Starting backend'

$mode = if ($Offline) { '1' } else { '0' }
$env:OFFLINE_MODE = $mode
$env:PYTHONUNBUFFERED = '1'

if ($Offline) {
    Write-Ok 'OFFLINE_MODE=1 - fixtures only, no network calls'
    Write-Warn 'Addresses without a committed fixture return list hits and an empty profile.'
} else {
    Write-Ok 'OFFLINE_MODE=0 - live lookups against mempool.space'
}

# Start-Process rather than a background job: a job runs in a child runspace
# that does not inherit $env, and uvicorn would come up in the wrong mode.
$backendProcess = Start-Process -FilePath $venvPython `
    -ArgumentList @('-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', $BackendPort) `
    -WorkingDirectory $backend -PassThru -NoNewWindow

# Everything below runs inside try/finally so the backend is always reaped,
# whether the frontend exits cleanly, crashes, or you press Ctrl-C.
try {
    Write-Host '  Waiting for the backend to answer...'
    $healthy = $false
    foreach ($attempt in 1..40) {
        if ($backendProcess.HasExited) {
            Write-Err "backend exited early (code $($backendProcess.ExitCode))"
            Write-Host "`n  Port $BackendPort may already be in use. Check with:" -ForegroundColor Gray
            Write-Host "    Get-NetTCPConnection -LocalPort $BackendPort | Select-Object OwningProcess`n" -ForegroundColor Gray
            exit 1
        }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/health" -TimeoutSec 2
            $healthy = $true
            break
        } catch { Start-Sleep -Milliseconds 500 }
    }

    if (-not $healthy) {
        Write-Err "backend did not answer on port $BackendPort within 20s"
        exit 1
    }

    Write-Ok "backend live on http://127.0.0.1:$BackendPort"
    foreach ($name in $health.sources.PSObject.Properties.Name) {
        $source = $health.sources.$name
        if ($null -ne $source.records) {
            Write-Host "       $($name.PadRight(16)) $($source.records) records" -ForegroundColor DarkGray
        }
    }
    # /api/health reports "degraded" whenever a snapshot has no recorded
    # retrieval time, which is the shipped state. It does not mean analyses are
    # failing -- but say so, rather than letting a red word go unexplained.
    if ($health.status -ne 'ok') {
        Write-Warn "health reports '$($health.status)' - snapshot provenance is unrecorded."
        Write-Host '       Analyses still work. Clear it with: python scripts\refresh_data.py' -ForegroundColor DarkGray
    }

    # ------------------------------------------------------------ start frontend
    Write-Step '5. Starting frontend'
    Write-Host ''
    Write-Host "  Application  ->  http://localhost:$FrontendPort" -ForegroundColor Green
    Write-Host "  API docs     ->  http://127.0.0.1:$BackendPort/docs" -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Ctrl-C stops both.' -ForegroundColor DarkGray
    Write-Host ''

    Start-Job -ScriptBlock {
        param($url)
        Start-Sleep -Seconds 4
        Start-Process $url
    } -ArgumentList "http://localhost:$FrontendPort" | Out-Null

    $env:BACKEND_URL = "http://127.0.0.1:$BackendPort"
    $env:PORT = $FrontendPort

    # Foreground and blocking, so this script stays alive as long as the app does.
    Push-Location $frontend
    try { & npm run dev } finally { Pop-Location }
}
finally {
    Write-Host "`n  Shutting down..." -ForegroundColor DarkGray
    if ($backendProcess -and -not $backendProcess.HasExited) {
        # Kill the tree: uvicorn's reloader and workers are children, and
        # leaving them behind means port 8000 is still bound on the next run.
        & taskkill /PID $backendProcess.Id /T /F 2>&1 | Out-Null
    }
    Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
    Write-Host '  Stopped.' -ForegroundColor DarkGray
}