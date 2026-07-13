#requires -Version 5.1
<#
.SYNOPSIS
    Configure Git to use the repository's tracked hooks.

.DESCRIPTION
    Sets core.hooksPath to .githooks so the tracked pre-commit and pre-push
    hooks are active for this repository.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$hooksPath = Join-Path $repoRoot '.githooks'

if (-not (Test-Path $hooksPath)) {
    throw "Hooks directory not found: $hooksPath"
}

Push-Location $repoRoot
try {
    & git config core.hooksPath '.githooks'
    if ($LASTEXITCODE -ne 0) {
        throw "git config core.hooksPath failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Host "Git hooks configured to use: $hooksPath" -ForegroundColor Green
