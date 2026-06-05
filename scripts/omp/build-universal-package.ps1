<#
.SYNOPSIS
Builds a universal OMP package for this repository with convenient defaults.

.DESCRIPTION
This wrapper calls scripts/omp/export-universal-package.ps1. With no component
selection it exports all components and builds artifact payloads. The default
package name uses repositoryKey and repositoryVersion from omp-components.json.
#>
[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [string]$OutputDirectory = '',
    [string]$OutputPath = '',
    [string]$PackageVersion = '',
    [string]$PackageKey = '',
    [string]$TargetHostProfile = '',
    [string]$HostProfilePath = '',
    [string[]]$ComponentKey = @(),
    [switch]$AllComponents,
    [switch]$UseExistingArtifacts,
    [string]$Configuration = 'Release',
    [string[]]$ArtifactConfigurationFile = @(),
    [string[]]$HostConfigurationFile = @(),
    [string[]]$ConfigOverlayFile = @(),
    [string[]]$WidgetFile = @(),
    [string[]]$WidgetDataFile = @(),
    [switch]$Pause
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Wait-ForUser {
    param([switch]$Enabled)

    if ($Enabled) {
        [void](Read-Host 'Press Enter to close')
    }
}

function Get-SafeName {
    param([Parameter(Mandatory = $true)][string]$Value)

    $safe = $Value -replace '[^A-Za-z0-9._-]+', '-'
    $safe = $safe.Trim('-')
    if ([string]::IsNullOrWhiteSpace($safe)) {
        return 'package'
    }

    return $safe
}

$exitCode = 0
try {
    $repositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
    $manifestPath = Join-Path $repositoryRoot 'omp-components.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Component manifest not found: $manifestPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($PackageKey)) {
        $PackageKey = [string]$manifest.repositoryKey
    }

    if ([string]::IsNullOrWhiteSpace($PackageKey)) {
        $PackageKey = Split-Path -Leaf $repositoryRoot
    }

    if ([string]::IsNullOrWhiteSpace($PackageVersion)) {
        $PackageVersion = [string]$manifest.repositoryVersion
    }

    if ([string]::IsNullOrWhiteSpace($PackageVersion)) {
        $PackageVersion = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
    }

    if (-not $AllComponents -and $ComponentKey.Count -eq 0) {
        $AllComponents = $true
    }

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
            $OutputDirectory = $env:OMP_UNIVERSAL_PACKAGE_OUTPUT_DIR
        }

        if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
            $OutputDirectory = Join-Path $repositoryRoot 'artifacts\universal-packages'
        }

        $targetPart = 'global'
        if (-not [string]::IsNullOrWhiteSpace($TargetHostProfile)) {
            $targetPart = $TargetHostProfile
        }

        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
        $fileName = '{0}-{1}-{2}-universal.zip' -f (Get-SafeName -Value $PackageKey), (Get-SafeName -Value $targetPart), (Get-SafeName -Value $PackageVersion)
        $OutputPath = Join-Path $OutputDirectory $fileName
    }

    $exportScript = Join-Path $PSScriptRoot 'export-universal-package.ps1'
    if (-not (Test-Path -LiteralPath $exportScript -PathType Leaf)) {
        throw "Universal package exporter not found: $exportScript"
    }

    $exportArgs = @{
        RepositoryRoot = $repositoryRoot
        OutputPath = $OutputPath
        PackageKey = $PackageKey
        PackageVersion = $PackageVersion
        TargetHostProfile = $TargetHostProfile
        HostProfilePath = $HostProfilePath
        ComponentKey = $ComponentKey
        Configuration = $Configuration
        ArtifactConfigurationFile = $ArtifactConfigurationFile
        HostConfigurationFile = $HostConfigurationFile
        ConfigOverlayFile = $ConfigOverlayFile
        WidgetFile = $WidgetFile
        WidgetDataFile = $WidgetDataFile
    }

    if ($AllComponents) {
        $exportArgs.AllComponents = $true
    }

    if (-not $UseExistingArtifacts) {
        $exportArgs.BuildArtifacts = $true
    }

    & $exportScript @exportArgs
    Write-Host ''
    Write-Host "Universal package: $OutputPath"
}
catch {
    $exitCode = 1
    Write-Error $_
}
finally {
    Wait-ForUser -Enabled:$Pause
}

if ($exitCode -ne 0) {
    exit $exitCode
}
