#requires -Version 5.1
<#
.SYNOPSIS
    Local pre-push CI gate for the OpenDocViewer repository.

.DESCRIPTION
    This is a public repository; CI runs automatically on push, but still run
    locally before pushing to catch build breaks and test failures.

    Steps:
      1. Build the web application: npm run build
      2. Run the Vitest suite: npx vitest run (with a JSON report for the count)
      3. Component version lockstep: not applicable on a release line.
         release/x.y carries no OMP parts (no component manifest, no module
         definition, no scripts/omp); OMP packages are built from main only.
         The step number is kept so the later steps keep their numbers.
      4. Verify generated agent documentation is fresh: npm run doc:agent,
         then fail unless scripts/verify-agent-docs-fresh.mjs finds docs-agent
         identical in the working tree, the index and HEAD (shared with CI)

    Exit code 0 if all steps pass, 1 if any fail.

.EXAMPLE
    .\scripts\local-ci.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot

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

    # --- Step 3: Component version lockstep ------------------------------------
    # Not applicable on a release line: release/x.y carries no OMP parts, and OMP
    # packages are built from main only. The banner is kept so the step numbers
    # of the later steps, and the tests that anchor on them, stay unchanged.
    Write-Host "[3/4] Component version lockstep: not applicable on a release line (no OMP parts)" -ForegroundColor Cyan
    Write-Host ""

    # --- Step 4: Agent documentation freshness ---------------------------------
    # The shared generator first checks the known JSDoc exclusions against both
    # path separator forms, then regenerates docs-agent (as in agent-docs.yml).
    # The comparison is scripts/verify-agent-docs-fresh.mjs, the same script
    # agent-docs.yml runs: docs-agent in the working tree and the index must
    # equal HEAD, and no untracked (or gitignored) file may exist there, so a
    # staged change cannot move the comparison base as `git diff` let it.
    # Staged or untracked files outside docs-agent are not considered.
    # The generator enforces scripts/agent-docs-environment.json, the pin CI
    # reads too: AgentDocMap revision and installed dependencies must match,
    # the collation is forced to the pinned locale and verified, and Node runs
    # at the pinned version. Unlike CI, an ambient Node of another version is
    # tolerated: the generator prints a NOTE and runs AgentDocMap with the
    # pinned binary (ODV_AGENT_DOCS_NODE, fnm or nvm), and fails with an
    # install hint when none is found. AGENTDOCMAP_ROOT can select the tool in
    # a worktree; a checkout at another commit is not an error, the generator
    # runs the pinned commit from a temporary worktree of it instead.
    $agentDocsPassed = $false
    try {
        Write-Host "[4/4] Verifying generated agent documentation is fresh" -ForegroundColor Cyan
        Push-Location $RepoRoot
        try {
            & npm run doc:agent
            if ($LASTEXITCODE -ne 0) {
                throw "npm run doc:agent exited with code $LASTEXITCODE"
            }
            # Capture the gate's stderr so the message below can name the
            # specific cause (stale docs-agent vs. sparse-checkout vs. manual
            # index flag vs. path resolution). The gate prints its reason to
            # stderr; stdout stays empty on failure. We ALSO echo the captured
            # output to the console on both branches: on failure so the drift
            # list, status-letter legend, and the cause-specific match are
            # visible above the remedy line, and on success so the operator
            # sees the gate's own "is fresh" confirmation instead of step 4
            # silently going green. 2>&1 can mix ErrorRecord objects into the
            # captured array; render them as their text so the console never
            # prints PowerShell object noise.
            $global:LASTEXITCODE = 0
            $agentDocsOutput = & node scripts/verify-agent-docs-fresh.mjs 2>&1
            $agentDocsExit = $global:LASTEXITCODE
            foreach ($line in @($agentDocsOutput)) {
                if ($null -eq $line) { continue }
                if ($line -is [System.Management.Automation.ErrorRecord]) {
                    Write-Host $line.ToString()
                }
                else {
                    Write-Host $line
                }
            }
            if ($agentDocsExit -eq 0) {
                $agentDocsPassed = $true
            }
            else {
                # Pick the message that actually applies. The gate throws
                # specific text for each cause, so the substring match is
                # safe and never false-positives on a stale-docs-agent run.
                $remedy = $null
                if ($agentDocsOutput -match '(?m)^\s*Failed to run git\b|^\s*git .* exited with code\b|^\s*Failed to run git\b') {
                    $remedy = "docs-agent gate could not run a git query (see gate output above). Resolve the git error before re-running."
                }
                elseif ($agentDocsOutput -match '(?s)cone sparse-checkout') {
                    $remedy = "docs-agent is hidden by a cone sparse-checkout. Edit .git/info/sparse-checkout (or run 'git sparse-checkout reapply') so docs-agent is materialised, then re-run."
                }
                elseif ($agentDocsOutput -match '(?s)skip-worktree or assume-unchanged') {
                    $remedy = "docs-agent has a manual --skip-worktree / --assume-unchanged index bit. Clear it with 'git update-index --no-skip-worktree -- <file>' and 'git update-index --no-assume-unchanged -- <file>' for the listed files, then re-run."
                }
                elseif ($agentDocsOutput -match '(?s)is stale:') {
                    $remedy = "docs-agent is stale or has staged/untracked files (see gate output above). Run 'npm run doc:agent', 'git add docs-agent' and commit the result."
                }
                else {
                    $remedy = "docs-agent gate failed for an unknown reason (see gate output above). Re-read the gate's stderr before re-running."
                }
                Write-Host $remedy -ForegroundColor Red
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
