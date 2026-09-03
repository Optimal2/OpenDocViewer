<#
.SYNOPSIS
Bumps OMP repository, component, module-definition, and widget versions.

.DESCRIPTION
This helper edits omp-components.json and, when module definitions are selected,
also updates the referenced module-definition JSON files. When widgets are
selected, it updates both the manifest widget entry and the referenced widget
package JSON. It is intentionally manifest-driven so OMP-compatible repositories
can expose the same command.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$RepositoryRoot = '',
    [string[]]$ComponentKey = @(),
    [switch]$AllComponents,
    [string[]]$ModuleKey = @(),
    [switch]$AllModuleDefinitions,
    [string[]]$WidgetFile = @(),
    [switch]$AllWidgets,
    [switch]$UpdateModuleMinimums,
    [switch]$SkipRepositoryVersion,
    # Raise repositoryVersion on its own, with no component, module or widget
    # target. omp-components.json has no Bootstrapper component, and the
    # installer package takes its identity from repositoryVersion
    # (package-hostagent-first.ps1), so a Bootstrapper-only change previously
    # had no canonical way to get a new package identity: the choice was between
    # hand-editing the manifest and bumping an unrelated artifact. Both are worse
    # than a flag that says exactly what it does.
    [switch]$RepositoryOnly,
    [string]$Part = 'patch',
    [string]$Version = '',
    [switch]$Interactive,
    [switch]$Pause,
    [string]$CascadeFrom = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ValidVersionParts = @('patch', 'minor', 'major')

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

    if ($Value -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
        throw "Version must use simplified SemVer-compatible text such as 1.2.3, 1.2.3-beta.1, or 1.2.3+build.5."
    }
}

function ConvertTo-ComparableVersion {
    <#
    .SYNOPSIS
    The numeric major.minor.patch core of a Test-VersionText-shaped string as [System.Version].
    Prerelease and build metadata ('1.2.3-beta.1', '1.2.3+build.5') are accepted by
    Test-VersionText but rejected by System.Version.TryParse, so every ordering comparison
    in this script goes through here instead. Anything without a numeric core throws:
    a comparison that silently does not happen is how a regression slips through.
    #>
    param([Parameter(Mandatory = $true)][string]$Value)

    $core = ($Value.Trim() -split '[-+]', 2)[0]
    $parsed = $null
    if (-not [System.Version]::TryParse($core, [ref]$parsed)) {
        throw "Version '$Value' has no numeric major.minor.patch core to compare."
    }

    return $parsed
}

function ConvertTo-VersionPart {
    param([Parameter(Mandatory = $true)][string]$Value)

    $normalized = $Value.Trim().ToLowerInvariant()
    if ($script:ValidVersionParts -notcontains $normalized) {
        throw "Version part must be one of: $($script:ValidVersionParts -join ', ')."
    }

    return $normalized
}

function Get-BumpedVersion {
    param(
        [Parameter(Mandatory = $true)][string]$CurrentVersion,
        [Parameter(Mandatory = $true)][string]$VersionPart
    )

    if ($CurrentVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "Cannot bump '$CurrentVersion' automatically. Automatic bumps only support plain major.minor.patch versions such as 1.2.3. Use -Version for prerelease/build metadata or other non-standard text."
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

function Get-JsonIndent {
    param(
        [Parameter(Mandatory = $true)][int]$Level,
        [Parameter(Mandatory = $true)][int]$IndentSize
    )

    return ' ' * ($Level * $IndentSize)
}

function Get-NextJsonNonWhitespaceIndex {
    param(
        [Parameter(Mandatory = $true)][string]$Json,
        [Parameter(Mandatory = $true)][int]$StartIndex
    )

    for ($index = $StartIndex; $index -lt $Json.Length; $index++) {
        if (-not [char]::IsWhiteSpace($Json[$index])) {
            return $index
        }
    }

    return -1
}

function Format-JsonText {
    param(
        [Parameter(Mandatory = $true)][string]$Json,
        [int]$IndentSize = 2
    )

    $builder = [Text.StringBuilder]::new()
    $indent = 0
    $inString = $false
    $isEscaped = $false

    for ($index = 0; $index -lt $Json.Length; $index++) {
        $ch = $Json[$index]

        if ($inString) {
            [void]$builder.Append($ch)
            if ($isEscaped) {
                $isEscaped = $false
            }
            elseif ($ch -eq [char]92) {
                $isEscaped = $true
            }
            elseif ($ch -eq '"') {
                $inString = $false
            }

            continue
        }

        switch ($ch) {
            '"' {
                $inString = $true
                [void]$builder.Append($ch)
            }
            '{' {
                $nextIndex = Get-NextJsonNonWhitespaceIndex -Json $Json -StartIndex ($index + 1)
                if ($nextIndex -ge 0 -and $Json[$nextIndex] -eq '}') {
                    [void]$builder.Append($ch)
                    [void]$builder.Append($Json[$nextIndex])
                    $index = $nextIndex
                    continue
                }

                [void]$builder.Append($ch)
                $indent++
                [void]$builder.Append([Environment]::NewLine)
                [void]$builder.Append((Get-JsonIndent -Level $indent -IndentSize $IndentSize))
            }
            '[' {
                $nextIndex = Get-NextJsonNonWhitespaceIndex -Json $Json -StartIndex ($index + 1)
                if ($nextIndex -ge 0 -and $Json[$nextIndex] -eq ']') {
                    [void]$builder.Append($ch)
                    [void]$builder.Append($Json[$nextIndex])
                    $index = $nextIndex
                    continue
                }

                [void]$builder.Append($ch)
                $indent++
                [void]$builder.Append([Environment]::NewLine)
                [void]$builder.Append((Get-JsonIndent -Level $indent -IndentSize $IndentSize))
            }
            '}' {
                $indent = [Math]::Max(0, $indent - 1)
                [void]$builder.Append([Environment]::NewLine)
                [void]$builder.Append((Get-JsonIndent -Level $indent -IndentSize $IndentSize))
                [void]$builder.Append($ch)
            }
            ']' {
                $indent = [Math]::Max(0, $indent - 1)
                [void]$builder.Append([Environment]::NewLine)
                [void]$builder.Append((Get-JsonIndent -Level $indent -IndentSize $IndentSize))
                [void]$builder.Append($ch)
            }
            ':' {
                [void]$builder.Append(': ')
            }
            ',' {
                [void]$builder.Append($ch)
                [void]$builder.Append([Environment]::NewLine)
                [void]$builder.Append((Get-JsonIndent -Level $indent -IndentSize $IndentSize))
            }
            default {
                if (-not [char]::IsWhiteSpace($ch)) {
                    [void]$builder.Append($ch)
                }
            }
        }
    }

    return $builder.ToString()
}

function Get-JsonFileText {
    <#
        The exact text Save-JsonFile would write. Broken out so a caller can ask
        "would writing this change the file?" without writing it -- which is what
        makes the follow-up-bump invariant structural rather than hopeful.
    #>
    param([Parameter(Mandatory = $true)][object]$Value)

    $json = $Value | ConvertTo-Json -Depth 50 -Compress
    return (Format-JsonText -Json $json) + [Environment]::NewLine
}

function Test-JsonFileWouldChange {
    <#
        True when writing $Value to $Path would produce different bytes than the
        file already holds. A missing file counts as a change.

        This is the measurement the follow-up bump depends on: the persist loop
        used to rewrite EVERY loaded definition unconditionally, so a definition
        that was merely formatted differently on disk -- hand-edited, or written
        by another generator -- was silently reserialised while its
        definitionVersion stayed put. HostAgent then rejects the re-imported
        definition, and the validator goes red on a change nobody made on purpose.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $true
    }

    $current = [IO.File]::ReadAllText($Path)
    return ($current -cne (Get-JsonFileText -Value $Value))
}

function Save-JsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    $formattedJson = Get-JsonFileText -Value $Value
    if ($PSCmdlet.ShouldProcess($Path, 'Write JSON file')) {
        [IO.File]::WriteAllText($Path, $formattedJson, [Text.UTF8Encoding]::new($false))
    }
}

function Convert-KeyInput {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return @()
    }

    return @(
        $Value.Split(',', [StringSplitOptions]::RemoveEmptyEntries) |
            ForEach-Object { $_.Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
}

function Get-WidgetFileEntryPath {
    param([object]$Entry)

    if ($Entry -is [string]) {
        return $Entry
    }

    $path = [string](Get-JsonPropertyValue -Object $Entry -Name 'sourcePath')
    if ([string]::IsNullOrWhiteSpace($path)) {
        $path = [string](Get-JsonPropertyValue -Object $Entry -Name 'path')
    }

    return $path
}

function Get-WidgetFileEntryVersion {
    param([object]$Entry)

    if ($Entry -is [string]) {
        return ''
    }

    $version = [string](Get-JsonPropertyValue -Object $Entry -Name 'widgetVersion')
    if ([string]::IsNullOrWhiteSpace($version)) {
        $version = [string](Get-JsonPropertyValue -Object $Entry -Name 'packageVersion')
    }
    if ([string]::IsNullOrWhiteSpace($version)) {
        $version = [string](Get-JsonPropertyValue -Object $Entry -Name 'version')
    }

    return $version
}

function Get-ManifestWidgetFileEntries {
    param(
        [Parameter(Mandatory = $true)][object]$Manifest,
        [string]$RepositoryVersion
    )

    $entries = @((Get-JsonPropertyValue -Object $Manifest -Name 'widgetFiles'))
    $result = [System.Collections.Generic.List[object]]::new()
    for ($index = 0; $index -lt $entries.Count; $index++) {
        $entry = $entries[$index]
        if ($null -eq $entry) {
            continue
        }

        $path = Get-WidgetFileEntryPath -Entry $entry
        if ([string]::IsNullOrWhiteSpace($path)) {
            continue
        }

        $version = Get-WidgetFileEntryVersion -Entry $entry
        if ([string]::IsNullOrWhiteSpace($version)) {
            $version = $RepositoryVersion
        }

        $result.Add([pscustomobject]@{
            Index = $index
            Entry = $entry
            Path = $path.Trim()
            WidgetVersion = if ([string]::IsNullOrWhiteSpace($version)) { '' } else { $version.Trim() }
        })
    }

    return $result.ToArray()
}

function Set-WidgetFileEntryVersion {
    param(
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][object]$WidgetEntry,
        [Parameter(Mandatory = $true)][string]$Version
    )

    if ($WidgetEntry.Entry -is [string]) {
        $replacement = [pscustomobject]@{
            path = $WidgetEntry.Path
            widgetVersion = $Version
        }
        $Manifest.widgetFiles[$WidgetEntry.Index] = $replacement
        return
    }

    Set-JsonProperty -Object $WidgetEntry.Entry -Name 'widgetVersion' -Value $Version
}

function Update-WidgetPackageFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Version
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Widget file was not found: $Path"
    }

    $json = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    Set-JsonProperty -Object $json -Name 'packageVersion' -Value $Version
    foreach ($widget in @((Get-JsonPropertyValue -Object $json -Name 'widgets'))) {
        if ($null -ne $widget) {
            Set-JsonProperty -Object $widget -Name 'widgetVersion' -Value $Version
        }
    }

    if ($PSCmdlet.ShouldProcess($Path, "Set dashboard widget packageVersion/widgetVersion to $Version")) {
        Save-JsonFile -Path $Path -Value $json
    }
}

$exitCode = 0
try {
    $Part = ConvertTo-VersionPart -Value $Part
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
    $repositoryVersion = [string](Get-JsonPropertyValue -Object $manifest -Name 'repositoryVersion')
    $widgetEntries = @(Get-ManifestWidgetFileEntries -Manifest $manifest -RepositoryVersion $repositoryVersion)

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

        if ($widgetEntries.Count -gt 0) {
            Write-Host ''
            Write-Host 'Dashboard widget files:'
            $widgetEntries | Select-Object Path, WidgetVersion | Format-Table -AutoSize

            $widgetInput = Read-Host 'Widget file paths to bump (Enter=none, all=all, comma-separated paths)'
            if ($widgetInput.Trim().Equals('all', [StringComparison]::OrdinalIgnoreCase)) {
                $AllWidgets = $true
            }
            elseif (-not [string]::IsNullOrWhiteSpace($widgetInput)) {
                $WidgetFile = Convert-KeyInput -Value $widgetInput
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

    if ($AllWidgets -and $WidgetFile.Count -gt 0) {
        throw 'Use either -AllWidgets or -WidgetFile, not both.'
    }

    if (-not [string]::IsNullOrWhiteSpace($CascadeFrom)) {
        if ($AllComponents) {
            throw '-CascadeFrom cannot be used with -AllComponents.'
        }

        if ($AllModuleDefinitions) {
            throw '-CascadeFrom cannot be used with -AllModuleDefinitions.'
        }
    }

    if ($RepositoryOnly) {
        # These combinations ask for opposite things. Obeying either silently
        # would be worse than refusing: -RepositoryOnly with a component target
        # would bump the artifact the caller said not to touch, and with
        # -SkipRepositoryVersion it would bump nothing at all while reporting
        # success.
        if ($AllComponents -or $ComponentKey.Count -gt 0 -or $AllModuleDefinitions -or $ModuleKey.Count -gt 0 -or
            $AllWidgets -or $WidgetFile.Count -gt 0 -or $Interactive -or -not [string]::IsNullOrWhiteSpace($CascadeFrom)) {
            throw '-RepositoryOnly raises repositoryVersion alone and cannot be combined with a component, module, widget, cascade or interactive target. Drop the target, or drop -RepositoryOnly.'
        }

        if ($SkipRepositoryVersion) {
            throw '-RepositoryOnly and -SkipRepositoryVersion ask for opposite things: one bumps only the repository version, the other bumps everything except it. Pass at most one.'
        }
    }
    elseif (-not $AllComponents -and $ComponentKey.Count -eq 0 -and -not $AllModuleDefinitions -and $ModuleKey.Count -eq 0 -and -not $AllWidgets -and $WidgetFile.Count -eq 0 -and -not $Interactive -and [string]::IsNullOrWhiteSpace($CascadeFrom)) {
        # No target given means "everything" -- but NOT when -RepositoryOnly was
        # asked for, or the flag meant to touch one line would bump every
        # artifact in the manifest.
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
        # Deduplicate the requested keys. '-ModuleKey foo,foo' used to select the
        # same definition twice and therefore bump it twice in one run, which is
        # never what the caller meant and produces a version nobody can explain.
        $seenModuleKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $selectedModuleDefinitions = @(foreach ($key in $ModuleKey) {
            $match = @($moduleDefinitions | Where-Object { $_.moduleKey -eq $key })
            if ($match.Count -ne 1) {
                throw "Module definition '$key' was not found exactly once in $manifestPath."
            }

            if ($seenModuleKeys.Add([string]$match[0].moduleKey)) {
                $match[0]
            }
        })
    }

    if ($AllWidgets) {
        $selectedWidgets = @($widgetEntries)
    }
    else {
        $selectedWidgets = @(foreach ($path in $WidgetFile) {
            $match = @($widgetEntries | Where-Object { $_.Path -eq $path })
            if ($match.Count -ne 1) {
                throw "Widget file '$path' was not found exactly once in $manifestPath."
            }

            $match[0]
        })
    }

    $selectedComponents = [System.Collections.Generic.List[object]]::new($selectedComponents)

    if (-not [string]::IsNullOrWhiteSpace($CascadeFrom)) {
        $sharedProjects = Get-JsonPropertyValue -Object $manifest -Name 'sharedProjects'
        if ($null -eq $sharedProjects) {
            throw "sharedProjects block not found in $manifestPath. -CascadeFrom requires shared project metadata."
        }

        $matchingSharedProject = @($sharedProjects | Where-Object { [string](Get-JsonPropertyValue -Object $_ -Name 'projectPath') -eq $CascadeFrom })
        if ($matchingSharedProject.Count -ne 1) {
            throw "Shared project '$CascadeFrom' was not found in $manifestPath."
        }

        $consumerKeys = @((Get-JsonPropertyValue -Object $matchingSharedProject[0] -Name 'consumers'))
        if ($consumerKeys.Count -eq 0) {
            Write-Host "Cascade from ${CascadeFrom}: no consumers declared."
        }
        else {
            $cascadeComponents = @(foreach ($key in $consumerKeys) {
                $match = @($components | Where-Object { $_.componentKey -eq $key })
                if ($match.Count -ne 1) {
                    throw "Cascade consumer '$key' was not found exactly once in $manifestPath."
                }

                $match[0]
            })

            $selectedKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            foreach ($component in $selectedComponents) {
                [void]$selectedKeys.Add([string]$component.componentKey)
            }

            $addedConsumers = [System.Collections.Generic.List[string]]::new()
            foreach ($component in $cascadeComponents) {
                $key = [string]$component.componentKey
                if (-not $selectedKeys.Contains($key)) {
                    [void]$selectedComponents.Add($component)
                    [void]$addedConsumers.Add($key)
                }
            }

            if ($addedConsumers.Count -gt 0) {
                Write-Host "Cascade from ${CascadeFrom}: bumping $($addedConsumers -join ', ')"
            }
            else {
                Write-Host "Cascade from ${CascadeFrom}: all consumers already selected, no additional components to bump."
            }
        }
    }

    $updates = [System.Collections.Generic.List[object]]::new()

    $hasSelectedVersionTargets = $selectedComponents.Count -gt 0 -or $selectedModuleDefinitions.Count -gt 0 -or $selectedWidgets.Count -gt 0
    if (-not $SkipRepositoryVersion -and ($hasSelectedVersionTargets -or $RepositoryOnly)) {
        $currentRepositoryVersion = [string]$manifest.repositoryVersion
        if ([string]::IsNullOrWhiteSpace($currentRepositoryVersion)) {
            throw 'repositoryVersion is missing. Add it manually or use -SkipRepositoryVersion.'
        }

        $nextRepositoryVersion = Get-NextVersion -CurrentVersion $currentRepositoryVersion

        # Guard against a version REGRESSION. -Version is returned verbatim by Get-NextVersion for
        # EVERY selected target, the repository included, so setting components to an explicit
        # version silently drags repositoryVersion backwards (observed 2026-07-19: bumping two
        # example components to 0.3.83 rewrote repositoryVersion 0.3.279 -> 0.3.83). A published
        # version must never go backwards, so fail loudly instead of corrupting the manifest.
        # ConvertTo-ComparableVersion throws on anything it cannot order, so the guard can
        # never be skipped for a prerelease or build-suffixed version. Only a manifest that
        # has no repositoryVersion yet has nothing to regress from.
        if (-not [string]::IsNullOrWhiteSpace($currentRepositoryVersion) -and
            (ConvertTo-ComparableVersion -Value $nextRepositoryVersion) -lt (ConvertTo-ComparableVersion -Value $currentRepositoryVersion)) {
            throw ("Refusing to regress repositoryVersion from '{0}' to '{1}'. -Version is applied to every " -f $currentRepositoryVersion, $nextRepositoryVersion) +
                  'selected target, including the repository. Pass -SkipRepositoryVersion when setting components ' +
                  'to an explicit version, or bump the repository separately.'
        }

        Set-JsonProperty -Object $manifest -Name 'repositoryVersion' -Value $nextRepositoryVersion
        [void]$updates.Add([pscustomobject]@{
            Item = 'repository'
            Key = [string]$manifest.repositoryKey
            OldVersion = $currentRepositoryVersion
            NewVersion = $nextRepositoryVersion
        })
    }

    # Module definitions whose compatibleArtifacts were rewritten by a component bump; their
    # own definitionVersion has to follow, see the note further down.
    $touchedModuleKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

    # Lazy-load module definition JSON documents keyed by moduleKey. This is
    # used both for the explicit -ModuleKey/-AllModuleDefinitions bump path
    # and for updating compatibleArtifacts.maxVersion when a component bump
    # touches an appKey declared in the module definition.
    $definitionJsonByKey = @{}
    $definitionPathByKey = @{}

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

        # -------------------------------------------------------------------
        # Keep compatibleArtifacts.maxVersion in sync with the bumped
        # component. The 2026-08-18 IbsPackager import failure showed that
        # leaving this step manual let the version matrix drift: the
        # component was bumped but the module definition still capped the
        # artifact version, so the host rejected the produced artifact.
        # -------------------------------------------------------------------
        $componentAppKey = [string](Get-JsonPropertyValue -Object $component -Name 'appKey')
        $componentModuleKey = [string](Get-JsonPropertyValue -Object $component -Name 'moduleKey')
        if ([string]::IsNullOrWhiteSpace($componentAppKey) -or [string]::IsNullOrWhiteSpace($componentModuleKey)) {
            continue
        }

        $moduleDefinitionEntry = @($moduleDefinitions | Where-Object { [string](Get-JsonPropertyValue -Object $_ -Name 'moduleKey') -eq $componentModuleKey })
        if ($moduleDefinitionEntry.Count -ne 1) {
            continue
        }

        $relativeDefinitionPath = [string](Get-JsonPropertyValue -Object $moduleDefinitionEntry[0] -Name 'path')
        if ([string]::IsNullOrWhiteSpace($relativeDefinitionPath)) {
            continue
        }

        if (-not $definitionJsonByKey.ContainsKey($componentModuleKey)) {
            $definitionPath = Resolve-FullPath -Path (Join-Path $repositoryRoot $relativeDefinitionPath)
            $definitionPathByKey[$componentModuleKey] = $definitionPath
            if (Test-Path -LiteralPath $definitionPath -PathType Leaf) {
                $definitionJsonByKey[$componentModuleKey] = Get-Content -LiteralPath $definitionPath -Raw -Encoding UTF8 | ConvertFrom-Json
            }
            else {
                $definitionJsonByKey[$componentModuleKey] = $null
            }
        }

        $definitionJson = $definitionJsonByKey[$componentModuleKey]
        if ($null -eq $definitionJson) {
            continue
        }

        $compatibleArtifacts = Get-JsonPropertyValue -Object $definitionJson -Name 'compatibleArtifacts'
        if ($null -eq $compatibleArtifacts) {
            continue
        }

        foreach ($artifact in @($compatibleArtifacts)) {
            if ($null -eq $artifact) {
                continue
            }

            $artifactAppKey = [string](Get-JsonPropertyValue -Object $artifact -Name 'appKey')
            if (-not [string]::Equals($artifactAppKey, $componentAppKey, [StringComparison]::OrdinalIgnoreCase)) {
                continue
            }

            $currentMaxVersion = [string](Get-JsonPropertyValue -Object $artifact -Name 'maxVersion')
            $shouldUpdate = $false
            if ([string]::IsNullOrWhiteSpace($currentMaxVersion)) {
                $shouldUpdate = $true
            }
            else {
                # Same comparable-core rule as the repository guard: a prerelease suffix is
                # legal version text and must not abort the bump.
                try {
                    $parsedCurrentMaxVersion = ConvertTo-ComparableVersion -Value $currentMaxVersion
                }
                catch {
                    throw "Module definition '$componentModuleKey' compatibleArtifacts entry for appKey '$componentAppKey' has non-numeric maxVersion '$currentMaxVersion'. Update it manually before bumping."
                }

                try {
                    $parsedNextVersion = ConvertTo-ComparableVersion -Value $nextVersion
                }
                catch {
                    throw "Component '$($component.componentKey)' was bumped to non-numeric version '$nextVersion'. Cannot compare with compatibleArtifacts.maxVersion '$currentMaxVersion'."
                }

                if ($parsedNextVersion -gt $parsedCurrentMaxVersion) {
                    $shouldUpdate = $true
                }
            }

            if ($shouldUpdate) {
                Set-JsonProperty -Object $artifact -Name 'maxVersion' -Value $nextVersion
                [void]$touchedModuleKeys.Add($componentModuleKey)
                [void]$updates.Add([pscustomobject]@{
                    Item = 'module-definition-compatible-artifact'
                    Key = "$componentModuleKey/$componentAppKey"
                    OldVersion = if ([string]::IsNullOrWhiteSpace($currentMaxVersion)) { '(unbounded)' } else { $currentMaxVersion }
                    NewVersion = $nextVersion
                })
            }
        }
    }

    # A component bump rewrites compatibleArtifacts.maxVersion in the module definition, which
    # CHANGES the definition -- and HostAgent rejects a re-imported definition that carries the
    # same definitionVersion with different content. The bump therefore has to carry the
    # definition's own version with it, or local-ci and the pre-push gate refuse the result and
    # the user has to discover a second command that nothing mentions
    # (`-ModuleKey <module> -SkipRepositoryVersion`). Measured twice on 2026-08-23, both times
    # mid-incident, and repeatedly since.
    #
    # A definition whose FILE would change must carry a version bump, even when
    # nothing semantic changed. The persist loop below used to rewrite every loaded
    # definition unconditionally, so a file that was merely formatted differently on
    # disk was reserialised while definitionVersion stayed put -- and HostAgent
    # rejects a re-imported definition that carries the same version with different
    # content. Deciding this BEFORE the selection makes the invariant structural:
    # different bytes on disk implies a bump, with no path around it.
    foreach ($entry in $definitionJsonByKey.GetEnumerator()) {
        if ($null -eq $entry.Value) {
            continue
        }

        $candidatePath = [string]$definitionPathByKey[$entry.Key]
        if ([string]::IsNullOrWhiteSpace($candidatePath)) {
            continue
        }

        if (Test-JsonFileWouldChange -Path $candidatePath -Value $entry.Value) {
            [void]$touchedModuleKeys.Add($entry.Key)
        }
    }

    # Rather than duplicating the bump logic, the touched definitions are added to the normal
    # selection below, so they go through exactly the same code path as an explicit -ModuleKey.
    foreach ($moduleKey in $touchedModuleKeys) {
        if ($selectedModuleDefinitions | Where-Object { $_.moduleKey -eq $moduleKey }) {
            continue
        }

        $match = @($moduleDefinitions | Where-Object { $_.moduleKey -eq $moduleKey })
        if ($match.Count -eq 1) {
            $selectedModuleDefinitions = @($selectedModuleDefinitions) + $match[0]
        }
    }

    # Persist any compatibleArtifacts changes made above.
    #
    # Definitions that are in the selection are deliberately NOT written here: the
    # definitionVersion loop below writes them once, with the bumped version, from
    # the same in-memory object. Writing them twice was its own defect -- the first
    # write carried the OLD definitionVersion, so an interrupted run left the file
    # in exactly the half-bumped state this fix exists to eliminate.
    foreach ($entry in $definitionJsonByKey.GetEnumerator()) {
        $moduleKey = $entry.Key
        $definitionJson = $entry.Value
        if ($null -eq $definitionJson) {
            continue
        }

        $definitionPath = [string]$definitionPathByKey[$moduleKey]
        if ([string]::IsNullOrWhiteSpace($definitionPath)) {
            continue
        }

        if ($selectedModuleDefinitions | Where-Object { $_.moduleKey -eq $moduleKey }) {
            continue
        }

        # Nothing to write: the file already holds exactly these bytes.
        if (-not (Test-JsonFileWouldChange -Path $definitionPath -Value $definitionJson)) {
            continue
        }

        if ($PSCmdlet.ShouldProcess($definitionPath, "Update compatibleArtifacts.maxVersion for module '$moduleKey'")) {
            Save-JsonFile -Path $definitionPath -Value $definitionJson
        }
    }

    $moduleVersionByKey = @{}
    foreach ($moduleDefinition in $selectedModuleDefinitions) {
        $currentVersion = [string]$moduleDefinition.definitionVersion
        $nextVersion = Get-NextVersion -CurrentVersion $currentVersion
        Set-JsonProperty -Object $moduleDefinition -Name 'definitionVersion' -Value $nextVersion
        $moduleVersionByKey[[string]$moduleDefinition.moduleKey] = $nextVersion

        $definitionPath = Resolve-FullPath -Path (Join-Path $repositoryRoot ([string]$moduleDefinition.path))
        if (Test-Path -LiteralPath $definitionPath -PathType Leaf) {
            # Prefer the object already in memory. Reloading from disk here used to
            # discard the compatibleArtifacts.maxVersion change the persist loop had
            # just written, which is why that loop had to write first -- and that
            # double write is exactly what left a half-bumped file behind when a run
            # was interrupted between the two.
            $definitionKey = [string]$moduleDefinition.moduleKey
            $definitionJson = $definitionJsonByKey[$definitionKey]
            if ($null -eq $definitionJson) {
                $definitionJson = Get-Content -LiteralPath $definitionPath -Raw -Encoding UTF8 | ConvertFrom-Json
            }
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
            # $moduleKey used to be the name here -- and PowerShell variable names are
            # case-insensitive, so it WAS the [string[]]$ModuleKey parameter. The type
            # constraint coerced the assignment to a one-element String[], which no
            # Hashtable string key can ever match, so the loop body was unreachable and
            # -UpdateModuleMinimums printed a green table while writing nothing. The
            # documented repair command could not repair (R7-G4). Use
            # Get-JsonPropertyValue for minModuleDefinitionVersion too: 10 of 13
            # components do not carry the property, and direct access under
            # Set-StrictMode would turn the silent no-op into a crash mid-write.
            $componentModuleKey = [string](Get-JsonPropertyValue -Object $component -Name 'moduleKey')
            if ([string]::IsNullOrWhiteSpace($componentModuleKey) -or -not $moduleVersionByKey.ContainsKey($componentModuleKey)) {
                continue
            }

            $oldMinimum = [string](Get-JsonPropertyValue -Object $component -Name 'minModuleDefinitionVersion')
            $newMinimum = [string]$moduleVersionByKey[$componentModuleKey]
            Set-JsonProperty -Object $component -Name 'minModuleDefinitionVersion' -Value $newMinimum
            [void]$updates.Add([pscustomobject]@{
                Item = 'component-min-module-definition'
                Key = [string]$component.componentKey
                OldVersion = $oldMinimum
                NewVersion = $newMinimum
            })
        }
    }

    foreach ($widgetEntry in $selectedWidgets) {
        $currentVersion = [string]$widgetEntry.WidgetVersion
        if ([string]::IsNullOrWhiteSpace($currentVersion)) {
            throw "Widget file '$($widgetEntry.Path)' has no widgetVersion and repositoryVersion is missing. Set a version manually or add repositoryVersion."
        }

        $nextVersion = Get-NextVersion -CurrentVersion $currentVersion
        Set-WidgetFileEntryVersion -Manifest $manifest -WidgetEntry $widgetEntry -Version $nextVersion

        $widgetPath = Resolve-FullPath -Path (Join-Path $repositoryRoot ([string]$widgetEntry.Path))
        Update-WidgetPackageFile -Path $widgetPath -Version $nextVersion

        [void]$updates.Add([pscustomobject]@{
            Item = 'dashboard-widget'
            Key = [string]$widgetEntry.Path
            OldVersion = $currentVersion
            NewVersion = $nextVersion
        })
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
    Write-Error -Message ([string]$_) -ErrorAction Continue
}
finally {
    Wait-ForUser -Enabled:$Pause
}

if ($exitCode -ne 0) {
    exit $exitCode
}
