<#
.SYNOPSIS
Validates component version metadata in omp-components.json for the OpenDocViewer repository.

.DESCRIPTION
Checks that every component listed in omp-components.json has a valid version,
points to an existing .csproj project, references a declared module definition,
and that module definition versions stay in sync with the manifest.

This script validates the manifest only. Assembly versions in
Directory.Build.props are intentionally decoupled from omp-components.json
component versions: they are statically set to 0.1.0 for all C# projects.
OMP artifact identity is determined by the component manifest version plus
SHA-256 content hash, not by assembly version.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$BaseCommit = ''
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

function ConvertFrom-JsonDocument {
    param(
        [Parameter(Mandatory = $true)][string]$Json,
        [Parameter(Mandatory = $true)][int]$Depth
    )

    $command = Get-Command ConvertFrom-Json
    if ($command.Parameters.ContainsKey('Depth')) {
        return $Json | ConvertFrom-Json -Depth $Depth
    }

    return $Json | ConvertFrom-Json
}

function Get-OptionalPropertyValue {
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

function Resolve-RepositoryPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Add-ValidationError {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[string]]$Errors,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    [void]$Errors.Add($Message)
}

function Add-ValidationWarning {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[string]]$Warnings,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    [void]$Warnings.Add($Message)
}

function Test-SemverLikeVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Value
    )

    return $Value -match '^\d+\.\d+(?:\.\d+)?$'
}

function ConvertTo-VersionOrNull {
    param(
        [Parameter(Mandatory = $true)][string]$Value
    )

    $version = $null
    if ([Version]::TryParse($Value, [ref]$version)) {
        return $version
    }

    return $null
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Text)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Remove-Utf8Bom {
    <#
    .SYNOPSIS
    Removes a leading UTF-8 BOM from a string so it can be parsed as JSON or SQL.
    Git may preserve BOMs written by some editors/encodings, and ConvertFrom-Json
    treats a BOM as an unexpected character.
    #>
    param([Parameter(Mandatory = $true)][string]$Text)

    if ($Text.StartsWith([char]0xFEFF, [System.StringComparison]::Ordinal)) {
        return $Text.Substring(1)
    }

    return $Text
}

function Get-ProjectReferences {
    <#
    .SYNOPSIS
    Returns the parent directory paths of all projects referenced by the
    specified .csproj file (or the first .csproj in the specified directory).
    #>
    param(
        [Parameter(Mandatory = $true)][string]$CsprojPath
    )

    $resolvedCsproj = $CsprojPath
    if (Test-Path -LiteralPath $CsprojPath -PathType Container) {
        $csprojFiles = @(Get-ChildItem -LiteralPath $CsprojPath -Filter '*.csproj' -File -ErrorAction SilentlyContinue)
        if ($csprojFiles.Count -eq 0) {
            return @()
        }
        $resolvedCsproj = $csprojFiles[0].FullName
    }

    if (-not (Test-Path -LiteralPath $resolvedCsproj -PathType Leaf)) {
        return @()
    }

    $csprojDir = Split-Path -Parent $resolvedCsproj
    $csprojText = Get-Content -LiteralPath $resolvedCsproj -Raw -Encoding UTF8

    $referencedDirs = [System.Collections.Generic.List[string]]::new()
    $matches = [System.Text.RegularExpressions.Regex]::Matches($csprojText, '<ProjectReference\s+Include="([^"]+)"')
    foreach ($match in $matches) {
        $includePath = $match.Groups[1].Value
        $resolvedRefPath = [System.IO.Path]::GetFullPath((Join-Path $csprojDir $includePath))
        if (Test-Path -LiteralPath $resolvedRefPath -PathType Leaf) {
            $refDir = [System.IO.Path]::GetFullPath((Split-Path -Parent $resolvedRefPath))
            if (-not $referencedDirs.Contains($refDir)) {
                [void]$referencedDirs.Add($refDir)
            }
        }
    }

    return $referencedDirs.ToArray()
}

function ConvertTo-NormalizedSql {
    param([Parameter(Mandatory = $true)][string]$SqlText)

    # Strip the historical local development database switch so the same
    # SQL can be compared across branches/installations.
    $normalized = [System.Text.RegularExpressions.Regex]::Replace(
        $SqlText,
        '(?im)^\s*USE\s+\[OpenModulePlatform\]\s*;\s*\r?\n\s*GO\s*(?:--.*)?\s*(?:\r?\n)?',
        '')

    # Strip single-line comments.
    $normalized = [System.Text.RegularExpressions.Regex]::Replace($normalized, '--[^\r\n]*', '')

    # Strip block comments.
    $normalized = [System.Text.RegularExpressions.Regex]::Replace($normalized, '/\*[\s\S]*?\*/', '')

    # Collapse all whitespace to a single space and trim.
    $normalized = [System.Text.RegularExpressions.Regex]::Replace($normalized, '\s+', ' ').Trim()

    return $normalized
}

$scriptDirectory = Get-ScriptDirectory
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory '..'))

$checkMark = [char]0x2713
$warningSign = [char]0x26A0
$crossMark = [char]0x2717

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

foreach ($component in @($manifest.components)) {
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
            # Check 6: minModuleDefinitionVersion sanity — HARD ERROR.
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
            # Check 10: compatibleArtifacts range sanity — HARD ERROR.
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
# Resolve base ref for diff-based checks (Check 7 and Check 8).
# Exemption: Behavior-neutral refactors (identical emitted strings/IL) do not require
# a cascade consumer bump. Only binary-affecting changes (new/removed APIs, changed
# default values, changed serialization format, etc.) require all consumers to be bumped.
# When running multi-phase campaigns, pass -BaseCommit to pin the diff baseline.
# ---------------------------------------------------------------------------
$baseRef = 'origin/main'
$baseRefAvailable = $false

if (-not [string]::IsNullOrWhiteSpace($BaseCommit)) {
    try {
        $null = git -C $repositoryRoot rev-parse --verify $BaseCommit 2>$null
        if ($LASTEXITCODE -eq 0) {
            $baseRef = $BaseCommit
            $baseRefAvailable = $true
        }
        else {
            Add-ValidationError -Errors $errors -Message "The specified -BaseCommit '$BaseCommit' could not be resolved. Verify the commit SHA exists in this repository."
        }
    }
    catch {
        Add-ValidationError -Errors $errors -Message "The specified -BaseCommit '$BaseCommit' could not be resolved. Verify the commit SHA exists in this repository."
    }
}
else {
    Add-ValidationWarning -Warnings $warnings -Message 'No -BaseCommit specified; cascade diff uses origin/main. Binary-affecting shared changes committed in earlier campaign phases may not trigger cascade bumps. Pass -BaseCommit <sha> to diff against a fixed baseline.'

    try {
        $null = git -C $repositoryRoot rev-parse --verify origin/main 2>$null
        $baseRefAvailable = ($LASTEXITCODE -eq 0)
    }
    catch {
        $baseRefAvailable = $false
    }

    if (-not $baseRefAvailable) {
        Add-ValidationWarning -Warnings $warnings -Message 'origin/main could not be resolved; skipping shared-project cascade validation.'
    }
}

$baseManifest = $null
$baseComponentsByKey = $null
if ($baseRefAvailable) {
    $baseManifestText = Remove-Utf8Bom -Text ((git -C $repositoryRoot show "$baseRef`:omp-components.json" 2>$null) -join "`n")
    if (-not [string]::IsNullOrWhiteSpace($baseManifestText)) {
        $baseManifest = ConvertFrom-JsonDocument -Json $baseManifestText -Depth $jsonDepth
    }

    $baseComponentsByKey = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
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

        $changedFiles = [string](git -C $repositoryRoot diff --name-only "$baseRef...HEAD" -- $diffPath 2>$null)
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
            foreach ($component in @($manifest.components)) {
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

        foreach ($script in @($definition.sqlScripts)) {
            if ($null -eq $script) {
                continue
            }

            $sqlPath = [string](Get-OptionalPropertyValue -Object $script -Name 'path')
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

        $changedFiles = [string](git -C $repositoryRoot diff --name-only "$baseRef...HEAD" -- $sqlPath 2>$null)
        if ([string]::IsNullOrWhiteSpace($changedFiles)) {
            $sqlFilesPassed++
            continue
        }

        $headText = Get-Content -LiteralPath $fullSqlPath -Raw -Encoding UTF8

        $baseTextLines = @(git -C $repositoryRoot show "$baseRef`:$sqlPath" 2>$null)
        $baseText = Remove-Utf8Bom -Text ($baseTextLines -join "`n")
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

        $baseDefinitionTextLines = @(git -C $repositoryRoot show "$baseRef`:$relativeDefinitionPath" 2>$null)
        $baseDefinitionText = Remove-Utf8Bom -Text ($baseDefinitionTextLines -join "`n")
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

            foreach ($component in @($manifest.components)) {
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
                if ($null -ne $minVersionObj -and $null -ne $newDefinitionVersionObj -and $minVersionObj -lt $newDefinitionVersionObj) {
                    $componentKey = [string](Get-OptionalPropertyValue -Object $component -Name 'componentKey')
                    if ([string]::IsNullOrWhiteSpace($componentKey)) {
                        $componentKey = '<unknown>'
                    }

                    # Check 8b: minModuleDefinitionVersion lags a bumped definitionVersion — HARD ERROR.
                    # The module's SQL contract changed and the definitionVersion was raised. Any
                    # component that exposes a minModuleDefinitionVersion for the same module must
                    # be updated to at least the new version, otherwise packages can be imported
                    # into environments with an older definition and fail at runtime due to missing
                    # schema/metadata.
                    Add-ValidationError -Errors $errors -Message "Component '$componentKey' has minModuleDefinitionVersion '$minModuleDefinitionVersion' which is less than the new definitionVersion '$newDefinitionVersion' for module '$moduleKey'. Update minModuleDefinitionVersion to at least '$newDefinitionVersion'."
                }
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Check 9: Transitive ProjectReference lockstep bumps.
# If a component's own project or any project it references (directly or
# through one level of ProjectReference transitivity) changed since the base,
# the component's version must be bumped. References already covered by
# Check 7's sharedProjects cascade are excluded to avoid double-counting.
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

    foreach ($component in @($manifest.components)) {
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
            $changedFiles = [string](git -C $repositoryRoot diff --name-only "$baseRef...HEAD" -- $relRefDir 2>$null)
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
if ($null -ne $manifest.components) {
    $componentCount = @($manifest.components).Count
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

if ($transitiveCheckCount -gt 0 -or $transitiveErrorCount -gt 0) {
    Write-Host "$checkMark $transitiveCheckCount component(s) passed transitive ProjectReference lockstep validation ($transitiveErrorCount error(s))"
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
