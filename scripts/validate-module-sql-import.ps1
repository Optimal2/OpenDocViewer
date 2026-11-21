#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$PlatformRepositoryRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$definitionValidator = Join-Path $PlatformRepositoryRoot 'scripts/omp/validate-module-definitions.ps1'
$sqlGuard = Join-Path $PlatformRepositoryRoot 'scripts/omp/Test-ModuleSqlGuards.ps1'
foreach ($validator in @($definitionValidator, $sqlGuard)) {
    if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
        throw "Platform validator not found at '$validator'."
    }
}

$global:LASTEXITCODE = 0
& $definitionValidator -RepositoryRoot $RepositoryRoot
if ($LASTEXITCODE -ne 0) {
    throw "validate-module-definitions.ps1 exited with code $LASTEXITCODE."
}

# Print the guard's diagnostics as they arrive, including when it throws.
$global:LASTEXITCODE = 0
$guardOutput = & $sqlGuard -RepositoryRoot $RepositoryRoot -SelfTest | ForEach-Object {
    Write-Host $_
    $_
}
if ($LASTEXITCODE -ne 0) {
    throw "Test-ModuleSqlGuards.ps1 exited with code $LASTEXITCODE."
}

# The guard can exit successfully without checking any scripts.
$measurement = $guardOutput | Select-String -Pattern '^Checked ([0-9]+) script\(s\)' | Select-Object -Last 1
if ($null -eq $measurement) {
    throw 'Test-ModuleSqlGuards.ps1 printed no "Checked N script(s)" line: the module SQL rule was not measured.'
}
if ([long]$measurement.Matches[0].Groups[1].Value -eq 0) {
    throw 'Test-ModuleSqlGuards.ps1 validated 0 script(s): the module SQL rule was not measured.'
}
