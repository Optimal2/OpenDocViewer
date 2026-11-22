#Requires -Version 5.1
<#
.SYNOPSIS
Resolves the one OpenModulePlatform checkout a consumer build and validators use.

.DESCRIPTION
Returns the absolute final directory path as a single string. Resolution order
is -PlatformRepositoryRoot, OMP_PLATFORM_ROOT, OpenModulePlatformRoot, then the
sibling ../OpenModulePlatform. Relative values are anchored at RepositoryRoot.
Two environment variables that name different checkouts are an error, as is a
named root that does not exist. Equivalent case, trailing-separator, junction
and 8.3 path forms are accepted.

Consumer local-CI scripts should call this script and pass the returned root to
MSBuild as OpenModulePlatformRoot and to every platform validator. That makes a
split build/validator checkout visible instead of silently mixing sources.

.PARAMETER RepositoryRoot
Root of the consuming repository.

.PARAMETER PlatformRepositoryRoot
Optional explicit platform root, which outranks the environment variables.

.EXAMPLE
$platformRoot = & '.\scripts\omp\resolve-platform-root.ps1' -RepositoryRoot $repoRoot
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $false)][string]$PlatformRepositoryRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'validate-component-versions.helpers.ps1')

$resolved = Resolve-OmpPlatformRoot -RepositoryRoot $RepositoryRoot -PlatformRepositoryRoot $PlatformRepositoryRoot
if (-not (Test-Path -LiteralPath $resolved.Root -PathType Container)) {
    throw "OpenModulePlatform checkout was not found at '$($resolved.Root)'. Set OMP_PLATFORM_ROOT or OpenModulePlatformRoot to the checkout, or place it beside the consuming repository."
}
$resolved.Root
