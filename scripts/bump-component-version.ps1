[CmdletBinding(SupportsShouldProcess)]
param(
[string[]]$ComponentKey = @(),
    [switch]$All,
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Part = 'patch',
    [string]$Version = '',
    [string]$ManifestPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'omp-components.json'),
    [switch]$AllowDeprecated
)

# ---------------------------------------------------------------------------
# SPÄRR (2026-08-23). Det här skriptet gör en OFULLSTÄNDIG bump och har valts av
# misstag flera gånger — dess namn låter mer specifikt än det kanoniska, så den
# som vill "bumpa en komponent" landar här. En Write-Warning räckte inte: en
# varning i ett skriptutflöde syns inte för den som läser exit-koden.
# Nu måste avvikelsen vara ett aktivt val.
# ---------------------------------------------------------------------------
if (-not $AllowDeprecated) {
    throw @"
DEPRECATED: scripts/bump-component-version.ps1 gör en OFULLSTÄNDIG bump.

ANVÄND I STÄLLET (kanoniskt skript, hela versionsmatrisen):

    .\scripts\omp\bump-version.ps1 -ComponentKey <komponentnyckel>
    .\scripts\omp\bump-version.ps1 -AllComponents -AllModuleDefinitions -UpdateModuleMinimums

Det kanoniska skriptet uppdaterar ALLT som hänger ihop:
  - komponentversioner i omp-components.json
  - definitionVersion i varje berörd module-definition.json
  - compatibleArtifacts.maxVersion per modul
  - widgetversioner
  - repositoryVersion

DET HÄR skriptet bumpar BARA komponentversioner. Resultatet blir ett halvbumpat
repo som pre-push-grinden avvisar, och om det ändå når en värd avvisar
HostAgenten importen med "same version, different content".

Behöver du verkligen en komponent-only-bump och tänker själv stämma av
repositoryVersion och moduldefinitionerna efteråt:

    .\scripts\bump-component-version.ps1 -AllowDeprecated <övriga argument>
"@
}


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

function Write-Utf8NoBomFile {
    param(
        [string]$Path,
        [string]$Value
    )

    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Value, $encoding)
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
    $json = $manifest | ConvertTo-Json -Depth 100
    Write-Utf8NoBomFile -Path $resolvedManifestPath -Value ($json + [Environment]::NewLine)
    $updates | Format-Table -AutoSize
} else {
    Write-Host 'WhatIf: component versions were calculated but the manifest was not updated.'
    $updates | Format-Table -AutoSize
}
