[CmdletBinding(SupportsShouldProcess)]
param(
    [string[]]$ComponentKey = @(),
    [switch]$All,
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Part = 'patch',
    [string]$Version = '',
    [string]$ManifestPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'omp-components.json')
)

Set-StrictMode -Version Latest

function Resolve-FullPath {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Assert-VersionText {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
        throw "Version must use SemVer-style text such as 1.2.3 or 1.2.3-beta.1."
    }
}

function Get-BumpedVersion {
    param(
        [string]$CurrentVersion,
        [string]$Part
    )

    if ($CurrentVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "Cannot bump '$CurrentVersion' automatically. Use -Version for prerelease/build versions or non-standard text."
    }

    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $patch = [int]$Matches[3]

    switch ($Part) {
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

function Set-JsonProperty {
    param(
        [object]$Object,
        [string]$Name,
        [object]$Value
    )

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
        return
    }

    $property.Value = $Value
}

$resolvedManifestPath = Resolve-FullPath -Path $ManifestPath
if (-not (Test-Path -LiteralPath $resolvedManifestPath -PathType Leaf)) {
    throw "Component manifest not found: $resolvedManifestPath"
}

if ($All -and $ComponentKey.Count -gt 0) {
    throw 'Use either -All or -ComponentKey, not both.'
}

if (-not $All -and $ComponentKey.Count -eq 0) {
    throw 'Specify one or more -ComponentKey values, or use -All.'
}

$manifest = Get-Content -LiteralPath $resolvedManifestPath -Raw | ConvertFrom-Json
$components = @($manifest.components)
if ($components.Count -eq 0) {
    throw "Component manifest contains no components: $resolvedManifestPath"
}

$selectedComponents = if ($All) {
    $components
} else {
    foreach ($key in $ComponentKey) {
        $matchesForKey = @($components | Where-Object { $_.componentKey -eq $key })
        if ($matchesForKey.Count -eq 0) {
            throw "Component '$key' was not found in $resolvedManifestPath."
        }

        if ($matchesForKey.Count -gt 1) {
            throw "Component key '$key' is duplicated in $resolvedManifestPath."
        }

        $matchesForKey[0]
    }
}

$updates = @()
foreach ($component in $selectedComponents) {
    $currentVersion = [string]$component.version
    $nextVersion = if ([string]::IsNullOrWhiteSpace($Version)) {
        Get-BumpedVersion -CurrentVersion $currentVersion -Part $Part
    } else {
        Assert-VersionText -Value $Version
        $Version.Trim()
    }

    $updates += [pscustomobject]@{
        ComponentKey = [string]$component.componentKey
        OldVersion = $currentVersion
        NewVersion = $nextVersion
    }

    Set-JsonProperty -Object $component -Name 'version' -Value $nextVersion
}

if ($selectedComponents.Count -eq $components.Count) {
    $versionsAfterUpdate = @($components | ForEach-Object { [string]$_.version } | Select-Object -Unique)
    if ($versionsAfterUpdate.Count -eq 1) {
        Set-JsonProperty -Object $manifest -Name 'repositoryVersion' -Value $versionsAfterUpdate[0]
    }
}

if ($PSCmdlet.ShouldProcess($resolvedManifestPath, "Update $($selectedComponents.Count) component version(s)")) {
    $json = $manifest | ConvertTo-Json -Depth 20
    Set-Content -LiteralPath $resolvedManifestPath -Value $json -Encoding UTF8
}

$updates | Format-Table -AutoSize
