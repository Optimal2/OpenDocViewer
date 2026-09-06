#requires -Version 5.1
<#
.SYNOPSIS
    Local pre-push CI gate for the OpenDocViewer repository.

.DESCRIPTION
    This is a public repository; CI runs automatically on push, but still run
    locally before pushing to catch build breaks and version lockstep issues.

    Steps:
      1. Build the web application: npm run build
      2. Validate version lockstep: scripts/omp/validate-component-versions.ps1
      3. Verify generated agent documentation is fresh: npm run doc:agent,
         then fail if docs-agent differs from the committed output

    Exit code 0 if all steps pass, 1 if any fail.

.PARAMETER BaseCommit
    Git ref the version validator diffs against. Defaults to origin/main;
    pass another ref when the default branch is named differently or the
    remote-tracking ref is stale and you want to compare against a fresh one.
#>
[CmdletBinding()]
param(
    [string]$BaseCommit = 'origin/main'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Validator = Join-Path (Join-Path (Join-Path $RepoRoot 'scripts') 'omp') 'validate-component-versions.ps1'

# --- Local-ci telemetry (best-effort; never changes the gate's exit code) ----
# One compact JSONL line per run under
# %APPDATA%\@private\ai-orchestrator\local-ci-telemetry\OpenDocViewer.jsonl.
# This gate has NO test step (npm build only): test_count is explicitly null
# with a reason, never zero. No TRX file is ever produced or parsed here, so
# the helper's TRX counter path and the 'unreadable-trx' status do not apply.
$localCiTimer = [System.Diagnostics.Stopwatch]::StartNew()
$buildDurationMs = $null
$telemetryTestStatus = 'not-run'
$telemetrySkipReason = 'no test step in local CI (npm build only)'
$telemetryHelperPath = Join-Path (Join-Path $RepoRoot 'scripts') 'local-ci-telemetry.ps1'
if (Test-Path -LiteralPath $telemetryHelperPath -PathType Leaf) {
    try {
        . $telemetryHelperPath
    }
    catch {
        Write-Warning "Local-ci telemetry helper for OpenDocViewer could not be loaded: $($_.Exception.Message)"
    }
}
else {
    Write-Warning 'Local-ci telemetry helper not found (scripts\local-ci-telemetry.ps1); this run writes no telemetry.'
}

$overallSuccess = $true

function Write-StepResult {
    param(
        [string]$StepName,
        [bool]$Passed
    )
    if ($Passed) {
        Write-Host "PASS: $StepName" -ForegroundColor Green
    }
    else {
        Write-Host "FAIL: $StepName" -ForegroundColor Red
    }
}

try {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "OpenDocViewer Local CI Gate" -ForegroundColor Cyan
    Write-Host "Repository root: $RepoRoot" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    # --- Step 1: Build web app -------------------------------------------------
    $buildPassed = $false
    $buildStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Write-Host "[1/3] Building web application: npm run build" -ForegroundColor Cyan
        Push-Location $RepoRoot
        try {
            # npm.cmd sets $LASTEXITCODE, but reset it first so a stale value
            # from an earlier native call can never be mistaken for the build
            # verdict if npm itself fails to launch.
            $global:LASTEXITCODE = 0
            & npm run build
            if ($LASTEXITCODE -eq 0) {
                $buildPassed = $true
            }
        }
        finally {
            Pop-Location
        }
    }
    catch {
        Write-Host "Build step threw an exception: $_" -ForegroundColor Red
        $buildPassed = $false
    }
    $buildStopwatch.Stop()
    $buildDurationMs = $buildStopwatch.ElapsedMilliseconds
    Write-StepResult -StepName "Build" -Passed $buildPassed
    if (-not $buildPassed) { $overallSuccess = $false }
    Write-Host ""

    # --- Step 2: Validate component versions -----------------------------------
    $validatePassed = $false
    try {
        Write-Host "[2/3] Validating component version lockstep" -ForegroundColor Cyan
        if (-not (Test-Path $Validator)) {
            throw "Validator script not found: $Validator"
        }
        # The validator ends with an explicit 'exit 0' / 'exit 1', so
        # $LASTEXITCODE reflects its verdict rather than that of the last
        # native git call it made internally. Reset it first so a stale value
        # from Step 1 can never be mistaken for a validator result.
        $global:LASTEXITCODE = 0
        & $Validator -BaseCommit $BaseCommit
        if ($LASTEXITCODE -eq 0) {
            $validatePassed = $true
        }
    }
    catch {
        Write-Host "Validation step threw an exception: $_" -ForegroundColor Red
        $validatePassed = $false
    }
    Write-StepResult -StepName "Validate component versions" -Passed $validatePassed
    if (-not $validatePassed) { $overallSuccess = $false }
    Write-Host ""

    # --- Step 3: Agent documentation freshness ---------------------------------
    # Regenerates docs-agent with AgentDocMap and fails if the committed output
    # drifts from what the generator produces (mirrors the agent-docs.yml
    # workflow). Requires the AgentDocMap repository next to OpenDocViewer.
    $agentDocsPassed = $false
    try {
        Write-Host "[3/3] Verifying generated agent documentation is fresh" -ForegroundColor Cyan
        Push-Location $RepoRoot
        try {
            & npm run doc:agent
            if ($LASTEXITCODE -ne 0) {
                throw "npm run doc:agent exited with code $LASTEXITCODE"
            }
            & git diff --exit-code -- docs-agent
            if ($LASTEXITCODE -eq 0) {
                $agentDocsPassed = $true
            }
            else {
                Write-Host "docs-agent is stale: regenerated output differs from the committed files. Run 'npm run doc:agent' and commit the result." -ForegroundColor Red
            }
        }
        finally {
            Pop-Location
        }
    }
    catch {
        Write-Host "Agent documentation freshness step threw an exception: $_" -ForegroundColor Red
        $agentDocsPassed = $false
    }
    Write-StepResult -StepName "Agent documentation freshness" -Passed $agentDocsPassed
    if (-not $agentDocsPassed) { $overallSuccess = $false }
    Write-Host ""

    # --- Telemetry: one compact JSONL line per run. Written AFTER the gate
    # result is decided, in its own try/catch: a failure here is a visible
    # Write-Warning and can never change the exit code. ---
    $localCiTimer.Stop()
    $telemetryStatus = if ($overallSuccess) { 'pass' } else { 'fail' }
    try {
        if (Get-Command Write-LocalCiTelemetry -ErrorAction SilentlyContinue) {
            # -TestCount is deliberately omitted: it stays $null (unmeasured),
            # never 0, because this gate runs no tests.
            Write-LocalCiTelemetry -Repo 'OpenDocViewer' -RepositoryRoot $RepoRoot -Status $telemetryStatus -DurationMs $localCiTimer.ElapsedMilliseconds -BuildDurationMs $buildDurationMs -TestStatus $telemetryTestStatus -TestSkipReason $telemetrySkipReason
        }
    }
    catch {
        $telemetryTarget = '(unknown: APPDATA not set)'
        if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
            $telemetryTarget = Join-Path $env:APPDATA '@private\ai-orchestrator\local-ci-telemetry\OpenDocViewer.jsonl'
        }
        Write-Warning "Local-ci telemetry failed for OpenDocViewer (target: $telemetryTarget): $($_.Exception.Message)"
    }

    # --- Summary ---------------------------------------------------------------
    Write-Host "========================================" -ForegroundColor Cyan
    if ($overallSuccess) {
        Write-Host "LOCAL CI PASSED" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Cyan
        exit 0
    }
    else {
        Write-Host "LOCAL CI FAILED" -ForegroundColor Red
        Write-Host "========================================" -ForegroundColor Cyan
        exit 1
    }
}
catch {
    Write-Host "Unexpected error in local-ci.ps1: $_" -ForegroundColor Red
    exit 1
}
