<#
.SYNOPSIS
Validates component version metadata in omp-components.json for the OpenDocViewer repository.

.DESCRIPTION
Checks that every component listed in omp-components.json has a valid version,
points to an existing .csproj project (or, for web-app components, a
package.json), references a declared module definition, and that module
definition versions stay in sync with the manifest.

Additionally guards owned seed SQL against two silent failure classes:
  - Unconditional artifact-pointer writes (ArtifactId/DesiredArtifactId assigned
    directly from source in a MERGE/UPSERT without a NULL-preserving COALESCE
    guard), which can overwrite correct pointers and cause runtime outages
    (Check 17, repo-local to OpenDocViewer).
  - Stale embedded SQL: sqlScripts[].content (base64) and its sha256 must match
    the referenced SQL file on disk byte-for-byte (Check 16, stricter variant).

The "Check N" numbers are STABLE identifiers shared by every OMP-compatible
repository: a given number means the same check in every validator. The
canonical list, including which checks are platform-only or consumer-only by
design, lives in docs/VALIDATOR_CHECKS.md in the OpenModulePlatform
repository. The generic helper functions live in
validate-component-versions.helpers.ps1 next to this script; that file is part
of the shared core and is kept byte-identical across repositories by the
shared-script drift guard (Check 15).

This script validates the manifest only. Assembly versions in
Directory.Build.props are intentionally decoupled from omp-components.json
component versions: they are statically set to 0.1.0 for all C# projects.
OMP artifact identity is determined by the component manifest version plus
SHA-256 content hash, not by assembly version.

.PARAMETER BaseCommit
Git ref to diff against. Defaults to origin/main.

.PARAMETER SelfTest
Runs the canonical validator-family self-test (the PowerShell 5.1 pitfalls
that have actually broken this gate: the BOM strip and fail-loud git change
detection) and exits.

.PARAMETER Strict
Treat a guard that could not run as an error. Without it, Check 15 (shared
script drift) reports "not verified" as a warning when the canonical
OpenModulePlatform script cannot be found.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$BaseCommit = '',

    [Parameter(Mandatory = $false)]
    [switch]$SelfTest,

    [Parameter(Mandatory = $false)]
    [switch]$Strict
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Ensure git output is decoded as UTF-8 so embedded BOMs and non-ASCII
# characters are preserved exactly as stored in the repository.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-ScriptDirectory {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return $PSScriptRoot
    }

    $scriptPath = $PSCommandPath
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        $scriptPath = $MyInvocation.MyCommand.Path
    }

    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        throw 'Could not resolve script directory.'
    }

    return Split-Path -Parent $scriptPath
}

# The shared validator core. Mandatory, not optional: without it most checks
# cannot run at all, and a gate that cannot run must not read as a passing one.
# The helpers file is kept byte-identical across repositories by the
# shared-script drift guard (Check 15).
$helpersPath = Join-Path (Get-ScriptDirectory) 'validate-component-versions.helpers.ps1'
if (-not (Test-Path -LiteralPath $helpersPath -PathType Leaf)) {
    throw "Shared validator helpers not found: $helpersPath. The helpers file is part of the shared validator core (see docs/VALIDATOR_CHECKS.md in the OpenModulePlatform repository) and must sit next to this script."
}
. $helpersPath

# ---------------------------------------------------------------------------
# Repo-local helpers used only by the seed-SQL guards (Checks 16 and 17).
# Everything generic lives in the shared core dot-sourced above.
# ---------------------------------------------------------------------------

function Get-Sha256HexFromBytes {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash($Bytes)
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-NewlineOffsets {
    # Returns the sorted character offsets of every LF in $Text, computed once
    # per file so line numbers for many regex matches do not require re-scanning
    # the file prefix for each match (quadratic on large seed scripts).
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)

    $offsets = [System.Collections.Generic.List[int]]::new()
    $index = $Text.IndexOf("`n")
    while ($index -ge 0) {
        $offsets.Add($index)
        $index = $Text.IndexOf("`n", $index + 1)
    }

    # The unary comma keeps an empty array from unrolling to $null on the
    # pipeline (a single-line file has no LF at all).
    return ,$offsets.ToArray()
}

function Get-LineNumberAtIndex {
    # 1-based line number of character position $Index, given the offsets from
    # Get-NewlineOffsets. The line number is one more than the count of LFs
    # strictly before $Index; BinarySearch yields that count directly, either
    # as the found index (an LF exactly at $Index still precedes nothing on its
    # own line) or as the complement of the insertion point.
    param(
        [Parameter(Mandatory = $true)][AllowNull()][AllowEmptyCollection()][int[]]$NewlineOffsets,
        [Parameter(Mandatory = $true)][int]$Index
    )

    if ($null -eq $NewlineOffsets -or $NewlineOffsets.Length -eq 0) {
        return 1
    }

    $position = [System.Array]::BinarySearch($NewlineOffsets, $Index)
    if ($position -lt 0) {
        $position = -bnot $position
    }

    return $position + 1
}

function Test-BytesEqual {
    param(
        [Parameter(Mandatory = $false)][AllowNull()][byte[]]$A,
        [Parameter(Mandatory = $false)][AllowNull()][byte[]]$B
    )

    if ($null -eq $A -or $null -eq $B) {
        return $false
    }

    if ($A.Length -ne $B.Length) {
        return $false
    }

    for ($i = 0; $i -lt $A.Length; $i++) {
        if ($A[$i] -ne $B[$i]) {
            return $false
        }
    }

    return $true
}

$checkMark = [char]0x2713
$warningSign = [char]0x26A0
$crossMark = [char]0x2717

if ($SelfTest) {
    # Canonical self-test for the validator family: the PowerShell 5.1 pitfalls
    # that have actually broken this gate (BOM strip, git change detection).
    Invoke-ValidatorSelfTest -CheckMark $checkMark -CrossMark $crossMark
}

$scriptDirectory = Get-ScriptDirectory
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory '..\..'))

$manifestPath = Join-Path $repositoryRoot 'omp-components.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Component manifest not found: $manifestPath"
}

$jsonDepth = 100
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$manifestText = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$manifest = ConvertFrom-JsonDocument -Json $manifestText -Depth $jsonDepth

Write-Host 'Validating component versions...'
Write-Host ''

# ---------------------------------------------------------------------------
# Check 2: Repository version presence and format.
# ---------------------------------------------------------------------------
$repositoryVersion = [string](Get-OptionalPropertyValue -Object $manifest -Name 'repositoryVersion')
if ([string]::IsNullOrWhiteSpace($repositoryVersion)) {
    Add-ValidationError -Errors $errors -Message 'repositoryVersion is missing or empty in omp-components.json.'
}
elseif (-not (Test-SemverLikeVersion -Value $repositoryVersion)) {
    Add-ValidationError -Errors $errors -Message "repositoryVersion '$repositoryVersion' does not match the expected major.minor or major.minor.patch format."
}

# ---------------------------------------------------------------------------
# Build a lookup of module definitions for mapping and version checks.
# ---------------------------------------------------------------------------
$moduleDefinitionsByKey = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
$moduleDefinitionObjectsByKey = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
$moduleDefinitionVersionSyncCount = 0

foreach ($manifestDefinition in @($manifest.moduleDefinitions)) {
    if ($null -eq $manifestDefinition) {
        continue
    }

    $moduleKey = [string](Get-OptionalPropertyValue -Object $manifestDefinition -Name 'moduleKey')
    $definitionVersion = [string](Get-OptionalPropertyValue -Object $manifestDefinition -Name 'definitionVersion')
    $relativeDefinitionPath = [string](Get-OptionalPropertyValue -Object $manifestDefinition -Name 'path')

    if (-not [string]::IsNullOrWhiteSpace($moduleKey) -and -not $moduleDefinitionsByKey.ContainsKey($moduleKey)) {
        $moduleDefinitionsByKey.Add($moduleKey, $manifestDefinition)
    }

    # -----------------------------------------------------------------------
    # Check 4: Module definition version sync.
    # -----------------------------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($relativeDefinitionPath)) {
        Add-ValidationError -Errors $errors -Message "Module definition '$moduleKey' is missing path in omp-components.json."
        continue
    }

    $definitionPath = Resolve-RepositoryPath -Path $relativeDefinitionPath -BasePath $repositoryRoot
    if (-not (Test-Path -LiteralPath $definitionPath -PathType Leaf)) {
        Add-ValidationError -Errors $errors -Message "Module definition file was not found: $relativeDefinitionPath"
        continue
    }

    $definitionText = Get-Content -LiteralPath $definitionPath -Raw -Encoding UTF8
    $definition = ConvertFrom-JsonDocument -Json $definitionText -Depth $jsonDepth

    $actualDefinitionVersion = [string](Get-OptionalPropertyValue -Object $definition -Name 'definitionVersion')
    if (-not [string]::Equals($definitionVersion, $actualDefinitionVersion, [StringComparison]::Ordinal)) {
        Add-ValidationError -Errors $errors -Message "Definition version mismatch for '$relativeDefinitionPath'. Manifest='$definitionVersion', definition='$actualDefinitionVersion'."
    }
    else {
        $moduleDefinitionVersionSyncCount++
    }

    if (-not [string]::IsNullOrWhiteSpace($moduleKey) -and -not $moduleDefinitionObjectsByKey.ContainsKey($moduleKey)) {
        $moduleDefinitionObjectsByKey.Add($moduleKey, $definition)
    }
}

# ---------------------------------------------------------------------------
# Component checks.
# ---------------------------------------------------------------------------
$projectPathCount = 0
$componentVersionCount = 0
$moduleMappingCount = 0
$minModuleVersionErrorCount = 0
$cascadeCheckCount = 0
$cascadeErrorCount = 0

foreach ($component in @(Get-OptionalPropertyValue -Object $manifest -Name 'components')) {
    if ($null -eq $component) {
        continue
    }

    $componentKey = [string](Get-OptionalPropertyValue -Object $component -Name 'componentKey')
    if ([string]::IsNullOrWhiteSpace($componentKey)) {
        $componentKey = '<unknown>'
    }

    # -----------------------------------------------------------------------
    # Check 1: Component projectPath existence.
    # -----------------------------------------------------------------------
    $projectPath = [string](Get-OptionalPropertyValue -Object $component -Name 'projectPath')
    if ([string]::IsNullOrWhiteSpace($projectPath)) {
        Add-ValidationError -Errors $errors -Message "Component '$componentKey' is missing projectPath."
    }
    else {
        $fullProjectPath = Resolve-RepositoryPath -Path $projectPath -BasePath $repositoryRoot
        $packageType = [string](Get-OptionalPropertyValue -Object $component -Name 'packageType')
        $foundProject = $false

        if ($projectPath -like '*.csproj') {
            $foundProject = Test-Path -LiteralPath $fullProjectPath -PathType Leaf
        }
        elseif (Test-Path -LiteralPath $fullProjectPath -PathType Container) {
            $csprojFiles = @(Get-ChildItem -LiteralPath $fullProjectPath -Filter '*.csproj' -File -ErrorAction SilentlyContinue)
            if ($csprojFiles.Count -gt 0) {
                $foundProject = $true
            }
            elseif ([string]::Equals($packageType, 'web-app', [StringComparison]::OrdinalIgnoreCase)) {
                $packageJsonFiles = @(Get-ChildItem -LiteralPath $fullProjectPath -Filter 'package.json' -File -ErrorAction SilentlyContinue)
                $foundProject = $packageJsonFiles.Count -gt 0
            }
        }

        if (-not $foundProject) {
            Add-ValidationError -Errors $errors -Message "Component '$componentKey' projectPath does not resolve to a .csproj or web-app package.json file: $projectPath"
        }
        else {
            $projectPathCount++
        }
    }

    # -----------------------------------------------------------------------
    # Check 3: Component version presence and format.
    # -----------------------------------------------------------------------
    $componentVersion = [string](Get-OptionalPropertyValue -Object $component -Name 'version')
    if ([string]::IsNullOrWhiteSpace($componentVersion)) {
        Add-ValidationError -Errors $errors -Message "Component '$componentKey' is missing version."
    }
    elseif (-not (Test-SemverLikeVersion -Value $componentVersion)) {
        Add-ValidationError -Errors $errors -Message "Component '$componentKey' version '$componentVersion' does not match the expected major.minor or major.minor.patch format."
    }
    else {
        $componentVersionCount++
    }

    # -----------------------------------------------------------------------
    # Check 5: Component-to-module mapping integrity.
    # -----------------------------------------------------------------------
    $moduleKey = [string](Get-OptionalPropertyValue -Object $component -Name 'moduleKey')
    if (-not [string]::IsNullOrWhiteSpace($moduleKey)) {
        if (-not $moduleDefinitionsByKey.ContainsKey($moduleKey)) {
            Add-ValidationError -Errors $errors -Message "Component '$componentKey' references moduleKey '$moduleKey' which is not declared in moduleDefinitions."
        }
        else {
            $moduleMappingCount++

            # -------------------------------------------------------------------
            # Check 6: minModuleDefinitionVersion sanity - HARD ERROR.
            # A component requiring a definition version higher than what the
            # module declares produces an internally inconsistent manifest. Any
            # package built from this state would carry a minVersion requirement
            # that no existing module definition can satisfy, so import would
            # always fail at runtime.
            # -------------------------------------------------------------------
            $minModuleDefinitionVersion = [string](Get-OptionalPropertyValue -Object $component -Name 'minModuleDefinitionVersion')
            if (-not [string]::IsNullOrWhiteSpace($minModuleDefinitionVersion)) {
                $actualVersion = [string](Get-OptionalPropertyValue -Object $moduleDefinitionsByKey[$moduleKey] -Name 'definitionVersion')
                $minVersionObj = ConvertTo-VersionOrNull -Value $minModuleDefinitionVersion
                $actualVersionObj = ConvertTo-VersionOrNull -Value $actualVersion

                if ($null -ne $minVersionObj -and $null -ne $actualVersionObj -and $minVersionObj -gt $actualVersionObj) {
                    Add-ValidationError -Errors $errors -Message "Component '$componentKey' requires minModuleDefinitionVersion '$minModuleDefinitionVersion' which is greater than the declared module definition version '$actualVersion' for moduleKey '$moduleKey'."
                    $minModuleVersionErrorCount++
                }
            }

            # -------------------------------------------------------------------
            # Check 10: compatibleArtifacts range sanity - HARD ERROR.
            # A component's version must fall within the minVersion/maxVersion
            # range declared in its module's compatibleArtifacts entry for the
            # same appKey, otherwise the produced artifact cannot be imported.
            # -------------------------------------------------------------------
            $componentAppKey = [string](Get-OptionalPropertyValue -Object $component -Name 'appKey')
            if (-not [string]::IsNullOrWhiteSpace($componentAppKey) -and $moduleDefinitionObjectsByKey.ContainsKey($moduleKey)) {
                $definitionObject = $moduleDefinitionObjectsByKey[$moduleKey]
                $compatibleArtifacts = Get-OptionalPropertyValue -Object $definitionObject -Name 'compatibleArtifacts'
                if ($null -ne $compatibleArtifacts) {
                    $matchingArtifact = $null
                    foreach ($artifact in @($compatibleArtifacts)) {
                        if ($null -eq $artifact) {
                            continue
                        }

                        $artifactAppKey = [string](Get-OptionalPropertyValue -Object $artifact -Name 'appKey')
                        if ([string]::Equals($artifactAppKey, $componentAppKey, [StringComparison]::Ordinal)) {
                            $matchingArtifact = $artifact
                            break
                        }
                    }

                    if ($null -ne $matchingArtifact) {
                        $componentVersionObj = ConvertTo-VersionOrNull -Value $componentVersion
                        $maxArtifactVersion = [string](Get-OptionalPropertyValue -Object $matchingArtifact -Name 'maxVersion')
                        $minArtifactVersion = [string](Get-OptionalPropertyValue -Object $matchingArtifact -Name 'minVersion')

                        if (-not [string]::IsNullOrWhiteSpace($maxArtifactVersion)) {
                            $maxVersionObj = ConvertTo-VersionOrNull -Value $maxArtifactVersion
                            if ($null -ne $componentVersionObj -and $null -ne $maxVersionObj -and $componentVersionObj -gt $maxVersionObj) {
                                Add-ValidationError -Errors $errors -Message "Component '$componentKey' version '$componentVersion' exceeds compatibleArtifacts maxVersion '$maxArtifactVersion' for appKey '$componentAppKey'. Bump maxVersion to at least '$componentVersion'."
                            }
                        }

                        if (-not [string]::IsNullOrWhiteSpace($minArtifactVersion)) {
                            $minVersionObj = ConvertTo-VersionOrNull -Value $minArtifactVersion
                            if ($null -ne $componentVersionObj -and $null -ne $minVersionObj -and $componentVersionObj -lt $minVersionObj) {
                                Add-ValidationError -Errors $errors -Message "Component '$componentKey' version '$componentVersion' is below compatibleArtifacts minVersion '$minArtifactVersion' for appKey '$componentAppKey'. Bump minVersion to at most '$componentVersion'."
                            }
                        }
                    }
                }
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Resolve base ref for diff-based checks (Checks 7, 8, 9, 12 and 13).
# Exemption: Behavior-neutral refactors (identical emitted strings/IL) do not require
# a cascade consumer bump. Only binary-affecting changes (new/removed APIs, changed
# default values, changed serialization format, etc.) require all consumers to be bumped.
# When running multi-phase campaigns, pass -BaseCommit to pin the diff baseline.
# ---------------------------------------------------------------------------
$baseRef = 'origin/main'
$baseRefAvailable = $false

if (-not [string]::IsNullOrWhiteSpace($BaseCommit)) {
    if (Test-GitRefAvailable -RepositoryRoot $repositoryRoot -Ref $BaseCommit) {
        $baseRef = $BaseCommit
        $baseRefAvailable = $true
    }
    else {
        Add-ValidationError -Errors $errors -Message "The specified -BaseCommit '$BaseCommit' could not be resolved. Verify the commit SHA exists in this repository."
    }
}
else {
    Add-ValidationWarning -Warnings $warnings -Message 'No -BaseCommit specified; cascade diff uses origin/main. Binary-affecting shared changes committed in earlier campaign phases may not trigger cascade bumps. Pass -BaseCommit <sha> to diff against a fixed baseline.'

    $baseRefAvailable = Test-GitRefAvailable -RepositoryRoot $repositoryRoot -Ref 'origin/main'
    if (-not $baseRefAvailable) {
        Add-ValidationWarning -Warnings $warnings -Message 'origin/main could not be resolved; skipping shared-project cascade validation.'
    }
}

$baseManifest = $null
# Always a dictionary: with no manifest at the base ref it is simply empty, so the
# ContainsKey lookups below never dereference $null.
$baseComponentsByKey = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
if ($baseRefAvailable) {
    $baseManifestText = Get-GitFileTextAtRef -RepositoryRoot $repositoryRoot -BaseRef $baseRef -Path 'omp-components.json' -Errors $errors -CheckDescription 'The baseline manifest read'
    if (-not [string]::IsNullOrWhiteSpace($baseManifestText)) {
        $baseManifest = ConvertFrom-JsonDocument -Json $baseManifestText -Depth $jsonDepth
    }

    if ($null -ne $baseManifest) {
        foreach ($baseComponent in @($baseManifest.components)) {
            if ($null -eq $baseComponent) {
                continue
            }

            $key = [string](Get-OptionalPropertyValue -Object $baseComponent -Name 'componentKey')
            if (-not [string]::IsNullOrWhiteSpace($key) -and -not $baseComponentsByKey.ContainsKey($key)) {
                $baseComponentsByKey.Add($key, $baseComponent)
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Check 7: Shared project cascade version bumps.
# Present but vacuous in this repository: omp-components.json declares no
# sharedProjects (they are owned by the OpenModulePlatform repository).
# ---------------------------------------------------------------------------
$sharedProjects = Get-OptionalPropertyValue -Object $manifest -Name 'sharedProjects'
if ($null -ne $sharedProjects -and $baseRefAvailable) {
    foreach ($sharedProject in @($sharedProjects)) {
        if ($null -eq $sharedProject) {
            continue
        }

        $projectPath = [string](Get-OptionalPropertyValue -Object $sharedProject -Name 'projectPath')
        if ([string]::IsNullOrWhiteSpace($projectPath)) {
            continue
        }

        $diffPath = $projectPath
        if ($projectPath -like '*.csproj') {
            $diffPath = Split-Path -Parent $projectPath
        }

        $changedFiles = Get-GitChangedFiles -RepositoryRoot $repositoryRoot -BaseRef $baseRef -Path $diffPath -Errors $errors -CheckDescription "The shared project cascade check (Check 7) for '$projectPath'"
        if ($null -eq $changedFiles) {
            continue
        }
        if ([string]::IsNullOrWhiteSpace($changedFiles)) {
            continue
        }

        $consumers = @(Get-OptionalPropertyValue -Object $sharedProject -Name 'consumers')
        if ($consumers.Count -eq 0) {
            continue
        }

        $unbumpedConsumers = [System.Collections.Generic.List[string]]::new()
        foreach ($consumerKey in $consumers) {
            $currentComponent = $null
            foreach ($component in @(Get-OptionalPropertyValue -Object $manifest -Name 'components')) {
                if (([string](Get-OptionalPropertyValue -Object $component -Name 'componentKey')) -eq $consumerKey) {
                    $currentComponent = $component
                    break
                }
            }

            if ($null -eq $currentComponent) {
                Add-ValidationWarning -Warnings $warnings -Message "Shared project '$projectPath' lists consumer '$consumerKey' which is not declared in components."
                continue
            }

            $baseVersion = $null
            if ($baseComponentsByKey.ContainsKey($consumerKey)) {
                $baseVersion = [string](Get-OptionalPropertyValue -Object $baseComponentsByKey[$consumerKey] -Name 'version')
            }

            $currentVersion = [string](Get-OptionalPropertyValue -Object $currentComponent -Name 'version')

            if (-not [string]::IsNullOrWhiteSpace($baseVersion) -and $baseVersion -eq $currentVersion) {
                $unbumpedConsumers.Add($consumerKey)
            }
        }

        if ($unbumpedConsumers.Count -gt 0) {
            $consumerList = ($unbumpedConsumers | Sort-Object) -join ', '
            Add-ValidationError -Errors $errors -Message "Shared project '$projectPath' changed but the following consumers were not bumped: $consumerList. Bump the listed components manually or via the repository's bump-version helper."
            $cascadeErrorCount++
        }
        else {
            $cascadeCheckCount++
        }
    }
}

# ---------------------------------------------------------------------------
# Check 8: Module-definition SQL diff enforcement.
# If an owned SQL script referenced by a production module definition changes
# in a material way (not just comments or whitespace), the module's
# definitionVersion must be bumped in both omp-components.json and the
# .module-definition.json file.
# ---------------------------------------------------------------------------
$sqlFilesChecked = 0
$sqlFilesPassed = 0
$sqlFilesChanged = 0

if (-not $baseRefAvailable) {
    Add-ValidationWarning -Warnings $warnings -Message 'No valid base ref available; skipping module-definition SQL diff enforcement (Check 8). Pass -BaseCommit to enable it.'
}
else {
    $baseModuleDefinitionsByKey = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    if ($null -ne $baseManifest) {
        foreach ($baseDefinition in @($baseManifest.moduleDefinitions)) {
            if ($null -eq $baseDefinition) {
                continue
            }

            $key = [string](Get-OptionalPropertyValue -Object $baseDefinition -Name 'moduleKey')
            if (-not [string]::IsNullOrWhiteSpace($key) -and -not $baseModuleDefinitionsByKey.ContainsKey($key)) {
                $baseModuleDefinitionsByKey.Add($key, $baseDefinition)
            }
        }
    }

    $ownedSqlFiles = [System.Collections.Generic.List[System.Collections.Hashtable]]::new()
    foreach ($manifestDefinition in @($manifest.moduleDefinitions)) {
        if ($null -eq $manifestDefinition) {
            continue
        }

        $moduleKey = [string](Get-OptionalPropertyValue -Object $manifestDefinition -Name 'moduleKey')
        $relativeDefinitionPath = [string](Get-OptionalPropertyValue -Object $manifestDefinition -Name 'path')

        if ([string]::IsNullOrWhiteSpace($moduleKey) -or [string]::IsNullOrWhiteSpace($relativeDefinitionPath)) {
            continue
        }

        $definitionPath = Resolve-RepositoryPath -Path $relativeDefinitionPath -BasePath $repositoryRoot
        if (-not (Test-Path -LiteralPath $definitionPath -PathType Leaf)) {
            continue
        }

        $definitionText = Get-Content -LiteralPath $definitionPath -Raw -Encoding UTF8
        $definition = ConvertFrom-JsonDocument -Json $definitionText -Depth $jsonDepth

        foreach ($sqlScript in @($definition.sqlScripts)) {
            if ($null -eq $sqlScript) {
                continue
            }

            $sqlPath = [string](Get-OptionalPropertyValue -Object $sqlScript -Name 'path')
            if ([string]::IsNullOrWhiteSpace($sqlPath)) {
                continue
            }

            $alreadyOwned = $false
            foreach ($ownedSqlFile in $ownedSqlFiles) {
                if ([string]::Equals($ownedSqlFile.sqlPath, $sqlPath, [StringComparison]::OrdinalIgnoreCase)) {
                    $alreadyOwned = $true
                    break
                }
            }

            if (-not $alreadyOwned) {
                $ownedSqlFiles.Add(@{
                    moduleKey = $moduleKey
                    relativeDefinitionPath = $relativeDefinitionPath
                    sqlPath = $sqlPath
                })
            }
        }
    }

    foreach ($ownedSqlFile in $ownedSqlFiles) {
        $moduleKey = $ownedSqlFile.moduleKey
        $relativeDefinitionPath = $ownedSqlFile.relativeDefinitionPath
        $sqlPath = $ownedSqlFile.sqlPath
        $fullSqlPath = Resolve-RepositoryPath -Path $sqlPath -BasePath $repositoryRoot

        $sqlFilesChecked++

        if (-not (Test-Path -LiteralPath $fullSqlPath -PathType Leaf)) {
            Add-ValidationError -Errors $errors -Message "SQL script referenced by module '$moduleKey' was not found: $sqlPath"
            continue
        }

        $changedFiles = Get-GitChangedFiles -RepositoryRoot $repositoryRoot -BaseRef $baseRef -Path $sqlPath -Errors $errors -CheckDescription "The SQL diff check (Check 8) for '$sqlPath'"
        if ($null -eq $changedFiles) {
            continue
        }
        if ([string]::IsNullOrWhiteSpace($changedFiles)) {
            $sqlFilesPassed++
            continue
        }

        $headText = Get-Content -LiteralPath $fullSqlPath -Raw -Encoding UTF8

        $baseText = Get-GitFileTextAtRef -RepositoryRoot $repositoryRoot -BaseRef $baseRef -Path $sqlPath -Errors $errors -CheckDescription "The SQL diff check (Check 8) for '$sqlPath'"
        if ($null -eq $baseText) {
            continue
        }
        $isNewFile = [string]::IsNullOrWhiteSpace($baseText)

        $headNormalized = ConvertTo-NormalizedSql -SqlText $headText
        $baseNormalized = ConvertTo-NormalizedSql -SqlText $baseText

        $headHash = Get-Sha256Hex -Text $headNormalized
        $baseHash = Get-Sha256Hex -Text $baseNormalized

        if (-not $isNewFile -and $headHash -eq $baseHash) {
            $sqlFilesPassed++
            continue
        }

        $sqlFilesChanged++

        if (-not $moduleDefinitionsByKey.ContainsKey($moduleKey)) {
            Add-ValidationError -Errors $errors -Message "Module '$moduleKey' owns '$sqlPath' but is no longer declared in omp-components.json; declare it or remove the SQL ownership."
            continue
        }
        $headManifestDefinitionVersion = [string](Get-OptionalPropertyValue -Object $moduleDefinitionsByKey[$moduleKey] -Name 'definitionVersion')
        $baseManifestDefinitionVersion = $null
        if ($baseModuleDefinitionsByKey.ContainsKey($moduleKey)) {
            $baseManifestDefinitionVersion = [string](Get-OptionalPropertyValue -Object $baseModuleDefinitionsByKey[$moduleKey] -Name 'definitionVersion')
        }

        $manifestBumpPresent = $false
        if ([string]::IsNullOrWhiteSpace($baseManifestDefinitionVersion)) {
            $manifestBumpPresent = -not [string]::IsNullOrWhiteSpace($headManifestDefinitionVersion)
        }
        else {
            $manifestBumpPresent = -not [string]::Equals($baseManifestDefinitionVersion, $headManifestDefinitionVersion, [StringComparison]::Ordinal)
        }

        $headDefinitionText = Get-Content -LiteralPath (Resolve-RepositoryPath -Path $relativeDefinitionPath -BasePath $repositoryRoot) -Raw -Encoding UTF8
        $headDefinition = ConvertFrom-JsonDocument -Json $headDefinitionText -Depth $jsonDepth
        $headDefinitionVersion = [string](Get-OptionalPropertyValue -Object $headDefinition -Name 'definitionVersion')

        $baseDefinitionText = Get-GitFileTextAtRef -RepositoryRoot $repositoryRoot -BaseRef $baseRef -Path $relativeDefinitionPath -Errors $errors -CheckDescription "The SQL diff check (Check 8) for module '$moduleKey'"
        if ($null -eq $baseDefinitionText) {
            continue
        }
        $baseDefinitionVersion = $null
        if (-not [string]::IsNullOrWhiteSpace($baseDefinitionText)) {
            $baseDefinition = ConvertFrom-JsonDocument -Json $baseDefinitionText -Depth $jsonDepth
            $baseDefinitionVersion = [string](Get-OptionalPropertyValue -Object $baseDefinition -Name 'definitionVersion')
        }

        $definitionBumpPresent = $false
        if ([string]::IsNullOrWhiteSpace($baseDefinitionVersion)) {
            $definitionBumpPresent = -not [string]::IsNullOrWhiteSpace($headDefinitionVersion)
        }
        else {
            $definitionBumpPresent = -not [string]::Equals($baseDefinitionVersion, $headDefinitionVersion, [StringComparison]::Ordinal)
        }

        if (-not $manifestBumpPresent -or -not $definitionBumpPresent) {
            Add-ValidationError -Errors $errors -Message "SQL '$sqlPath' changed (module '$moduleKey') but definitionVersion was not bumped in omp-components.json and/or the module-definition JSON. Bump definitionVersion and update relevant minModuleDefinitionVersion values."
        }
        else {
            $newDefinitionVersion = $headManifestDefinitionVersion
            $newDefinitionVersionObj = ConvertTo-VersionOrNull -Value $newDefinitionVersion

            foreach ($component in @(Get-OptionalPropertyValue -Object $manifest -Name 'components')) {
                if ($null -eq $component) {
                    continue
                }

                $componentModuleKey = [string](Get-OptionalPropertyValue -Object $component -Name 'moduleKey')
                if (-not [string]::Equals($componentModuleKey, $moduleKey, [StringComparison]::Ordinal)) {
                    continue
                }

                $minModuleDefinitionVersion = [string](Get-OptionalPropertyValue -Object $component -Name 'minModuleDefinitionVersion')
                if ([string]::IsNullOrWhiteSpace($minModuleDefinitionVersion)) {
                    continue
                }

                $minVersionObj = ConvertTo-VersionOrNull -Value $minModuleDefinitionVersion
                if ($null -ne $minVersionObj -and $null -ne $newDefinitionVersionObj -and $minVersionObj -ne $newDefinitionVersionObj) {
                    $componentKey = [string](Get-OptionalPropertyValue -Object $component -Name 'componentKey')
                    if ([string]::IsNullOrWhiteSpace($componentKey)) {
                        $componentKey = '<unknown>'
                    }

                    # Check 8b: minModuleDefinitionVersion must EQUAL a bumped definitionVersion - HARD ERROR.
                    # Check 6 rejects a minimum above the module's version; this rejects one below it
                    # (or otherwise different), so the two checks together pin min == definitionVersion.
                    # The module's SQL contract changed and the definitionVersion was raised. Any
                    # component that exposes a minModuleDefinitionVersion for the same module must
                    # be updated to at least the new version, otherwise packages can be imported
                    # into environments with an older definition and fail at runtime due to missing
                    # schema/metadata.
                    Add-ValidationError -Errors $errors -Message "Component '$componentKey' has minModuleDefinitionVersion '$minModuleDefinitionVersion' which must equal the new definitionVersion '$newDefinitionVersion'"
                }
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Check 12: Module-definition content diff enforcement.
# HostAgent rejects re-importing a module definition whose version already
# exists in the database with different JSON, and that rejection silently
# skips every artifact item bundled in the same universal package (the import
# summary only shows "Skipped"). Any content change to a .module-definition.json
# therefore requires a definitionVersion bump - not only SQL-affecting changes,
# which Check 8 already covers.
# ---------------------------------------------------------------------------
$definitionDiffChecked = 0
$definitionDiffChanged = 0

if (-not $baseRefAvailable) {
    Add-ValidationWarning -Warnings $warnings -Message 'No valid base ref available; skipping module-definition content diff enforcement (Check 12). Pass -BaseCommit to enable it.'
}
else {
    foreach ($manifestDefinition in @($manifest.moduleDefinitions)) {
        if ($null -eq $manifestDefinition) {
            continue
        }

        $moduleKey = [string](Get-OptionalPropertyValue -Object $manifestDefinition -Name 'moduleKey')
        $relativeDefinitionPath = [string](Get-OptionalPropertyValue -Object $manifestDefinition -Name 'path')
        if ([string]::IsNullOrWhiteSpace($moduleKey) -or [string]::IsNullOrWhiteSpace($relativeDefinitionPath)) {
            continue
        }

        $definitionPath = Resolve-RepositoryPath -Path $relativeDefinitionPath -BasePath $repositoryRoot
        if (-not (Test-Path -LiteralPath $definitionPath -PathType Leaf)) {
            continue # missing file is already an error in Check 4
        }

        $definitionDiffChecked++

        $changedFiles = Get-GitChangedFiles -RepositoryRoot $repositoryRoot -BaseRef $baseRef -Path $relativeDefinitionPath -Errors $errors -CheckDescription "The module-definition content diff check (Check 12) for '$relativeDefinitionPath'"
        if ($null -eq $changedFiles) {
            continue
        }
        if ([string]::IsNullOrWhiteSpace($changedFiles)) {
            continue
        }

        $baseDefinitionText = Get-GitFileTextAtRef -RepositoryRoot $repositoryRoot -BaseRef $baseRef -Path $relativeDefinitionPath -Errors $errors -CheckDescription "The module-definition content diff check (Check 12) for '$relativeDefinitionPath'"
        if ($null -eq $baseDefinitionText) {
            continue
        }
        if ([string]::IsNullOrWhiteSpace($baseDefinitionText)) {
            continue # new definition file; nothing to bump against
        }

        $headDefinitionText = Get-Content -LiteralPath $definitionPath -Raw -Encoding UTF8
        $headNormalized = (Remove-Utf8Bom -Text $headDefinitionText).Replace("`r`n", "`n").TrimEnd("`n")
        $baseNormalized = $baseDefinitionText.Replace("`r`n", "`n").TrimEnd("`n")
        if ([string]::Equals($headNormalized, $baseNormalized, [StringComparison]::Ordinal)) {
            continue
        }

        $definitionDiffChanged++

        $headDefinition = ConvertFrom-JsonDocument -Json $headDefinitionText -Depth $jsonDepth
        $headDefinitionVersion = [string](Get-OptionalPropertyValue -Object $headDefinition -Name 'definitionVersion')
        $baseDefinition = ConvertFrom-JsonDocument -Json $baseDefinitionText -Depth $jsonDepth
        $baseDefinitionVersion = [string](Get-OptionalPropertyValue -Object $baseDefinition -Name 'definitionVersion')

        if (-not [string]::IsNullOrWhiteSpace($baseDefinitionVersion) -and [string]::Equals($baseDefinitionVersion, $headDefinitionVersion, [StringComparison]::Ordinal)) {
            Add-ValidationError -Errors $errors -Message "Module definition '$relativeDefinitionPath' (module '$moduleKey') changed but definitionVersion is still '$headDefinitionVersion'. HostAgent rejects a re-imported definition version with different JSON and silently skips artifacts packaged with it. Bump definitionVersion in both the definition file and omp-components.json."
        }
    }
}

# ---------------------------------------------------------------------------
# Check 9: Transitive ProjectReference lockstep bumps.
# If a component's own project or any project it references (directly or
# through one level of ProjectReference transitivity) changed since the base,
# the component's version must be bumped. References already covered by
# Check 7's sharedProjects cascade are excluded to avoid double-counting.
# Present but vacuous in this repository: the only component is a web-app with
# no .csproj and no ProjectReferences.
# ---------------------------------------------------------------------------
$transitiveCheckCount = 0
$transitiveErrorCount = 0

if (-not $baseRefAvailable) {
    Add-ValidationWarning -Warnings $warnings -Message 'No valid base ref available; skipping transitive ProjectReference lockstep validation (Check 9). Pass -BaseCommit to enable it.'
}
else {
    $sharedProjectDirs = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($sharedProject in @($sharedProjects)) {
        if ($null -eq $sharedProject) {
            continue
        }

        $sharedProjectPath = [string](Get-OptionalPropertyValue -Object $sharedProject -Name 'projectPath')
        if ([string]::IsNullOrWhiteSpace($sharedProjectPath)) {
            continue
        }

        $fullSharedProjectPath = Resolve-RepositoryPath -Path $sharedProjectPath -BasePath $repositoryRoot
        $sharedProjectDir = $fullSharedProjectPath
        if ($fullSharedProjectPath -like '*.csproj') {
            $sharedProjectDir = Split-Path -Parent $fullSharedProjectPath
        }

        if (Test-Path -LiteralPath $sharedProjectDir -PathType Container) {
            [void]$sharedProjectDirs.Add([System.IO.Path]::GetFullPath($sharedProjectDir))
        }
    }

    foreach ($component in @(Get-OptionalPropertyValue -Object $manifest -Name 'components')) {
        if ($null -eq $component) {
            continue
        }

        $componentKey = [string](Get-OptionalPropertyValue -Object $component -Name 'componentKey')
        if ([string]::IsNullOrWhiteSpace($componentKey)) {
            $componentKey = '<unknown>'
        }

        $projectPath = [string](Get-OptionalPropertyValue -Object $component -Name 'projectPath')
        if ([string]::IsNullOrWhiteSpace($projectPath)) {
            continue
        }

        $fullProjectPath = Resolve-RepositoryPath -Path $projectPath -BasePath $repositoryRoot
        $csprojPath = $fullProjectPath
        if (Test-Path -LiteralPath $fullProjectPath -PathType Container) {
            $csprojFiles = @(Get-ChildItem -LiteralPath $fullProjectPath -Filter '*.csproj' -File -ErrorAction SilentlyContinue)
            if ($csprojFiles.Count -eq 0) {
                continue
            }
            $csprojPath = $csprojFiles[0].FullName
        }

        if (-not (Test-Path -LiteralPath $csprojPath -PathType Leaf)) {
            continue
        }

        $directRefDirs = @(Get-ProjectReferences -CsprojPath $csprojPath)
        $allRefDirs = [System.Collections.Generic.List[string]]::new()
        foreach ($directRefDir in $directRefDirs) {
            if (-not $allRefDirs.Contains($directRefDir)) {
                [void]$allRefDirs.Add($directRefDir)
            }

            $directRefCsprojFiles = @(Get-ChildItem -LiteralPath $directRefDir -Filter '*.csproj' -File -ErrorAction SilentlyContinue)
            if ($directRefCsprojFiles.Count -gt 0) {
                $transitiveRefDirs = @(Get-ProjectReferences -CsprojPath $directRefCsprojFiles[0].FullName)
                foreach ($transitiveRefDir in $transitiveRefDirs) {
                    if (-not $allRefDirs.Contains($transitiveRefDir)) {
                        [void]$allRefDirs.Add($transitiveRefDir)
                    }
                }
            }
        }

        $changedRefDirs = [System.Collections.Generic.List[string]]::new()
        foreach ($refDir in $allRefDirs) {
            if ($sharedProjectDirs.Contains($refDir)) {
                continue
            }

            $relRefDir = $refDir.Substring($repositoryRoot.Length).TrimStart('\', '/')
            $changedFiles = Get-GitChangedFiles -RepositoryRoot $repositoryRoot -BaseRef $baseRef -Path $relRefDir -Errors $errors -CheckDescription "The transitive ProjectReference check (Check 9) for '$componentKey'"
            if ($null -eq $changedFiles) {
                continue
            }
            if (-not [string]::IsNullOrWhiteSpace($changedFiles)) {
                [void]$changedRefDirs.Add($relRefDir)
            }
        }

        if ($changedRefDirs.Count -eq 0) {
            continue
        }

        $baseVersion = $null
        if ($baseComponentsByKey.ContainsKey($componentKey)) {
            $baseVersion = [string](Get-OptionalPropertyValue -Object $baseComponentsByKey[$componentKey] -Name 'version')
        }

        $currentVersion = [string](Get-OptionalPropertyValue -Object $component -Name 'version')

        if (-not [string]::IsNullOrWhiteSpace($baseVersion) -and [string]::Equals($baseVersion, $currentVersion, [StringComparison]::Ordinal)) {
            $changedRefList = ($changedRefDirs | Sort-Object) -join ', '
            Add-ValidationError -Errors $errors -Message "Component '$componentKey' references changed project(s) ($changedRefList) since $baseRef but its version was not bumped. Bump the component version."
            $transitiveErrorCount++
        }
        else {
            $transitiveCheckCount++
        }
    }
}

# ---------------------------------------------------------------------------
# Check 13: LOCKSTEP version bump against baseline (own project source).
# When a component's OWN project directory changed since the base ref, both
# the component version and repositoryVersion must move. Check 9 covers
# referenced projects only; this check covers the component's own tree.
# Documentation-only changes (*.md) never reach the published payload, so they
# do not force a bump.
#
# Repo-local scoping: this repository's only component is a web-app whose
# projectPath is the repository root, so "own project source" is narrowed to
# the inputs of the published artifact - the 'dist' bundle produced by
# 'npm run build' (scripts/omp/build-repository-objects.ps1). Only the vite
# entry/config files, the npm manifest and lockfile, and the src/public trees
# count. Repository tooling (scripts/, including this validator), module SQL
# (guarded by Checks 8 and 16), CI/hooks and documentation never reach the
# payload and must not force an artifact version bump.
# ---------------------------------------------------------------------------
$lockstepCheckCount = 0
$lockstepErrorCount = 0

if (-not $baseRefAvailable) {
    Add-ValidationWarning -Warnings $warnings -Message 'No valid base ref available; skipping LOCKSTEP validation (Check 13). Pass -BaseCommit to enable it.'
}
elseif ($null -eq $baseManifest -or $null -eq $baseComponentsByKey) {
    Add-ValidationWarning -Warnings $warnings -Message 'Baseline manifest unreadable; skipping LOCKSTEP validation (Check 13).'
}
else {
    $baseRepositoryVersion = [string](Get-OptionalPropertyValue -Object $baseManifest -Name 'repositoryVersion')

    foreach ($component in @(Get-OptionalPropertyValue -Object $manifest -Name 'components')) {
        if ($null -eq $component) {
            continue
        }

        $componentKey = [string](Get-OptionalPropertyValue -Object $component -Name 'componentKey')
        if ([string]::IsNullOrWhiteSpace($componentKey)) {
            continue
        }

        $projectPath = [string](Get-OptionalPropertyValue -Object $component -Name 'projectPath')
        if ([string]::IsNullOrWhiteSpace($projectPath)) {
            continue
        }

        $diffPath = $projectPath
        if ($projectPath -like '*.csproj') {
            $diffPath = Split-Path -Parent $projectPath
        }

        $changedFilesText = Get-GitChangedFiles -RepositoryRoot $repositoryRoot -BaseRef $baseRef -Path $diffPath -Errors $errors -CheckDescription "The LOCKSTEP check (Check 13) for '$componentKey'"
        if ($null -eq $changedFilesText) {
            continue
        }

        # Markdown never reaches the published payload, so a docs-only change
        # must not force a version bump.
        $changedFiles = @($changedFilesText -split "`n" | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_) -and -not $_.Trim().EndsWith('.md', [StringComparison]::OrdinalIgnoreCase)
        })

        # Web-app at the repository root: keep only the artifact build inputs
        # (see the Check 13 header comment).
        $packageType = [string](Get-OptionalPropertyValue -Object $component -Name 'packageType')
        if ([string]::Equals($packageType, 'web-app', [StringComparison]::OrdinalIgnoreCase)) {
            $payloadPrefixes = @('src/', 'public/')
            $payloadFiles = @('index.html', 'vite.config.js', 'package.json', 'package-lock.json')
            $changedFiles = @($changedFiles | Where-Object {
                $changedFile = $_.Trim().Replace('\', '/')
                $isPayloadInput = $false
                foreach ($payloadPrefix in $payloadPrefixes) {
                    if ($changedFile.StartsWith($payloadPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                        $isPayloadInput = $true
                        break
                    }
                }
                if (-not $isPayloadInput) {
                    foreach ($payloadFile in $payloadFiles) {
                        if ([string]::Equals($changedFile, $payloadFile, [StringComparison]::OrdinalIgnoreCase)) {
                            $isPayloadInput = $true
                            break
                        }
                    }
                }
                $isPayloadInput
            })
        }

        if ($changedFiles.Count -eq 0) {
            continue
        }

        $lockstepCheckCount++

        $currentVersion = [string](Get-OptionalPropertyValue -Object $component -Name 'version')
        $baseVersion = ''
        if ($baseComponentsByKey.ContainsKey($componentKey)) {
            $baseVersion = [string](Get-OptionalPropertyValue -Object $baseComponentsByKey[$componentKey] -Name 'version')
        }

        $versionBumped = $false
        if (-not [string]::IsNullOrWhiteSpace($baseVersion)) {
            $versionBumped = -not [string]::Equals($baseVersion, $currentVersion, [StringComparison]::Ordinal)
        }
        else {
            # No baseline version means this is a new component; treat as bumped if it has a valid version.
            $versionBumped = (-not [string]::IsNullOrWhiteSpace($currentVersion))
        }

        $repositoryVersionBumped = $false
        if (-not [string]::IsNullOrWhiteSpace($baseRepositoryVersion)) {
            $repositoryVersionBumped = -not [string]::Equals($baseRepositoryVersion, $repositoryVersion, [StringComparison]::Ordinal)
        }
        else {
            $repositoryVersionBumped = (-not [string]::IsNullOrWhiteSpace($repositoryVersion))
        }

        if (-not $versionBumped -or -not $repositoryVersionBumped) {
            $missing = [System.Collections.Generic.List[string]]::new()
            if (-not $versionBumped) {
                [void]$missing.Add("component version (current '$currentVersion', baseline '$baseVersion')")
            }
            if (-not $repositoryVersionBumped) {
                [void]$missing.Add("repositoryVersion (current '$repositoryVersion', baseline '$baseRepositoryVersion')")
            }

            $missingText = ($missing | Sort-Object) -join ' and '
            Add-ValidationError -Errors $errors -Message "Component '$componentKey' project files changed since '$baseRef' but $missingText were not bumped (LOCKSTEP). Bump the component version and repositoryVersion."
            $lockstepErrorCount++
        }
    }
}

# ---------------------------------------------------------------------------
# Checks 17 and 16: Owned seed-SQL guards (HARD ERROR).
# These guards run unconditionally (no git base ref needed) because they
# validate the current state of the repository, not a diff.
#
# Check 17 (repo-local to OpenDocViewer; the number is reserved for it in
# docs/VALIDATOR_CHECKS.md): Unconditional artifact-pointer overwrite guard.
# An owned seed SQL script must never assign ArtifactId/DesiredArtifactId
# directly from source in a MERGE/UPSERT update. On a re-seed, source may
# resolve to NULL or a stale artifact, silently overwriting a correct pointer
# set by package import (this caused a real ODV outage). The assignment must
# preserve an existing non-null pointer, e.g.:
#   ArtifactId = COALESCE(target.ArtifactId, source.ArtifactId)
#
# Check 16: Embedded sqlScripts freshness (stricter OpenDocViewer variant).
# Every sqlScripts[] entry with embedded content must carry a base64-utf8
# payload that decodes byte-for-byte to the referenced SQL file on disk, and
# its sha256 field must equal the SHA-256 of those decoded bytes. A drifted
# embed means the deployed script no longer matches the reviewed file. The
# byte-for-byte form is well-defined here because .gitattributes pins *.sql to
# LF on every platform.
# ---------------------------------------------------------------------------
$seedGuardFilesChecked = 0
$embedScriptsChecked = 0

# Direct unconditional assignment: "ArtifactId = source.ArtifactId" (same
# column on both sides) without any guard expression.
$seedDirectAssignPattern = '(?i)(?<![A-Za-z0-9_])(DesiredArtifactId|ArtifactId)\s*=\s*source\.(DesiredArtifactId|ArtifactId)(?![A-Za-z0-9_])'

# Reversed COALESCE: "ArtifactId = COALESCE(source.ArtifactId, ...)" prefers
# the source value and therefore does NOT preserve an existing non-null
# pointer. The existing target value must come first.
$seedReversedCoalescePattern = '(?i)(?<![A-Za-z0-9_])(DesiredArtifactId|ArtifactId)\s*=\s*COALESCE\(\s*source\.'

$ownedSeedSqlEntries = [System.Collections.Generic.List[System.Collections.Hashtable]]::new()
foreach ($manifestDefinition in @($manifest.moduleDefinitions)) {
    if ($null -eq $manifestDefinition) {
        continue
    }

    $moduleKey = [string](Get-OptionalPropertyValue -Object $manifestDefinition -Name 'moduleKey')
    $relativeDefinitionPath = [string](Get-OptionalPropertyValue -Object $manifestDefinition -Name 'path')

    if ([string]::IsNullOrWhiteSpace($moduleKey) -or [string]::IsNullOrWhiteSpace($relativeDefinitionPath)) {
        continue
    }

    $definitionPath = Resolve-RepositoryPath -Path $relativeDefinitionPath -BasePath $repositoryRoot
    if (-not (Test-Path -LiteralPath $definitionPath -PathType Leaf)) {
        continue
    }

    $definitionText = Get-Content -LiteralPath $definitionPath -Raw -Encoding UTF8
    $definition = ConvertFrom-JsonDocument -Json $definitionText -Depth $jsonDepth

    foreach ($sqlScript in @($definition.sqlScripts)) {
        if ($null -eq $sqlScript) {
            continue
        }

        $sqlPath = [string](Get-OptionalPropertyValue -Object $sqlScript -Name 'path')
        if ([string]::IsNullOrWhiteSpace($sqlPath)) {
            continue
        }

        $scriptKey = [string](Get-OptionalPropertyValue -Object $sqlScript -Name 'key')
        $content = Get-OptionalPropertyValue -Object $sqlScript -Name 'content'
        $contentEncoding = [string](Get-OptionalPropertyValue -Object $sqlScript -Name 'contentEncoding')
        $declaredSha256 = [string](Get-OptionalPropertyValue -Object $sqlScript -Name 'sha256')

        $alreadyCollected = $false
        foreach ($entry in $ownedSeedSqlEntries) {
            if ([string]::Equals($entry.sqlPath, $sqlPath, [StringComparison]::OrdinalIgnoreCase)) {
                $alreadyCollected = $true
                break
            }
        }

        if (-not $alreadyCollected) {
            $ownedSeedSqlEntries.Add(@{
                moduleKey = $moduleKey
                scriptKey = $scriptKey
                sqlPath = $sqlPath
                content = $content
                contentEncoding = $contentEncoding
                declaredSha256 = $declaredSha256
            })
        }
    }
}

foreach ($entry in $ownedSeedSqlEntries) {
    $moduleKey = $entry.moduleKey
    $scriptKey = $entry.scriptKey
    $sqlPath = $entry.sqlPath
    $fullSqlPath = Resolve-RepositoryPath -Path $sqlPath -BasePath $repositoryRoot

    if (-not (Test-Path -LiteralPath $fullSqlPath -PathType Leaf)) {
        # Missing files are already reported by Check 8; do not double-report.
        continue
    }

    $seedBytes = [System.IO.File]::ReadAllBytes($fullSqlPath)
    $seedText = Get-Content -LiteralPath $fullSqlPath -Raw -Encoding UTF8

    # -----------------------------------------------------------------------
    # Check 17: Unconditional artifact-pointer overwrite guard.
    # -----------------------------------------------------------------------
    $seedGuardFilesChecked++

    # Newline offsets are collected once per file so each match below can map
    # its index to a line number with a binary search instead of re-scanning
    # the file prefix per match.
    $seedNewlineOffsets = Get-NewlineOffsets -Text $seedText

    foreach ($match in [System.Text.RegularExpressions.Regex]::Matches($seedText, $seedDirectAssignPattern)) {
        $column = $match.Groups[1].Value
        $sourceColumn = $match.Groups[2].Value
        if (-not [string]::Equals($column, $sourceColumn, [StringComparison]::OrdinalIgnoreCase)) {
            continue
        }

        $lineNumber = Get-LineNumberAtIndex -NewlineOffsets $seedNewlineOffsets -Index $match.Index
        Add-ValidationError -Errors $errors -Message "Owned seed SQL '$sqlPath' (module '$moduleKey') assigns '$column = source.$sourceColumn' unconditionally (line $lineNumber). A re-seed can overwrite a correct non-null artifact pointer and cause a runtime outage. Preserve the existing pointer, e.g. '$column = COALESCE(target.$column, source.$sourceColumn)'."
    }

    foreach ($match in [System.Text.RegularExpressions.Regex]::Matches($seedText, $seedReversedCoalescePattern)) {
        $column = $match.Groups[1].Value
        $lineNumber = Get-LineNumberAtIndex -NewlineOffsets $seedNewlineOffsets -Index $match.Index
        Add-ValidationError -Errors $errors -Message "Owned seed SQL '$sqlPath' (module '$moduleKey') guards '$column' with COALESCE(source.$column, ...) (line $lineNumber), which prefers the source value and does not preserve an existing non-null pointer. Use '$column = COALESCE(target.$column, source.$column)'."
    }

    # -----------------------------------------------------------------------
    # Check 16: Embedded sqlScripts freshness (stricter variant).
    # -----------------------------------------------------------------------
    $content = $entry.content
    if ($null -eq $content -or [string]::IsNullOrWhiteSpace([string]$content)) {
        continue
    }

    $embedScriptsChecked++

    if (-not [string]::Equals($entry.contentEncoding, 'base64-utf8', [StringComparison]::OrdinalIgnoreCase)) {
        Add-ValidationError -Errors $errors -Message "Embedded SQL content for script '$scriptKey' ('$sqlPath', module '$moduleKey') uses unsupported contentEncoding '$($entry.contentEncoding)'. Expected 'base64-utf8'."
        continue
    }

    $embeddedBytes = $null
    try {
        $embeddedBytes = [System.Convert]::FromBase64String([string]$content)
    }
    catch {
        Add-ValidationError -Errors $errors -Message "Embedded SQL content for script '$scriptKey' ('$sqlPath', module '$moduleKey') is not valid base64. Re-embed the current file content."
        continue
    }

    $embeddedSha256 = Get-Sha256HexFromBytes -Bytes $embeddedBytes
    if (-not [string]::IsNullOrWhiteSpace($entry.declaredSha256) -and -not [string]::Equals($entry.declaredSha256, $embeddedSha256, [StringComparison]::OrdinalIgnoreCase)) {
        Add-ValidationError -Errors $errors -Message "Embedded SQL content for script '$scriptKey' ('$sqlPath', module '$moduleKey') has sha256 '$($entry.declaredSha256)' which does not match the decoded content hash '$embeddedSha256'. Re-embed the current file content and update sha256."
    }

    if (-not (Test-BytesEqual -A $embeddedBytes -B $seedBytes)) {
        $diskSha256 = Get-Sha256HexFromBytes -Bytes $seedBytes
        Add-ValidationError -Errors $errors -Message "Embedded SQL content for script '$scriptKey' ('$sqlPath', module '$moduleKey') is stale: the decoded embed does not match the file on disk byte-for-byte (embed sha256 '$embeddedSha256', disk sha256 '$diskSha256'). Re-embed the current file content and update sha256."
    }
}

# ---------------------------------------------------------------------------
# Assembly version documentation (informational only, not enforced).
# ---------------------------------------------------------------------------
Write-Host 'Assembly version note:'
Write-Host '  Directory.Build.props sets assembly version to 0.1.0 intentionally.'
Write-Host '  Assembly version is decoupled from omp-components.json component versions.'
Write-Host '  OMP artifact identity uses manifest version + SHA-256, not assembly version.'
Write-Host '  This script validates the manifest, not the assembly versions.'
Write-Host ''

# ---------------------------------------------------------------------------
# Summaries.
# ---------------------------------------------------------------------------
$componentCount = 0
if ($null -ne (Get-OptionalPropertyValue -Object $manifest -Name 'components')) {
    $componentCount = @(Get-OptionalPropertyValue -Object $manifest -Name 'components').Count
}

$moduleDefinitionCount = 0
if ($null -ne $manifest.moduleDefinitions) {
    $moduleDefinitionCount = @($manifest.moduleDefinitions).Count
}

$sharedProjectCount = 0
if ($null -ne $sharedProjects) {
    $sharedProjectCount = @($sharedProjects).Count
}

$repositoryVersionStatus = if ([string]::IsNullOrWhiteSpace($repositoryVersion)) { 'missing' } else { 'validated' }
Write-Host "$checkMark $projectPathCount of $componentCount component project paths validated"
Write-Host "$checkMark Repository version $repositoryVersionStatus"
Write-Host "$checkMark $componentVersionCount of $componentCount component versions validated"
Write-Host "$checkMark $moduleDefinitionVersionSyncCount of $moduleDefinitionCount module definition versions synced"
Write-Host "$checkMark $moduleMappingCount component-to-module mappings validated"

if ($sharedProjectCount -gt 0 -and ($cascadeCheckCount -gt 0 -or $cascadeErrorCount -gt 0)) {
    Write-Host "$checkMark $cascadeCheckCount of $sharedProjectCount changed shared project(s) passed cascade bump validation ($cascadeErrorCount error(s))"
}

if ($sqlFilesChecked -gt 0) {
    Write-Host "$checkMark $sqlFilesPassed of $sqlFilesChecked owned SQL file(s) passed diff validation ($sqlFilesChanged changed)"
}

if ($definitionDiffChecked -gt 0) {
    Write-Host "$checkMark $definitionDiffChecked module definition(s) passed content diff validation ($definitionDiffChanged changed)"
}

if ($transitiveCheckCount -gt 0 -or $transitiveErrorCount -gt 0) {
    Write-Host "$checkMark $transitiveCheckCount component(s) passed transitive ProjectReference lockstep validation ($transitiveErrorCount error(s))"
}

if ($lockstepCheckCount -gt 0 -or $lockstepErrorCount -gt 0) {
    $lockstepPassed = $lockstepCheckCount - $lockstepErrorCount
    Write-Host "$checkMark $lockstepPassed of $lockstepCheckCount changed component(s) passed LOCKSTEP bump validation ($lockstepErrorCount error(s))"
}

if ($seedGuardFilesChecked -gt 0) {
    Write-Host "$checkMark $seedGuardFilesChecked owned seed SQL file(s) scanned for unconditional artifact-pointer writes"
}

if ($embedScriptsChecked -gt 0) {
    Write-Host "$checkMark $embedScriptsChecked embedded SQL script(s) verified byte-for-byte against disk (content + sha256)"
}

# Check 15: the shared omp scripts must be byte-identical to the canonical copies
# in OpenModulePlatform. Keeping them identical was a manual act twice, and
# nothing held them that way: a stale copy looks green locally and only surfaces
# when a bump behaves differently here than in a neighbouring repository -
# typically mid-incident. Same neighbour resolution and Strict semantics as
# Check 14; the guard is CALLED from the platform repository rather than copied
# here, because a copied guard would be subject to the drift it detects.
#
# Numbering note: this validator intentionally has no Check 14. Check 14 (the
# cross-repository shared project cascade) runs in consumer repositories that
# declare sharedDependencies; OpenDocViewer references no OpenModulePlatform
# shared projects, so it is absent by design (see docs/VALIDATOR_CHECKS.md in
# the OpenModulePlatform repository). The numbers are a shared contract: a
# given "Check N" means the same thing in every OMP-compatible validator's
# output.
$check15OmpRoot = $env:OpenModulePlatformRoot
if ([string]::IsNullOrWhiteSpace($check15OmpRoot)) {
    # Built from separate segments (nested Join-Path, because Windows
    # PowerShell 5.1 has no multi-segment Join-Path) so the fallback resolves
    # under PowerShell Core on Linux/macOS as well as on Windows.
    $check15OmpRoot = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $repositoryRoot '..') 'OpenModulePlatform'))
}
# Strictness comes from this script's own -Strict switch (declared in the
# param block), never from an ambient variable in the caller's scope.
$check15Strict = [bool]$Strict
$check15Script = Join-Path $check15OmpRoot (Join-Path 'scripts' (Join-Path 'omp' 'validate-shared-scripts.ps1'))
if (Test-Path -LiteralPath $check15Script -PathType Leaf) {
    # validate-shared-scripts.ps1 ends every path with an explicit exit code,
    # but $LASTEXITCODE is process-wide and the git calls above already wrote
    # to it. Reset it before the call so a stale value can never pass for the
    # guard's verdict, and also honour $? so a guard that terminated without
    # reaching its exit statement counts as a failure rather than a pass.
    $global:LASTEXITCODE = 0
    & $check15Script -ConsumerRepositoryRoot $repositoryRoot -PlatformRepositoryRoot $check15OmpRoot -Strict:$check15Strict
    $check15Completed = $?
    if (-not $check15Completed -or $LASTEXITCODE -ne 0) {
        Add-ValidationError -Errors $errors -Message 'Check 15 (shared script drift) failed; see the Check 15 lines above.'
    }
}
elseif ($check15Strict) {
    Add-ValidationError -Errors $errors -Message "Check 15: canonical script not found at '$check15Script'; shared script drift could not be checked. Strict mode treats a guard that could not run as an error."
}
else {
    Write-Warning "Check 15: NOT VERIFIED - canonical script not found at '$check15Script'."
}

if ($warnings.Count -gt 0) {
    Write-Host "$warningSign $($warnings.Count) warning(s):"
    foreach ($warningMessage in $warnings) {
        Write-Host "   $warningMessage"
    }
}

Write-Host ''

if ($errors.Count -gt 0) {
    Write-Host "$crossMark $($errors.Count) error(s), $($warnings.Count) warning(s) found"
    foreach ($errorMessage in $errors) {
        Write-Host " - $errorMessage"
    }

    exit 1
}

Write-Host "$checkMark Component version validation passed"
exit 0
