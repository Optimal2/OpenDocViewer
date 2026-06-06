<#
.SYNOPSIS
Exports an OMP-compatible repository as a universal module package zip.

.DESCRIPTION
This is the standard repository-level exporter for OMP-compatible module
repositories. It reads the repository's omp-components.json through
build-repository-objects.ps1, then packages the generated portable objects into
one universal zip containing:

  omp-universal-package.json
  module-definitions/
  artifacts/
  host-configs/
  config-overlays/
  widgets/
  widget-data/

Run without a host profile to create a global package. Pass -HostProfilePath or
-TargetHostProfile with host-specific config/overlay/widget inputs to create a
host-specific transport package.

The optional host profile is JSON. Its supported fields are:

  targetHostProfile
  artifactConfigurationFiles
  hostConfigurationFiles
  configOverlayFiles
  widgetFiles
  widgetDataFiles
  modules

Each file list may contain either strings in the same syntax as the matching
command-line parameter, or objects with sourcePath/path and optional
destinationName. artifactConfigurationFiles objects use componentKey,
relativePath, and sourcePath/path. The modules object may contain one property
per module key with the same file-list fields, plus any additional
module-private values consumed by the repository's optional
scripts/omp/build-host-profile-objects.ps1 hook.
#>
[CmdletBinding()]
param(
    [string]$RepositoryRoot = '',
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
    [string[]]$WidgetFile = @(),
    [string[]]$WidgetDataFile = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ScriptDirectory {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return $PSScriptRoot
    }

    $scriptPath = $PSCommandPath
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        $scriptPath = $MyInvocation.MyCommand.Path
    }

    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        throw 'Could not resolve script directory. Pass -RepositoryRoot explicitly.'
    }

    return Split-Path -Parent $scriptPath
}

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

function Get-JsonPropertyValue {
    param(
        [Parameter(Mandatory = $true)][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = $Object.PSObject.Properties |
        Where-Object { $_.Name.Equals($Name, [StringComparison]::OrdinalIgnoreCase) } |
        Select-Object -First 1
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Get-RepositoryModuleKeys {
    param([Parameter(Mandatory = $true)][object]$Manifest)

    $keys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($definition in @((Get-JsonPropertyValue -Object $Manifest -Name 'moduleDefinitions'))) {
        if ($null -eq $definition) {
            continue
        }

        $moduleKey = [string](Get-JsonPropertyValue -Object $definition -Name 'moduleKey')
        if (-not [string]::IsNullOrWhiteSpace($moduleKey)) {
            [void]$keys.Add($moduleKey.Trim())
        }
    }

    foreach ($component in @((Get-JsonPropertyValue -Object $Manifest -Name 'components'))) {
        if ($null -eq $component) {
            continue
        }

        $moduleKey = [string](Get-JsonPropertyValue -Object $component -Name 'moduleKey')
        if (-not [string]::IsNullOrWhiteSpace($moduleKey)) {
            [void]$keys.Add($moduleKey.Trim())
        }
    }

    return @($keys | Sort-Object)
}

function Convert-ProfileMappingSource {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    $separatorIndex = $Value.IndexOf('=')
    if ($separatorIndex -lt 0) {
        return Resolve-PathFromBase -Path $Value.Trim() -BasePath $BasePath
    }

    if ($separatorIndex -eq 0 -or $separatorIndex -eq ($Value.Length - 1)) {
        throw "Invalid host profile file mapping: $Value"
    }

    $left = $Value.Substring(0, $separatorIndex + 1)
    $source = $Value.Substring($separatorIndex + 1).Trim()
    return $left + (Resolve-PathFromBase -Path $source -BasePath $BasePath)
}

function Convert-ProfileArtifactConfiguration {
    param(
        [Parameter(Mandatory = $true)][object]$Entry,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    if ($Entry -is [string]) {
        return Convert-ProfileMappingSource -Value $Entry -BasePath $BasePath
    }

    $componentKey = [string](Get-JsonPropertyValue -Object $Entry -Name 'componentKey')
    $relativePath = [string](Get-JsonPropertyValue -Object $Entry -Name 'relativePath')
    $sourcePath = [string](Get-JsonPropertyValue -Object $Entry -Name 'sourcePath')
    if ([string]::IsNullOrWhiteSpace($sourcePath)) {
        $sourcePath = [string](Get-JsonPropertyValue -Object $Entry -Name 'path')
    }

    if ([string]::IsNullOrWhiteSpace($componentKey) -or
        [string]::IsNullOrWhiteSpace($relativePath) -or
        [string]::IsNullOrWhiteSpace($sourcePath)) {
        throw 'artifactConfigurationFiles objects must contain componentKey, relativePath, and sourcePath.'
    }

    $resolvedSource = Resolve-PathFromBase -Path $sourcePath -BasePath $BasePath
    return ('{0}:{1}={2}' -f $componentKey.Trim(), $relativePath.Trim(), $resolvedSource)
}

function Convert-ProfilePortableFile {
    param(
        [Parameter(Mandatory = $true)][object]$Entry,
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$ListName
    )

    if ($Entry -is [string]) {
        return Convert-ProfileMappingSource -Value $Entry -BasePath $BasePath
    }

    $sourcePath = [string](Get-JsonPropertyValue -Object $Entry -Name 'sourcePath')
    if ([string]::IsNullOrWhiteSpace($sourcePath)) {
        $sourcePath = [string](Get-JsonPropertyValue -Object $Entry -Name 'path')
    }

    if ([string]::IsNullOrWhiteSpace($sourcePath)) {
        throw "$ListName objects must contain sourcePath or path."
    }

    $destinationName = [string](Get-JsonPropertyValue -Object $Entry -Name 'destinationName')
    $resolvedSource = Resolve-PathFromBase -Path $sourcePath -BasePath $BasePath
    if ([string]::IsNullOrWhiteSpace($destinationName)) {
        return $resolvedSource
    }

    return ('{0}={1}' -f $destinationName.Trim(), $resolvedSource)
}

function Add-ProfileObjectArguments {
    param(
        [Parameter(Mandatory = $true)][object]$Profile,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    foreach ($entry in @((Get-JsonPropertyValue -Object $Profile -Name 'artifactConfigurationFiles'))) {
        if ($null -eq $entry) {
            continue
        }

        $script:ArtifactConfigurationFile += (Convert-ProfileArtifactConfiguration -Entry $entry -BasePath $basePath)
    }

    foreach ($entry in @((Get-JsonPropertyValue -Object $Profile -Name 'hostConfigurationFiles'))) {
        if ($null -eq $entry) {
            continue
        }

        $script:HostConfigurationFile += (Convert-ProfilePortableFile -Entry $entry -BasePath $basePath -ListName 'hostConfigurationFiles')
    }

    foreach ($entry in @((Get-JsonPropertyValue -Object $Profile -Name 'configOverlayFiles'))) {
        if ($null -eq $entry) {
            continue
        }

        $script:ConfigOverlayFile += (Convert-ProfilePortableFile -Entry $entry -BasePath $basePath -ListName 'configOverlayFiles')
    }

    foreach ($entry in @((Get-JsonPropertyValue -Object $Profile -Name 'widgetFiles'))) {
        if ($null -eq $entry) {
            continue
        }

        $script:WidgetFile += (Convert-ProfilePortableFile -Entry $entry -BasePath $basePath -ListName 'widgetFiles')
    }

    foreach ($entry in @((Get-JsonPropertyValue -Object $Profile -Name 'widgetDataFiles'))) {
        if ($null -eq $entry) {
            continue
        }

        $script:WidgetDataFile += (Convert-ProfilePortableFile -Entry $entry -BasePath $basePath -ListName 'widgetDataFiles')
    }
}

function Add-HostProfileArguments {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$ModuleKeys
    )

    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        throw "Host profile file was not found: $resolvedPath"
    }

    $basePath = Split-Path -Parent $resolvedPath
    $profile = Get-Content -LiteralPath $resolvedPath -Raw -Encoding UTF8 | ConvertFrom-Json

    $profileTarget = [string](Get-JsonPropertyValue -Object $profile -Name 'targetHostProfile')
    if ([string]::IsNullOrWhiteSpace($script:TargetHostProfile) -and
        -not [string]::IsNullOrWhiteSpace($profileTarget)) {
        $script:TargetHostProfile = $profileTarget.Trim()
    }

    Add-ProfileObjectArguments -Profile $profile -BasePath $basePath

    $modules = Get-JsonPropertyValue -Object $profile -Name 'modules'
    if ($null -eq $modules) {
        return
    }

    foreach ($moduleKey in $ModuleKeys) {
        $moduleProfile = Get-JsonPropertyValue -Object $modules -Name $moduleKey
        if ($null -eq $moduleProfile) {
            continue
        }

        Add-ProfileObjectArguments -Profile $moduleProfile -BasePath $basePath
    }
}

function Invoke-HostProfileObjectHook {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$OutputRoot,
        [Parameter(Mandatory = $true)][string]$HostProfilePath,
        [Parameter(Mandatory = $true)][string[]]$ModuleKeys,
        [string]$TargetHostProfile,
        [string]$Configuration
    )

    $hookPath = Join-Path $RepositoryRoot 'scripts\omp\build-host-profile-objects.ps1'
    if (-not (Test-Path -LiteralPath $hookPath -PathType Leaf)) {
        return
    }

    $hookArgs = @{
        RepositoryRoot = $RepositoryRoot
        OutputRoot = $OutputRoot
        HostProfilePath = $HostProfilePath
        ModuleKey = $ModuleKeys
        Configuration = $Configuration
    }

    if (-not [string]::IsNullOrWhiteSpace($TargetHostProfile)) {
        $hookArgs.TargetHostProfile = $TargetHostProfile
    }

    & $hookPath @hookArgs
}

function Get-SafeName {
    param([string]$Value)

    $text = $Value.Trim()
    foreach ($character in [System.IO.Path]::GetInvalidFileNameChars()) {
        $text = $text.Replace($character, '-')
    }

    if ([string]::IsNullOrWhiteSpace($text)) {
        return 'package'
    }

    return $text
}

function Add-ZipEntryFromFile {
    param(
        [Parameter(Mandatory = $true)][System.IO.Compression.ZipArchive]$Archive,
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$EntryName
    )

    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $Archive,
        $SourcePath,
        $EntryName.Replace('\', '/'),
        [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}

function Add-ZipEntryFromText {
    param(
        [Parameter(Mandatory = $true)][System.IO.Compression.ZipArchive]$Archive,
        [Parameter(Mandatory = $true)][string]$EntryName,
        [Parameter(Mandatory = $true)][string]$Text
    )

    $entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try {
        $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
        try {
            $writer.Write($Text)
        }
        finally {
            $writer.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Get-ArchiveRelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $baseFullPath = [System.IO.Path]::GetFullPath($BasePath)
    if (-not $baseFullPath.EndsWith([System.IO.Path]::DirectorySeparatorChar.ToString(), [StringComparison]::Ordinal)) {
        $baseFullPath += [System.IO.Path]::DirectorySeparatorChar
    }

    $targetFullPath = [System.IO.Path]::GetFullPath($Path)
    $baseUri = [Uri]::new($baseFullPath)
    $targetUri = [Uri]::new($targetFullPath)
    return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('\', '/')
}

function Get-UniversalPackageFiles {
    param([Parameter(Mandatory = $true)][string]$ObjectRoot)

    $folders = @(
        @{ Folder = 'module-definitions'; Kind = 'module-definition'; Pattern = '*.json' },
        @{ Folder = 'artifacts'; Kind = 'artifact-package'; Pattern = '*.zip' },
        @{ Folder = 'host-configs'; Kind = 'host-configuration'; Pattern = '*.json' },
        @{ Folder = 'host-configs'; Kind = 'host-configuration'; Pattern = '*.zip' },
        @{ Folder = 'config-overlays'; Kind = 'config-overlay'; Pattern = '*.json' },
        @{ Folder = 'config-overlays'; Kind = 'config-overlay'; Pattern = '*.zip' },
        @{ Folder = 'widgets'; Kind = 'dashboard-widget'; Pattern = '*.json' },
        @{ Folder = 'widget-data'; Kind = 'widget-data'; Pattern = '*.zip' }
    )

    $items = [System.Collections.Generic.List[object]]::new()
    foreach ($folderInfo in $folders) {
        $folderPath = Join-Path $ObjectRoot $folderInfo.Folder
        if (-not (Test-Path -LiteralPath $folderPath -PathType Container)) {
            continue
        }

        foreach ($file in Get-ChildItem -LiteralPath $folderPath -Filter $folderInfo.Pattern -File -Recurse) {
            $relativePath = Get-ArchiveRelativePath -BasePath $ObjectRoot -Path $file.FullName
            $items.Add([pscustomobject]@{
                Kind = $folderInfo.Kind
                Path = $relativePath
                FullName = $file.FullName
            })
        }
    }

    return @($items | Sort-Object Kind, Path)
}

$scriptDirectory = Get-ScriptDirectory
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = (Resolve-Path (Join-Path $scriptDirectory '..\..')).Path
}

$repositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
$componentManifestPath = Join-Path $repositoryRoot 'omp-components.json'
if (-not (Test-Path -LiteralPath $componentManifestPath -PathType Leaf)) {
    throw "Component manifest was not found: $componentManifestPath"
}

$componentManifest = Get-Content -LiteralPath $componentManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$repositoryModuleKeys = Get-RepositoryModuleKeys -Manifest $componentManifest
$resolvedHostProfilePath = ''

if (-not [string]::IsNullOrWhiteSpace($HostProfilePath)) {
    $resolvedHostProfilePath = Resolve-PathFromBase -Path $HostProfilePath -BasePath $repositoryRoot
    Add-HostProfileArguments -Path $resolvedHostProfilePath -ModuleKeys $repositoryModuleKeys
}

if ([string]::IsNullOrWhiteSpace($PackageKey)) {
    $PackageKey = [string](Get-JsonPropertyValue -Object $componentManifest -Name 'repositoryKey')
}

if ([string]::IsNullOrWhiteSpace($PackageKey)) {
    $PackageKey = Split-Path -Leaf $repositoryRoot
}

if ([string]::IsNullOrWhiteSpace($PackageVersion)) {
    $PackageVersion = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
}

if ([string]::IsNullOrWhiteSpace($DisplayName)) {
    $DisplayName = "$PackageKey universal package"
}

$targetSuffix = 'global'
if (-not [string]::IsNullOrWhiteSpace($TargetHostProfile)) {
    $targetSuffix = $TargetHostProfile
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $defaultOutputRoot = Join-Path $repositoryRoot 'artifacts\universal-packages'
    New-Item -ItemType Directory -Path $defaultOutputRoot -Force | Out-Null
    $fileName = '{0}__{1}__{2}.zip' -f (Get-SafeName -Value $PackageKey), (Get-SafeName -Value $targetSuffix), (Get-SafeName -Value $PackageVersion)
    $OutputPath = Join-Path $defaultOutputRoot $fileName
}

$outputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$buildRepositoryObjectsScript = Join-Path $scriptDirectory 'build-repository-objects.ps1'
if (-not (Test-Path -LiteralPath $buildRepositoryObjectsScript -PathType Leaf)) {
    throw "Repository object builder was not found: $buildRepositoryObjectsScript"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('omp-universal-export-' + [Guid]::NewGuid().ToString('N'))
$objectRoot = Join-Path $tempRoot 'objects'

try {
    $builderArgs = @{
        RepositoryRoot = $repositoryRoot
        OutputRoot = $objectRoot
        Configuration = $Configuration
    }

    if (-not [string]::IsNullOrWhiteSpace($OmpRepositoryRoot)) {
        $builderArgs.OmpRepositoryRoot = $OmpRepositoryRoot
    }

    if ($ComponentKey.Count -gt 0) {
        $builderArgs.ComponentKey = $ComponentKey
    }

    if ($AllComponents) {
        $builderArgs.AllComponents = $true
    }

    if ($BuildArtifacts) {
        $builderArgs.BuildArtifacts = $true
    }

    if ($ArtifactConfigurationFile.Count -gt 0) {
        $builderArgs.ArtifactConfigurationFile = $ArtifactConfigurationFile
    }

    if ($HostConfigurationFile.Count -gt 0) {
        $builderArgs.HostConfigurationFile = $HostConfigurationFile
    }

    if ($ConfigOverlayFile.Count -gt 0) {
        $builderArgs.ConfigOverlayFile = $ConfigOverlayFile
    }

    if ($WidgetFile.Count -gt 0) {
        $builderArgs.WidgetFile = $WidgetFile
    }

    if ($WidgetDataFile.Count -gt 0) {
        $builderArgs.WidgetDataFile = $WidgetDataFile
    }

    & $buildRepositoryObjectsScript @builderArgs

    if (-not [string]::IsNullOrWhiteSpace($resolvedHostProfilePath)) {
        Invoke-HostProfileObjectHook `
            -RepositoryRoot $repositoryRoot `
            -OutputRoot $objectRoot `
            -HostProfilePath $resolvedHostProfilePath `
            -ModuleKeys $repositoryModuleKeys `
            -TargetHostProfile $TargetHostProfile `
            -Configuration $Configuration
    }

    $files = Get-UniversalPackageFiles -ObjectRoot $objectRoot
    $manifestItems = @(
        foreach ($file in $files) {
            [ordered]@{
                kind = $file.Kind
                path = $file.Path
            }
        }
    )

    $manifestDescription = $null
    if (-not [string]::IsNullOrWhiteSpace($Description)) {
        $manifestDescription = $Description
    }

    $manifestTargetHostProfile = $null
    if (-not [string]::IsNullOrWhiteSpace($TargetHostProfile)) {
        $manifestTargetHostProfile = $TargetHostProfile
    }

    $manifest = [ordered]@{
        formatVersion = 1
        objectType = 'universal-module-package'
        packageKey = $PackageKey
        packageVersion = $PackageVersion
        displayName = $DisplayName
        description = $manifestDescription
        targetHostProfile = $manifestTargetHostProfile
        createdUtc = [DateTime]::UtcNow.ToString('o')
        sourceRepositoryKey = [string](Get-JsonPropertyValue -Object $componentManifest -Name 'repositoryKey')
        sourceRepositoryVersion = [string](Get-JsonPropertyValue -Object $componentManifest -Name 'repositoryVersion')
        items = $manifestItems
    }

    if (Test-Path -LiteralPath $outputPath -PathType Leaf) {
        Remove-Item -LiteralPath $outputPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($outputPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            Add-ZipEntryFromFile -Archive $archive -SourcePath $file.FullName -EntryName $file.Path
        }

        $manifestJson = $manifest | ConvertTo-Json -Depth 20
        Add-ZipEntryFromText -Archive $archive -EntryName 'omp-universal-package.json' -Text $manifestJson
    }
    finally {
        $archive.Dispose()
    }

    Write-Host "OMP universal package: $outputPath"
    Write-Host ("Package items: {0}" -f $files.Count)
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
