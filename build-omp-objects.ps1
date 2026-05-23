<#
.SYNOPSIS
Builds portable OMP objects for this repository.

.DESCRIPTION
This root wrapper keeps the same command shape across OMP-related repositories
while delegating the implementation to the OpenModulePlatform repository.
#>
[CmdletBinding()]
param(
    [string]$OutputRoot = '',
    [string]$OmpRepositoryRoot = '',
    [string[]]$ComponentKey = @(),
    [switch]$AllComponents,
    [switch]$BuildArtifacts,
    [string]$Configuration = 'Release',
    [string[]]$ArtifactConfigurationFile = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OmpRepositoryRoot)) {
    $OmpRepositoryRoot = Join-Path (Split-Path -Parent $repositoryRoot) 'OpenModulePlatform'
}

$scriptPath = Join-Path $OmpRepositoryRoot 'scripts\omp\build-repository-objects.ps1'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "OpenModulePlatform object builder was not found: $scriptPath"
}

& $scriptPath `
    -RepositoryRoot $repositoryRoot `
    -OmpRepositoryRoot $OmpRepositoryRoot `
    -OutputRoot $OutputRoot `
    -ComponentKey $ComponentKey `
    -AllComponents:$AllComponents `
    -BuildArtifacts:$BuildArtifacts `
    -Configuration $Configuration `
    -ArtifactConfigurationFile $ArtifactConfigurationFile
