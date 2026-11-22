# File: scripts/run-release-tests.ps1
<#
.SYNOPSIS
Runs scripts/release.Tests.ps1 with Pester and reports the result as an exit code.

.DESCRIPTION
Used by scripts/release-script.test.mjs. Does not run release.ps1. Exit code 0 only when
Pester 5 or later is available, at least one test ran and none failed.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pester = Get-Module -ListAvailable -Name Pester |
  Where-Object { $_.Version -ge [version]'5.0.0' } |
  Sort-Object Version -Descending |
  Select-Object -First 1
if (-not $pester) {
  Write-Host 'RELEASE-TESTS cannot run: Pester 5 or later is not installed.'
  exit 2
}
Import-Module $pester.Path -Force

$configuration = New-PesterConfiguration
$configuration.Run.Path = Join-Path $PSScriptRoot 'release.Tests.ps1'
$configuration.Run.PassThru = $true
$configuration.Output.Verbosity = 'Detailed'
$configuration.TestResult.Enabled = $false

$result = Invoke-Pester -Configuration $configuration
Write-Host "RELEASE-TESTS passed=$($result.PassedCount) failed=$($result.FailedCount) pester=$($pester.Version)"
if ($result.FailedCount -gt 0 -or $result.PassedCount -eq 0 -or $result.Result -ne 'Passed') { exit 1 }
exit 0
