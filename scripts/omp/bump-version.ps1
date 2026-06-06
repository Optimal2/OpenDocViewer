<#
.SYNOPSIS
Bumps OMP repository, component, and module-definition versions.

.DESCRIPTION
This helper edits omp-components.json and, when module definitions are selected,
also updates the referenced module-definition JSON files. It is intentionally
manifest-driven so OMP-compatible repositories can expose the same command.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$RepositoryRoot = '',
    [string[]]$ComponentKey = @(),
    [switch]$AllComponents,
    [string[]]$ModuleKey = @(),
    [switch]$AllModuleDefinitions,
    [switch]$UpdateModuleMinimums,
    [switch]$SkipRepositoryVersion,
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Part = 'patch',
    [string]$Version = '',
    [switch]$Interactive,
    [switch]$Pause
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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

function Wait-ForUser {
    param([switch]$Enabled)

    if ($Enabled) {
        [void](Read-Host 'Press Enter to close')
    }
}

function Resolve-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Test-VersionText {
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
        throw "Version must use SemVer-style text such as 1.2.3 or 1.2.3-beta.1."
    }
}

function Get-BumpedVersion {
    param(
        [Parameter(Mandatory = $true)][string]$CurrentVersion,
        [Parameter(Mandatory = $true)][string]$VersionPart
    )

    if ($CurrentVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "Cannot bump '$CurrentVersion' automatically. Use -Version for prerelease/build versions or non-standard text."
    }

    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $patch = [int]$Matches[3]

    switch ($VersionPart) {
        'major' {
            $major += 1
            $minor = 0
            $patch = 0
        }
        'minor' {
            $minor += 1
            $patch = 0
        }
        default {
            $patch += 1
        }
    }

    return "$major.$minor.$patch"
}

function Get-NextVersion {
    param([Parameter(Mandatory = $true)][string]$CurrentVersion)

    if ([string]::IsNullOrWhiteSpace($script:Version)) {
        return Get-BumpedVersion -CurrentVersion $CurrentVersion -VersionPart $script:Part
    }

    Test-VersionText -Value $script:Version
    return $script:Version.Trim()
}

function Set-JsonProperty {
    param(
        [Parameter(Mandatory = $true)][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        [object]$Value
    )

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
        return
    }

    $property.Value = $Value
}

function Save-JsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 50
    [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Convert-KeyInput {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return @()
    }

    return @($Value.Split(',', [StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$exitCode = 0
try {
    $scriptDirectory = Get-ScriptDirectory
    if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
        $RepositoryRoot = (Resolve-Path (Join-Path $scriptDirectory '..\..')).Path
    }

    $repositoryRoot = Resolve-FullPath -Path $RepositoryRoot
    $manifestPath = Join-Path $repositoryRoot 'omp-components.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Component manifest not found: $manifestPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $components = @($manifest.components)
    $moduleDefinitions = @($manifest.moduleDefinitions)

    if ($Interactive) {
        Write-Host ''
        Write-Host "Repository: $repositoryRoot"
        Write-Host ''
        Write-Host 'Components:'
        $components | Select-Object componentKey, version, moduleKey | Format-Table -AutoSize

        $componentInput = Read-Host 'Component keys to bump (Enter=all, none=skip artifacts, comma-separated keys)'
        if ([string]::IsNullOrWhiteSpace($componentInput)) {
            $AllComponents = $true
        }
        elseif ($componentInput.Trim().Equals('none', [StringComparison]::OrdinalIgnoreCase)) {
            $ComponentKey = @()
            $AllComponents = $false
        }
        else {
            $ComponentKey = Convert-KeyInput -Value $componentInput
            $AllComponents = $false
        }

        if ($moduleDefinitions.Count -gt 0) {
            Write-Host ''
            Write-Host 'Module definitions:'
            $moduleDefinitions | Select-Object moduleKey, definitionVersion, path | Format-Table -AutoSize

            $moduleInput = Read-Host 'Module definition keys to bump (Enter=none, all=all, comma-separated module keys)'
            if ($moduleInput.Trim().Equals('all', [StringComparison]::OrdinalIgnoreCase)) {
                $AllModuleDefinitions = $true
            }
            elseif (-not [string]::IsNullOrWhiteSpace($moduleInput)) {
                $ModuleKey = Convert-KeyInput -Value $moduleInput
            }

            if ($AllModuleDefinitions -or $ModuleKey.Count -gt 0) {
                $minimumInput = Read-Host 'Update matching component minModuleDefinitionVersion values? (Y/n)'
                $UpdateModuleMinimums = -not $minimumInput.Trim().Equals('n', [StringComparison]::OrdinalIgnoreCase)
            }
        }

        $partInput = Read-Host 'Version part to bump (patch/minor/major, Enter=patch)'
        if (-not [string]::IsNullOrWhiteSpace($partInput)) {
            if (@('patch', 'minor', 'major') -notcontains $partInput.Trim().ToLowerInvariant()) {
                throw "Unsupported version part: $partInput"
            }

            $Part = $partInput.Trim().ToLowerInvariant()
        }
    }

    if ($AllComponents -and $ComponentKey.Count -gt 0) {
        throw 'Use either -AllComponents or -ComponentKey, not both.'
    }

    if ($AllModuleDefinitions -and $ModuleKey.Count -gt 0) {
        throw 'Use either -AllModuleDefinitions or -ModuleKey, not both.'
    }

    if (-not $AllComponents -and $ComponentKey.Count -eq 0 -and -not $AllModuleDefinitions -and $ModuleKey.Count -eq 0 -and -not $Interactive) {
        $AllComponents = $true
    }

    if ($AllComponents) {
        $selectedComponents = @($components)
    }
    else {
        $selectedComponents = @(foreach ($key in $ComponentKey) {
            $match = @($components | Where-Object { $_.componentKey -eq $key })
            if ($match.Count -ne 1) {
                throw "Component '$key' was not found exactly once in $manifestPath."
            }

            $match[0]
        })
    }

    if ($AllModuleDefinitions) {
        $selectedModuleDefinitions = @($moduleDefinitions)
    }
    else {
        $selectedModuleDefinitions = @(foreach ($key in $ModuleKey) {
            $match = @($moduleDefinitions | Where-Object { $_.moduleKey -eq $key })
            if ($match.Count -ne 1) {
                throw "Module definition '$key' was not found exactly once in $manifestPath."
            }

            $match[0]
        })
    }

    $updates = [System.Collections.Generic.List[object]]::new()

    $hasSelectedVersionTargets = $selectedComponents.Count -gt 0 -or $selectedModuleDefinitions.Count -gt 0
    if (-not $SkipRepositoryVersion -and $hasSelectedVersionTargets) {
        $currentRepositoryVersion = [string]$manifest.repositoryVersion
        if ([string]::IsNullOrWhiteSpace($currentRepositoryVersion)) {
            throw 'repositoryVersion is missing. Add it manually or use -SkipRepositoryVersion.'
        }

        $nextRepositoryVersion = Get-NextVersion -CurrentVersion $currentRepositoryVersion
        Set-JsonProperty -Object $manifest -Name 'repositoryVersion' -Value $nextRepositoryVersion
        [void]$updates.Add([pscustomobject]@{
            Item = 'repository'
            Key = [string]$manifest.repositoryKey
            OldVersion = $currentRepositoryVersion
            NewVersion = $nextRepositoryVersion
        })
    }

    foreach ($component in $selectedComponents) {
        $currentVersion = [string]$component.version
        $nextVersion = Get-NextVersion -CurrentVersion $currentVersion
        Set-JsonProperty -Object $component -Name 'version' -Value $nextVersion
        [void]$updates.Add([pscustomobject]@{
            Item = 'component'
            Key = [string]$component.componentKey
            OldVersion = $currentVersion
            NewVersion = $nextVersion
        })
    }

    $moduleVersionByKey = @{}
    foreach ($moduleDefinition in $selectedModuleDefinitions) {
        $currentVersion = [string]$moduleDefinition.definitionVersion
        $nextVersion = Get-NextVersion -CurrentVersion $currentVersion
        Set-JsonProperty -Object $moduleDefinition -Name 'definitionVersion' -Value $nextVersion
        $moduleVersionByKey[[string]$moduleDefinition.moduleKey] = $nextVersion

        $definitionPath = Resolve-FullPath -Path (Join-Path $repositoryRoot ([string]$moduleDefinition.path))
        if (Test-Path -LiteralPath $definitionPath -PathType Leaf) {
            $definitionJson = Get-Content -LiteralPath $definitionPath -Raw -Encoding UTF8 | ConvertFrom-Json
            Set-JsonProperty -Object $definitionJson -Name 'definitionVersion' -Value $nextVersion
            if ($PSCmdlet.ShouldProcess($definitionPath, "Set definitionVersion to $nextVersion")) {
                Save-JsonFile -Path $definitionPath -Value $definitionJson
            }
        }

        [void]$updates.Add([pscustomobject]@{
            Item = 'module-definition'
            Key = [string]$moduleDefinition.moduleKey
            OldVersion = $currentVersion
            NewVersion = $nextVersion
        })
    }

    if ($UpdateModuleMinimums -and $moduleVersionByKey.Count -gt 0) {
        foreach ($component in $components) {
            $moduleKey = [string]$component.moduleKey
            if (-not $moduleVersionByKey.ContainsKey($moduleKey)) {
                continue
            }

            $oldMinimum = [string]$component.minModuleDefinitionVersion
            $newMinimum = [string]$moduleVersionByKey[$moduleKey]
            Set-JsonProperty -Object $component -Name 'minModuleDefinitionVersion' -Value $newMinimum
            [void]$updates.Add([pscustomobject]@{
                Item = 'component-min-module-definition'
                Key = [string]$component.componentKey
                OldVersion = $oldMinimum
                NewVersion = $newMinimum
            })
        }
    }

    if ($updates.Count -gt 0 -and $PSCmdlet.ShouldProcess($manifestPath, 'Update OMP component manifest versions')) {
        Save-JsonFile -Path $manifestPath -Value $manifest
    }

    Write-Host ''
    if ($updates.Count -eq 0) {
        Write-Host 'No versions were changed.'
    }
    else {
        $updates | Format-Table -AutoSize
    }

    $generatorPath = Join-Path $repositoryRoot 'scripts\omp\update-module-definition.ps1'
    if ($selectedModuleDefinitions.Count -gt 0 -and (Test-Path -LiteralPath $generatorPath -PathType Leaf)) {
        Write-Warning "This repository has scripts/omp/update-module-definition.ps1. If it hardcodes definitionVersion, update that generator too before regenerating module definitions."
    }
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
