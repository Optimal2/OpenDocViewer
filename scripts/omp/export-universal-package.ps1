<#
.SYNOPSIS
Exports this repository as an OMP universal module package.

.DESCRIPTION
This repository-local entry point is intentionally thin. The canonical
implementation lives in the sibling OpenModulePlatform repository so every
OMP-compatible module repository can expose the same command path without
duplicating packaging logic.
#>
[CmdletBinding()]
param(
    [string]$OutputPath = '',
    [string]$PackageKey = '',
    [string]$PackageVersion = '',
    [string]$DisplayName = '',
    [string]$Description = '',
    [string]$TargetHostProfile = '',
    [string]$HostProfilePath = '',
    [string]$OmpRepositoryRoot = '',
    [string[]]$ComponentKey = @(),
    [switch]$AllComponents,
    [switch]$BuildArtifacts,
    [string]$Configuration = 'Release',
    [string[]]$ArtifactConfigurationFile = @(),
    [string[]]$HostConfigurationFile = @(),
    [string[]]$ConfigOverlayFile = @(),
    [string[]]$WidgetFile = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-PathFromBase {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Find-OmpRepositoryRoot {
    param(
        [string]$ConfiguredRoot,
        [string]$RepositoryRoot
    )

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredRoot)) {
        $candidates += $ConfiguredRoot
    }

    if (-not [string]::IsNullOrWhiteSpace($env:OMP_REPOSITORY_ROOT)) {
        $candidates += $env:OMP_REPOSITORY_ROOT
    }

    $parent = Split-Path -Parent $RepositoryRoot
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        $candidates += (Join-Path $parent 'OpenModulePlatform')
    }

    foreach ($candidate in $candidates) {
        $resolved = Resolve-PathFromBase -Path $candidate -BasePath $RepositoryRoot
        $exporter = Join-Path $resolved 'scripts\omp\export-universal-package.ps1'
        if (Test-Path -LiteralPath $exporter -PathType Leaf) {
            return $resolved
        }
    }

    throw 'Could not locate OpenModulePlatform\scripts\omp\export-universal-package.ps1. Pass -OmpRepositoryRoot or set OMP_REPOSITORY_ROOT.'
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ompRoot = Find-OmpRepositoryRoot -ConfiguredRoot $OmpRepositoryRoot -RepositoryRoot $repositoryRoot
$exporter = Join-Path $ompRoot 'scripts\omp\export-universal-package.ps1'

$arguments = @{
    RepositoryRoot = $repositoryRoot
    OmpRepositoryRoot = $ompRoot
    Configuration = $Configuration
}

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) { $arguments.OutputPath = $OutputPath }
if (-not [string]::IsNullOrWhiteSpace($PackageKey)) { $arguments.PackageKey = $PackageKey }
if (-not [string]::IsNullOrWhiteSpace($PackageVersion)) { $arguments.PackageVersion = $PackageVersion }
if (-not [string]::IsNullOrWhiteSpace($DisplayName)) { $arguments.DisplayName = $DisplayName }
if (-not [string]::IsNullOrWhiteSpace($Description)) { $arguments.Description = $Description }
if (-not [string]::IsNullOrWhiteSpace($TargetHostProfile)) { $arguments.TargetHostProfile = $TargetHostProfile }
if (-not [string]::IsNullOrWhiteSpace($HostProfilePath)) { $arguments.HostProfilePath = (Resolve-PathFromBase -Path $HostProfilePath -BasePath $repositoryRoot) }
if ($ComponentKey.Count -gt 0) { $arguments.ComponentKey = $ComponentKey }
if ($AllComponents) { $arguments.AllComponents = $true }
if ($BuildArtifacts) { $arguments.BuildArtifacts = $true }
if ($ArtifactConfigurationFile.Count -gt 0) { $arguments.ArtifactConfigurationFile = $ArtifactConfigurationFile }
if ($HostConfigurationFile.Count -gt 0) { $arguments.HostConfigurationFile = $HostConfigurationFile }
if ($ConfigOverlayFile.Count -gt 0) { $arguments.ConfigOverlayFile = $ConfigOverlayFile }
if ($WidgetFile.Count -gt 0) { $arguments.WidgetFile = $WidgetFile }

& $exporter @arguments
