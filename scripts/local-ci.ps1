#requires -Version 5.1
<#
.SYNOPSIS
    Local pre-push CI gate for the OpenDocViewer repository.

.DESCRIPTION
    This is a public repository; CI runs automatically on push, but still run
    locally before pushing to catch build breaks, test failures and version
    lockstep issues.

    Steps:
      1. Build the web application: npm run build
      2. Run the Vitest suite: npx vitest run (with a JSON report for the count)
      3. Validate version lockstep: scripts/omp/validate-component-versions.ps1
         (run with -Strict, so Check 15 - shared-script drift against the
         OpenModulePlatform checkout - fails when it cannot run)
      4. Verify generated agent documentation is fresh: npm run doc:agent,
         then fail if docs-agent differs from the committed output

    Exit code 0 if all steps pass, 1 if any fail.

.PARAMETER BaseCommit
    Git ref the version validator diffs against. Defaults to origin/main;
    pass another ref when the default branch is named differently or the
    remote-tracking ref is stale and you want to compare against a fresh one.

.PARAMETER PlatformRepositoryRoot
    OpenModulePlatform checkout that Check 15 compares the shared scripts
    against. When empty, the validator resolves $env:OMP_PLATFORM_ROOT, then
    $env:OpenModulePlatformRoot, then a sibling folder named
    OpenModulePlatform. Set OMP_PLATFORM_ROOT (or pass this parameter) when
    running from a git worktree that has no sibling platform checkout.

.PARAMETER AllowUnverifiedSharedScripts
    Deliberately run Check 15 without -Strict: when no OpenModulePlatform
    checkout can be found, the shared-script drift guard only warns
    "NOT VERIFIED" instead of failing the gate. Use it only when no platform
    checkout is available on the machine; drift then goes unchecked.

.EXAMPLE
    $env:OMP_PLATFORM_ROOT = '<workspace>\OpenModulePlatform'
    .\scripts\local-ci.ps1
#>
[CmdletBinding()]
param(
    [string]$BaseCommit = 'origin/main',

    [string]$PlatformRepositoryRoot = '',

    [switch]$AllowUnverifiedSharedScripts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Validator = Join-Path (Join-Path (Join-Path $RepoRoot 'scripts') 'omp') 'validate-component-versions.ps1'

# --- Local-ci telemetry (best-effort; never changes the gate's exit code) ----
# One compact JSONL line per run under
# %APPDATA%\@private\ai-orchestrator\local-ci-telemetry\OpenDocViewer.jsonl.
# The test count comes from Vitest's JSON reporter (numTotalTests). When that
# report is missing or unreadable the count stays $null with an explicit
# reason, never 0. No TRX file is produced here, so the helper's TRX counter
# path and the 'unreadable-trx' status do not apply.
$localCiTimer = [System.Diagnostics.Stopwatch]::StartNew()
$buildDurationMs = $null
$telemetryTestStatus = 'not-run'
$telemetryTestCount = $null
$telemetrySkipReason = 'test step did not run'
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
        Write-Host "[1/4] Building web application: npm run build" -ForegroundColor Cyan
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

    # --- Step 2: Unit tests ----------------------------------------------------
    # Mirrors the CI "Test" step. The JSON reporter runs alongside the default
    # reporter only to read numTotalTests for telemetry; the verdict is the
    # process exit code, exactly as in CI.
    $testPassed = $false
    $testReportPath = Join-Path ([System.IO.Path]::GetTempPath()) ("odv-local-ci-vitest-{0}.json" -f ([guid]::NewGuid().ToString('N')))
    try {
        Write-Host "[2/4] Running unit tests: npx vitest run" -ForegroundColor Cyan
        Push-Location $RepoRoot
        try {
            $global:LASTEXITCODE = 0
            & npx vitest run --reporter=default --reporter=json --outputFile="$testReportPath"
            if ($LASTEXITCODE -eq 0) {
                $testPassed = $true
            }
        }
        finally {
            Pop-Location
        }
        $telemetryTestStatus = if ($testPassed) { 'passed' } else { 'failed' }

        if (Test-Path -LiteralPath $testReportPath -PathType Leaf) {
            try {
                $testReport = Get-Content -LiteralPath $testReportPath -Raw | ConvertFrom-Json
                $reportedTotal = [int]$testReport.numTotalTests
                if ($reportedTotal -gt 0) {
                    $telemetryTestCount = $reportedTotal
                    $telemetrySkipReason = ''
                }
                else {
                    $telemetrySkipReason = 'vitest JSON report contained no tests'
                }
            }
            catch {
                $telemetrySkipReason = "vitest JSON report unreadable: $($_.Exception.Message)"
            }
        }
        else {
            $telemetrySkipReason = 'vitest JSON report was not written'
        }
    }
    catch {
        Write-Host "Test step threw an exception: $_" -ForegroundColor Red
        $testPassed = $false
        $telemetryTestStatus = 'failed'
        $telemetrySkipReason = "test step threw: $($_.Exception.Message)"
    }
    finally {
        if (Test-Path -LiteralPath $testReportPath -PathType Leaf) {
            Remove-Item -LiteralPath $testReportPath -Force -ErrorAction SilentlyContinue
        }
    }
    Write-StepResult -StepName "Unit tests" -Passed $testPassed
    if (-not $testPassed) { $overallSuccess = $false }
    Write-Host ""

    # --- Step 3: Validate component versions -----------------------------------
    $validatePassed = $false
    try {
        Write-Host "[3/4] Validating component version lockstep" -ForegroundColor Cyan
        if (-not (Test-Path $Validator)) {
            throw "Validator script not found: $Validator"
        }
        # The validator ends with an explicit 'exit 0' / 'exit 1', so
        # $LASTEXITCODE reflects its verdict rather than that of the last
        # native git call it made internally. Reset it first so a stale value
        # from an earlier step can never be mistaken for a validator result.
        # Strict by default: a Check 15 that cannot find the platform checkout
        # must fail the gate, otherwise shared-script drift from a worktree
        # without a sibling OpenModulePlatform folder passes as green.
        if ($AllowUnverifiedSharedScripts) {
            Write-Warning 'Check 15 runs non-strict (-AllowUnverifiedSharedScripts): shared-script drift is not verified when the platform checkout is missing.'
        }
        $global:LASTEXITCODE = 0
        & $Validator -BaseCommit $BaseCommit -Strict:(-not $AllowUnverifiedSharedScripts) -PlatformRepositoryRoot $PlatformRepositoryRoot
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

    # --- Step 4: Agent documentation freshness ---------------------------------
    # Regenerates docs-agent with AgentDocMap and fails if the committed output
    # drifts from what the generator produces (mirrors the agent-docs.yml
    # workflow). Requires the AgentDocMap repository next to OpenDocViewer.
    $agentDocsPassed = $false
    try {
        Write-Host "[4/4] Verifying generated agent documentation is fresh" -ForegroundColor Cyan
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
            Write-LocalCiTelemetry -Repo 'OpenDocViewer' -RepositoryRoot $RepoRoot -Status $telemetryStatus -DurationMs $localCiTimer.ElapsedMilliseconds -BuildDurationMs $buildDurationMs -TestStatus $telemetryTestStatus -TestCount $telemetryTestCount -TestSkipReason $telemetrySkipReason
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
