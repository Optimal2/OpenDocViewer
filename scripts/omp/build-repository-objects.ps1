<#
.SYNOPSIS
Builds portable OMP objects from a repository manifest.

.DESCRIPTION
Reads a repository's omp-components.json and writes the module definition JSON
files plus selected artifact package zips to a common output shape:

  module-definitions/
  artifacts/
  host-configs/
  config-overlays/
  widgets/
  widget-data/

Runtime/customer configuration is supplied as command-line mappings instead of
being stored in the source repository:

  -ArtifactConfigurationFile 'component-key:relative/path.ext=C:\secure\file.ext'
  -HostConfigurationFile 'C:\secure\host.json'
  -ConfigOverlayFile 'C:\secure\overlay.zip'
  -WidgetFile 'C:\secure\widgets\my-widget.json'
  -WidgetDataFile 'C:\secure\widgets\my-widget-data.zip'

Point OutputRoot at an installer package's data/global folder to refresh that
package library directly.
#>
[CmdletBinding()]
param(
    [string]$RepositoryRoot = '',
    [string]$OutputRoot = '',
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

function Find-OmpRepositoryRoot {
    param(
        [string]$ConfiguredRoot,
        [string]$CurrentRepositoryRoot
    )

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredRoot)) {
        $candidates += $ConfiguredRoot
    }

    $candidates += $CurrentRepositoryRoot
    $parent = Split-Path -Parent $CurrentRepositoryRoot
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        $candidates += (Join-Path $parent 'OpenModulePlatform')
    }

    foreach ($candidate in $candidates) {
        $resolved = Resolve-PathFromBase -Path $candidate -BasePath $CurrentRepositoryRoot
        if (Test-Path -LiteralPath (Join-Path $resolved 'scripts\deployment\new-omp-artifact-package.ps1') -PathType Leaf) {
            return $resolved
        }
    }

    throw 'Could not locate an OpenModulePlatform repository with scripts\deployment\new-omp-artifact-package.ps1.'
}

function Get-JsonPropertyValue {
    param(
        [Parameter(Mandatory = $true)][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Test-ArtifactComponent {
    param([object]$Component)

    return -not [string]::IsNullOrWhiteSpace([string](Get-JsonPropertyValue -Object $Component -Name 'moduleKey')) `
        -and -not [string]::IsNullOrWhiteSpace([string](Get-JsonPropertyValue -Object $Component -Name 'appKey')) `
        -and -not [string]::IsNullOrWhiteSpace([string](Get-JsonPropertyValue -Object $Component -Name 'packageType')) `
        -and -not [string]::IsNullOrWhiteSpace([string](Get-JsonPropertyValue -Object $Component -Name 'targetName')) `
        -and -not [string]::IsNullOrWhiteSpace([string](Get-JsonPropertyValue -Object $Component -Name 'version'))
}

function Get-ArtifactPackageName {
    param([object]$Component)

    return '{0}__{1}__{2}__{3}__{4}.zip' -f `
        [string]$Component.moduleKey,
        [string]$Component.appKey,
        [string]$Component.packageType,
        [string]$Component.targetName,
        [string]$Component.version
}

function Get-SafePathMapSegment {
    param([string]$Value)

    $safeChars = foreach ($ch in $Value.ToCharArray()) {
        if ([char]::IsLetterOrDigit($ch) -or $ch -eq '.' -or $ch -eq '_' -or $ch -eq '-') {
            $ch
        }
        else {
            '-'
        }
    }

    $safe = (-join $safeChars).Trim('-')
    if ([string]::IsNullOrWhiteSpace($safe)) {
        return 'repository'
    }

    return $safe
}

function Read-ConfigurationMappings {
    param([string[]]$Mappings)

    $result = @{}
    foreach ($mapping in $Mappings) {
        if ([string]::IsNullOrWhiteSpace($mapping)) {
            continue
        }

        $colonIndex = $mapping.IndexOf(':')
        $equalsIndex = $mapping.IndexOf('=')
        if ($colonIndex -le 0 -or $equalsIndex -le ($colonIndex + 1) -or $equalsIndex -eq ($mapping.Length - 1)) {
            throw "ArtifactConfigurationFile entries must use component-key:relative-path=source-path syntax: $mapping"
        }

        $componentKey = $mapping.Substring(0, $colonIndex).Trim()
        $relativePath = $mapping.Substring($colonIndex + 1, $equalsIndex - $colonIndex - 1).Trim()
        $sourcePath = [System.IO.Path]::GetFullPath($mapping.Substring($equalsIndex + 1).Trim())

        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw "Artifact configuration source file was not found: $sourcePath"
        }

        if (-not $result.ContainsKey($componentKey)) {
            $result[$componentKey] = [System.Collections.Generic.List[string]]::new()
        }

        $result[$componentKey].Add("$relativePath=$sourcePath")
    }

    return $result
}

function Publish-DotNetComponent {
    param(
        [Parameter(Mandatory = $true)][object]$Component,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$BuildRoot,
        [Parameter(Mandatory = $true)][string]$Configuration,
        [Parameter(Mandatory = $true)][string]$PathMapRoot
    )

    $projectPath = [string](Get-JsonPropertyValue -Object $Component -Name 'projectPath')
    if ([string]::IsNullOrWhiteSpace($projectPath)) {
        return ''
    }

    $projectRoot = Resolve-PathFromBase -Path $projectPath -BasePath $RepositoryRoot
    if (-not (Test-Path -LiteralPath $projectRoot)) {
        return ''
    }

    $projectFile = if (Test-Path -LiteralPath $projectRoot -PathType Leaf) {
        $projectRoot
    }
    else {
        $projectFileItem = Get-ChildItem -LiteralPath $projectRoot -Filter '*.csproj' -File |
            Sort-Object Name |
            Select-Object -First 1
        if ($null -eq $projectFileItem) {
            ''
        }
        else {
            $projectFileItem.FullName
        }
    }

    if ([string]::IsNullOrWhiteSpace($projectFile)) {
        return ''
    }

    $outputPath = Join-Path $BuildRoot ([string]$Component.componentKey)
    $pathMap = '{0}={1}' -f $RepositoryRoot.TrimEnd('\', '/'), $PathMapRoot
    & dotnet publish $projectFile `
        -c $Configuration `
        -o $outputPath `
        --nologo `
        --verbosity minimal `
        -p:ContinuousIntegrationBuild=true `
        -p:Deterministic=true `
        "-p:PathMap=$pathMap" | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed for component '$($Component.componentKey)'."
    }

    return $outputPath
}

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $FileName @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) {
            throw "$FileName failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Publish-NodeWebComponent {
    param(
        [Parameter(Mandatory = $true)][object]$Component,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$BuildRoot
    )

    if (-not [string]::Equals([string]$Component.packageType, 'web-app', [StringComparison]::OrdinalIgnoreCase)) {
        return ''
    }

    $projectPath = [string](Get-JsonPropertyValue -Object $Component -Name 'projectPath')
    if ([string]::IsNullOrWhiteSpace($projectPath)) {
        return ''
    }

    $projectRoot = Resolve-PathFromBase -Path $projectPath -BasePath $RepositoryRoot
    $projectDirectory = if (Test-Path -LiteralPath $projectRoot -PathType Leaf) {
        Split-Path -Parent $projectRoot
    }
    else {
        $projectRoot
    }

    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'package.json') -PathType Leaf)) {
        return ''
    }

    if (Test-Path -LiteralPath (Join-Path $projectDirectory 'package-lock.json') -PathType Leaf) {
        Invoke-NativeChecked -FileName 'npm' -Arguments @('ci') -WorkingDirectory $projectDirectory
    }

    Invoke-NativeChecked -FileName 'npm' -Arguments @('run', 'build') -WorkingDirectory $projectDirectory

    $distPath = Join-Path $projectDirectory 'dist'
    if (-not (Test-Path -LiteralPath $distPath -PathType Container)) {
        throw "Node web component '$($Component.componentKey)' did not produce a dist folder: $distPath"
    }

    $outputPath = Join-Path $BuildRoot ([string]$Component.componentKey)
    if (Test-Path -LiteralPath $outputPath) {
        Remove-Item -LiteralPath $outputPath -Recurse -Force
    }

    New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
    Get-ChildItem -LiteralPath $distPath -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $outputPath -Recurse -Force
    }

    return $outputPath
}

function Remove-RuntimeConfigurationFilesFromFolder {
    param([Parameter(Mandatory = $true)][string]$Path)

    Get-ChildItem -LiteralPath $Path -File -Recurse | Where-Object {
        [string]::Equals($_.Name, 'appsettings.json', [StringComparison]::OrdinalIgnoreCase) -or
        ($_.Name.StartsWith('appsettings.', [StringComparison]::OrdinalIgnoreCase) -and $_.Name.EndsWith('.json', [StringComparison]::OrdinalIgnoreCase))
    } | Remove-Item -Force
}

function Copy-PortableObjectFiles {
    param(
        [string[]]$Files,
        [string]$DestinationRoot,
        [string]$ObjectName
    )

    foreach ($entry in $Files) {
        if ([string]::IsNullOrWhiteSpace($entry)) {
            continue
        }

        $sourcePath = $entry
        $destinationName = ''
        $equalsIndex = $entry.IndexOf('=')
        if ($equalsIndex -gt 0 -and $equalsIndex -lt ($entry.Length - 1)) {
            $destinationName = $entry.Substring(0, $equalsIndex).Trim()
            $sourcePath = $entry.Substring($equalsIndex + 1).Trim()
        }

        $resolvedSource = Resolve-PathFromBase -Path $sourcePath -BasePath $repositoryRoot
        if (-not (Test-Path -LiteralPath $resolvedSource -PathType Leaf)) {
            throw "$ObjectName file was not found: $resolvedSource"
        }

        if ([string]::IsNullOrWhiteSpace($destinationName)) {
            $destinationName = [System.IO.Path]::GetFileName($resolvedSource)
        }

        $extension = [System.IO.Path]::GetExtension($destinationName)
        if (-not ($extension.Equals('.json', [StringComparison]::OrdinalIgnoreCase) -or $extension.Equals('.zip', [StringComparison]::OrdinalIgnoreCase))) {
            throw "$ObjectName files must be JSON or zip files: $destinationName"
        }

        Copy-Item -LiteralPath $resolvedSource -Destination (Join-Path $DestinationRoot $destinationName) -Force
    }
}

function Copy-WidgetFiles {
    param(
        [string[]]$Files,
        [string]$DestinationRoot
    )

    foreach ($entry in @($Files)) {
        if ([string]::IsNullOrWhiteSpace($entry)) {
            continue
        }

        $separatorIndex = $entry.IndexOf('=')
        if ($separatorIndex -ge 0) {
            $destinationName = $entry.Substring(0, $separatorIndex).Trim()
            $sourcePath = $entry.Substring($separatorIndex + 1).Trim()
        }
        else {
            $sourcePath = $entry.Trim()
            $destinationName = [System.IO.Path]::GetFileName($sourcePath)
        }

        if ([string]::IsNullOrWhiteSpace($destinationName)) {
            throw "Widget file destination name is empty: $entry"
        }

        if (-not [System.IO.Path]::GetExtension($destinationName).Equals('.json', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Widget files must be JSON files: $destinationName"
        }

        $resolvedSource = Resolve-PathFromBase -Path $sourcePath -BasePath $repositoryRoot
        if (-not (Test-Path -LiteralPath $resolvedSource -PathType Leaf)) {
            throw "Widget file was not found: $resolvedSource"
        }

        Copy-Item -LiteralPath $resolvedSource -Destination (Join-Path $DestinationRoot $destinationName) -Force
    }
}

function Copy-WidgetDataFiles {
    param(
        [string[]]$Files,
        [string]$DestinationRoot
    )

    foreach ($entry in @($Files)) {
        if ([string]::IsNullOrWhiteSpace($entry)) {
            continue
        }

        $separatorIndex = $entry.IndexOf('=')
        if ($separatorIndex -ge 0) {
            $destinationName = $entry.Substring(0, $separatorIndex).Trim()
            $sourcePath = $entry.Substring($separatorIndex + 1).Trim()
        }
        else {
            $sourcePath = $entry.Trim()
            $destinationName = [System.IO.Path]::GetFileName($sourcePath)
        }

        if ([string]::IsNullOrWhiteSpace($destinationName)) {
            throw "Widget runtime data destination name is empty: $entry"
        }

        if (-not [System.IO.Path]::GetExtension($destinationName).Equals('.zip', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Widget runtime data files must be zip files: $destinationName"
        }

        $resolvedSource = Resolve-PathFromBase -Path $sourcePath -BasePath $repositoryRoot
        if (-not (Test-Path -LiteralPath $resolvedSource -PathType Leaf)) {
            throw "Widget runtime data file was not found: $resolvedSource"
        }

        Copy-Item -LiteralPath $resolvedSource -Destination (Join-Path $DestinationRoot $destinationName) -Force
    }
}

$scriptDirectory = Get-ScriptDirectory
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = (Resolve-Path (Join-Path $scriptDirectory '..\..')).Path
}

$repositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
$manifestPath = Join-Path $repositoryRoot 'omp-components.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Component manifest was not found: $manifestPath"
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repositoryRoot 'artifacts\omp-objects'
}
$outputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$definitionsRoot = Join-Path $outputRoot 'module-definitions'
$artifactsRoot = Join-Path $outputRoot 'artifacts'
$hostConfigsRoot = Join-Path $outputRoot 'host-configs'
$configOverlaysRoot = Join-Path $outputRoot 'config-overlays'
$widgetsRoot = Join-Path $outputRoot 'widgets'
$widgetDataRoot = Join-Path $outputRoot 'widget-data'
New-Item -ItemType Directory -Path $definitionsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $artifactsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $hostConfigsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $configOverlaysRoot -Force | Out-Null
New-Item -ItemType Directory -Path $widgetsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $widgetDataRoot -Force | Out-Null

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

$selectedComponents = @($manifest.components | Where-Object { Test-ArtifactComponent -Component $_ })
$selectedModuleKeys = $null
if ($ComponentKey.Count -gt 0) {
    $keySet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($key in $ComponentKey) {
        [void]$keySet.Add($key)
    }

    $selectedComponents = @($selectedComponents | Where-Object { $keySet.Contains([string]$_.componentKey) })
    $selectedModuleKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($component in $selectedComponents) {
        $moduleKey = [string](Get-JsonPropertyValue -Object $component -Name 'moduleKey')
        if (-not [string]::IsNullOrWhiteSpace($moduleKey)) {
            [void]$selectedModuleKeys.Add($moduleKey.Trim())
        }
    }
}
elseif (-not $AllComponents) {
    $selectedComponents = @()
}

if ($AllComponents -or $ComponentKey.Count -gt 0) {
    foreach ($entry in @((Get-JsonPropertyValue -Object $manifest -Name 'widgetFiles'))) {
        if ($null -eq $entry) {
            continue
        }

        if ($entry -is [string]) {
            if (-not [string]::IsNullOrWhiteSpace($entry)) {
                $WidgetFile += $entry
            }

            continue
        }

        $entryModuleKey = [string](Get-JsonPropertyValue -Object $entry -Name 'moduleKey')
        $hasScopedModuleKey = -not [string]::IsNullOrWhiteSpace($entryModuleKey)
        if ($null -ne $selectedModuleKeys -and $hasScopedModuleKey -and -not $selectedModuleKeys.Contains($entryModuleKey.Trim())) {
            continue
        }

        $sourcePath = [string](Get-JsonPropertyValue -Object $entry -Name 'sourcePath')
        if ([string]::IsNullOrWhiteSpace($sourcePath)) {
            $sourcePath = [string](Get-JsonPropertyValue -Object $entry -Name 'path')
        }

        if ([string]::IsNullOrWhiteSpace($sourcePath)) {
            throw 'Manifest widgetFiles entries must provide sourcePath or path.'
        }

        $destinationName = [string](Get-JsonPropertyValue -Object $entry -Name 'destinationName')
        if ([string]::IsNullOrWhiteSpace($destinationName)) {
            $WidgetFile += $sourcePath
        }
        else {
            $WidgetFile += "$($destinationName.Trim())=$($sourcePath.Trim())"
        }
    }
}

foreach ($definition in @($manifest.moduleDefinitions)) {
    if ($null -eq $definition) {
        continue
    }

    $definitionModuleKey = [string](Get-JsonPropertyValue -Object $definition -Name 'moduleKey')
    if ($null -ne $selectedModuleKeys -and -not $selectedModuleKeys.Contains($definitionModuleKey)) {
        continue
    }

    $definitionPath = Resolve-PathFromBase -Path ([string]$definition.path) -BasePath $repositoryRoot
    if (-not (Test-Path -LiteralPath $definitionPath -PathType Leaf)) {
        throw "Module definition file was not found: $definitionPath"
    }

    Copy-Item -LiteralPath $definitionPath -Destination (Join-Path $definitionsRoot ([System.IO.Path]::GetFileName($definitionPath))) -Force
}

$configurationMappings = Read-ConfigurationMappings -Mappings $ArtifactConfigurationFile
$ompRoot = Find-OmpRepositoryRoot -ConfiguredRoot $OmpRepositoryRoot -CurrentRepositoryRoot $repositoryRoot
$newArtifactPackageScript = Join-Path $ompRoot 'scripts\deployment\new-omp-artifact-package.ps1'
$buildRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('omp-repository-objects-' + [Guid]::NewGuid().ToString('N'))
$repositoryKey = [string](Get-JsonPropertyValue -Object $manifest -Name 'repositoryKey')
if ([string]::IsNullOrWhiteSpace($repositoryKey)) {
    $repositoryKey = Split-Path -Leaf $repositoryRoot
}

$pathMapRoot = '/_/' + (Get-SafePathMapSegment -Value $repositoryKey)

try {
    foreach ($component in $selectedComponents) {
        $packageName = Get-ArtifactPackageName -Component $component
        $existingPackage = @(
            Join-Path $repositoryRoot "artifacts\$packageName"
            Join-Path $repositoryRoot "artifacts\archive\$packageName"
            Join-Path $artifactsRoot $packageName
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1

        if (-not [string]::IsNullOrWhiteSpace($existingPackage) -and -not $BuildArtifacts) {
            Copy-Item -LiteralPath $existingPackage -Destination (Join-Path $artifactsRoot $packageName) -Force
            continue
        }

        $payloadPath = Publish-DotNetComponent `
            -Component $component `
            -RepositoryRoot $repositoryRoot `
            -BuildRoot $buildRoot `
            -Configuration $Configuration `
            -PathMapRoot $pathMapRoot

        if ([string]::IsNullOrWhiteSpace($payloadPath)) {
            $payloadPath = Publish-NodeWebComponent `
                -Component $component `
                -RepositoryRoot $repositoryRoot `
                -BuildRoot $buildRoot
        }

        if ([string]::IsNullOrWhiteSpace($payloadPath)) {
            if (-not [string]::IsNullOrWhiteSpace($existingPackage)) {
                Copy-Item -LiteralPath $existingPackage -Destination (Join-Path $artifactsRoot $packageName) -Force
                continue
            }

            Write-Warning "Skipping component '$($component.componentKey)' because no existing package was found and no publishable .NET or Node web projectPath is configured."
            continue
        }

        Remove-RuntimeConfigurationFilesFromFolder -Path $payloadPath

        $configurationFileArgs = @()
        if ($configurationMappings.ContainsKey([string]$component.componentKey)) {
            $configurationFileArgs = @($configurationMappings[[string]$component.componentKey])
        }

        $artifactPackageArgs = @{
            ModuleKey = [string]$component.moduleKey
            AppKey = [string]$component.appKey
            PackageType = [string]$component.packageType
            TargetName = [string]$component.targetName
            Version = [string]$component.version
            PayloadPath = $payloadPath
            OutputPath = $artifactsRoot
            ConfigurationFile = $configurationFileArgs
        }
        $minModuleDefinitionVersion = [string](Get-JsonPropertyValue -Object $component -Name 'minModuleDefinitionVersion')
        if (-not [string]::IsNullOrWhiteSpace($minModuleDefinitionVersion)) {
            $artifactPackageArgs.MinModuleDefinitionVersion = $minModuleDefinitionVersion.Trim()
        }

        & $newArtifactPackageScript @artifactPackageArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Artifact package creation failed for component '$($component.componentKey)'."
        }
    }
}
finally {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Copy-PortableObjectFiles -Files $HostConfigurationFile -DestinationRoot $hostConfigsRoot -ObjectName 'Host configuration'
Copy-PortableObjectFiles -Files $ConfigOverlayFile -DestinationRoot $configOverlaysRoot -ObjectName 'Config overlay'
Copy-WidgetFiles -Files $WidgetFile -DestinationRoot $widgetsRoot
Copy-WidgetDataFiles -Files $WidgetDataFile -DestinationRoot $widgetDataRoot

Write-Host "OMP module definitions: $definitionsRoot"
Write-Host "OMP artifact packages:   $artifactsRoot"
Write-Host "OMP host configs:        $hostConfigsRoot"
Write-Host "OMP config overlays:     $configOverlaysRoot"
Write-Host "OMP widgets:             $widgetsRoot"
Write-Host "OMP widget runtime data: $widgetDataRoot"
