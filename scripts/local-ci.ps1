#requires -Version 5.1
<#
.SYNOPSIS
    Local pre-push CI gate for the OpenDocViewer repository.

.DESCRIPTION
    This is a public repository; CI runs automatically on push, but still run
    locally before pushing to catch build breaks and version lockstep issues.

    Steps:
      1. Build the web application: npm run build
      2. Validate version lockstep: scripts/validate-component-versions.ps1

    Exit code 0 if all steps pass, 1 if any fail.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Validator = Join-Path (Join-Path $RepoRoot 'scripts') 'validate-component-versions.ps1'

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
    try {
        Write-Host "[1/2] Building web application: npm run build" -ForegroundColor Cyan
        Push-Location $RepoRoot
        & npm run build
        Pop-Location
        if ($LASTEXITCODE -eq 0) {
            $buildPassed = $true
        }
    }
    catch {
        Write-Host "Build step threw an exception: $_" -ForegroundColor Red
        $buildPassed = $false
    }
    Write-StepResult -StepName "Build" -Passed $buildPassed
    if (-not $buildPassed) { $overallSuccess = $false }
    Write-Host ""

    # --- Step 2: Validate component versions -----------------------------------
    $validatePassed = $false
    try {
        Write-Host "[2/2] Validating component version lockstep" -ForegroundColor Cyan
        if (-not (Test-Path $Validator)) {
            throw "Validator script not found: $Validator"
        }
        & $Validator -BaseCommit 'origin/main'
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
