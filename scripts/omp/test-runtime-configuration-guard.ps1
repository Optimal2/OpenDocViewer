#Requires -Version 5.1
<#
.SYNOPSIS
Tests the shared runtime configuration guard used by OMP packaging scripts.

.DESCRIPTION
Two kinds of checks:

1. Parity: the PowerShell mirror in runtime-configuration-files.ps1 must accept
   every file name listed in the canonical C# source
   (OpenModulePlatform.Artifacts/RuntimeConfigurationFiles.cs in the
   OpenModulePlatform repository) and must reject near-miss names. This keeps
   the build-time guard from drifting away from the import-time validator. The
   OpenModulePlatform checkout is located via -OmpRepositoryRoot, the
   OMP_REPOSITORY_ROOT environment variable, or a sibling folder named
   OpenModulePlatform next to this repository.

2. Functional: the folder strip and the artifact zip fail-fast guard are
   exercised against temporary folders/zips, including a valid package, a
   legacy flat package carrying configuration/odv.site.config.js, and a
   current-format package whose nested payload zip contains appsettings.json.
   The builder reuse path and the universal package exporter wiring are
   exercised end to end against a fake repository.

Exits 1 when any check fails.

.EXAMPLE
pwsh -File scripts/omp/test-runtime-configuration-guard.ps1
#>
[CmdletBinding()]
param(
    [string]$OmpRepositoryRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

. (Join-Path $PSScriptRoot 'runtime-configuration-files.ps1')

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$failures = [System.Collections.Generic.List[string]]::new()

function Add-TestFailure {
    param([Parameter(Mandatory = $true)][string]$Message)
    $failures.Add($Message)
    Write-Host "FAIL: $Message"
}

function Assert-NameRule {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$FileName,
        [Parameter(Mandatory = $true)][bool]$Expected
    )

    $actual = Test-OmpRuntimeConfigurationFileName -FileName $FileName
    if ($actual -ne $Expected) {
        Add-TestFailure "Test-OmpRuntimeConfigurationFileName('$FileName') returned $actual, expected $Expected."
    }
}

function Test-GuardThrows {
    param([Parameter(Mandatory = $true)][string]$ZipPath)

    try {
        Assert-OmpArtifactPackageHasNoRuntimeConfiguration -ZipPath $ZipPath -Description "Test package '$([System.IO.Path]::GetFileName($ZipPath))'"
        return $false
    }
    catch {
        return $true
    }
}

# --- 0. Locate the OpenModulePlatform repository (canonical C# source) ------
$ompRoot = ''
$ompCandidates = @()
if (-not [string]::IsNullOrWhiteSpace($OmpRepositoryRoot)) {
    $ompCandidates += $OmpRepositoryRoot
}
if (-not [string]::IsNullOrWhiteSpace($env:OMP_REPOSITORY_ROOT)) {
    $ompCandidates += $env:OMP_REPOSITORY_ROOT
}
$ompCandidates += (Join-Path (Split-Path -Parent $repositoryRoot) 'OpenModulePlatform')

foreach ($candidate in $ompCandidates) {
    $resolvedCandidate = [System.IO.Path]::GetFullPath($candidate)
    if (Test-Path -LiteralPath (Join-Path $resolvedCandidate 'OpenModulePlatform.Artifacts\RuntimeConfigurationFiles.cs') -PathType Leaf) {
        $ompRoot = $resolvedCandidate
        break
    }
}

if ([string]::IsNullOrWhiteSpace($ompRoot)) {
    Add-TestFailure 'Could not locate an OpenModulePlatform checkout with OpenModulePlatform.Artifacts\RuntimeConfigurationFiles.cs. Pass -OmpRepositoryRoot or set OMP_REPOSITORY_ROOT.'
}

# --- 1. Parity with the canonical C# list -----------------------------------
if (-not [string]::IsNullOrWhiteSpace($ompRoot)) {
    $csharpPath = Join-Path $ompRoot 'OpenModulePlatform.Artifacts\RuntimeConfigurationFiles.cs'
    $csharp = Get-Content -LiteralPath $csharpPath -Raw -Encoding UTF8
    $blockMatch = [Regex]::Match($csharp, 'ExactFileNames\s*=\s*\[(?<body>[^\]]*)\]', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if (-not $blockMatch.Success) {
        Add-TestFailure 'Could not locate the ExactFileNames block in RuntimeConfigurationFiles.cs.'
    }
    else {
        $canonicalNames = @()
        foreach ($nameMatch in [Regex]::Matches($blockMatch.Groups['body'].Value, '"([^"]+)"')) {
            $canonicalNames += $nameMatch.Groups[1].Value
        }

        if ($canonicalNames.Count -eq 0) {
            Add-TestFailure 'The ExactFileNames block in RuntimeConfigurationFiles.cs contains no names.'
        }

        foreach ($name in $canonicalNames) {
            Assert-NameRule -FileName $name -Expected $true
        }
    }
}

# --- 2. Name rule unit checks ------------------------------------------------
Assert-NameRule -FileName 'appsettings.json' -Expected $true
Assert-NameRule -FileName 'APPSETTINGS.JSON' -Expected $true
Assert-NameRule -FileName 'appsettings.Development.json' -Expected $true
Assert-NameRule -FileName 'APPSETTINGS.PRODUCTION.JSON' -Expected $true
Assert-NameRule -FileName 'odv.site.config.js' -Expected $true
Assert-NameRule -FileName 'ODV.SITE.CONFIG.JS' -Expected $true

Assert-NameRule -FileName 'odv.config.js' -Expected $false
Assert-NameRule -FileName 'web.config' -Expected $false
Assert-NameRule -FileName '000-odv.site.config.js' -Expected $false
Assert-NameRule -FileName 'appsettingsjson' -Expected $false
Assert-NameRule -FileName 'myappsettings.json' -Expected $false
Assert-NameRule -FileName 'appsettings.json.bak' -Expected $false
Assert-NameRule -FileName 'appsettings.' -Expected $false
Assert-NameRule -FileName '' -Expected $false

# --- 3. Functional folder strip + zip guard tests ---------------------------
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('odv-rc-guard-test-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    # Folder strip removes runtime configuration and keeps everything else.
    $stripRoot = Join-Path $tempRoot 'strip'
    New-Item -ItemType Directory -Path (Join-Path $stripRoot 'sub') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $stripRoot 'odv.site.config.js'), 'window.odv = {};')
    [System.IO.File]::WriteAllText((Join-Path $stripRoot 'appsettings.json'), '{}')
    [System.IO.File]::WriteAllText((Join-Path $stripRoot 'sub\appsettings.Development.json'), '{}')
    [System.IO.File]::WriteAllText((Join-Path $stripRoot 'sub\keep.txt'), 'keep')

    Remove-OmpRuntimeConfigurationFilesFromFolder -Path $stripRoot

    foreach ($removed in @('odv.site.config.js', 'appsettings.json', 'sub\appsettings.Development.json')) {
        if (Test-Path -LiteralPath (Join-Path $stripRoot $removed)) {
            Add-TestFailure "Folder strip did not remove '$removed'."
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $stripRoot 'sub\keep.txt') -PathType Leaf)) {
        Add-TestFailure "Folder strip removed 'sub\keep.txt' which must be kept."
    }

    # Valid current-format package: index-prefixed configuration entry plus a
    # clean nested payload zip. Must pass the guard.
    $validRoot = Join-Path $tempRoot 'valid-package'
    New-Item -ItemType Directory -Path (Join-Path $validRoot 'configuration') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $validRoot 'payload') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $validRoot 'omp-artifact-package.json'), '{"formatVersion":1}')
    [System.IO.File]::WriteAllText((Join-Path $validRoot 'configuration\000-odv.site.config.js'), 'window.odv = {};')

    $payloadRoot = Join-Path $tempRoot 'valid-payload'
    New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $payloadRoot 'index.html'), '<html></html>')
    [System.IO.File]::WriteAllText((Join-Path $payloadRoot 'odv.config.js'), 'window.odv = {};')
    Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath (Join-Path $validRoot 'payload\artifact.zip') -Force

    $validZip = Join-Path $tempRoot 'valid.zip'
    Compress-Archive -Path (Join-Path $validRoot '*') -DestinationPath $validZip -Force
    if (Test-GuardThrows -ZipPath $validZip) {
        Add-TestFailure 'Guard rejected a valid package (configuration/000-odv.site.config.js + clean payload).'
    }

    # Invalid legacy package: runtime configuration as a direct zip entry.
    $legacyRoot = Join-Path $tempRoot 'legacy-package'
    New-Item -ItemType Directory -Path (Join-Path $legacyRoot 'configuration') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $legacyRoot 'configuration\odv.site.config.js'), 'window.odv = {};')
    [System.IO.File]::WriteAllText((Join-Path $legacyRoot 'index.html'), '<html></html>')
    $legacyZip = Join-Path $tempRoot 'legacy.zip'
    Compress-Archive -Path (Join-Path $legacyRoot '*') -DestinationPath $legacyZip -Force
    if (-not (Test-GuardThrows -ZipPath $legacyZip)) {
        Add-TestFailure 'Guard accepted a package containing configuration/odv.site.config.js.'
    }

    # Invalid current-format package: runtime configuration inside the nested
    # payload zip. A non-default payload zip name is used on purpose: the guard
    # must scan any zip below payload/, not only payload/artifact.zip.
    $nestedRoot = Join-Path $tempRoot 'nested-package'
    New-Item -ItemType Directory -Path (Join-Path $nestedRoot 'payload') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $nestedRoot 'omp-artifact-package.json'), '{"formatVersion":1}')

    $badPayloadRoot = Join-Path $tempRoot 'bad-payload'
    New-Item -ItemType Directory -Path $badPayloadRoot -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $badPayloadRoot 'index.html'), '<html></html>')
    [System.IO.File]::WriteAllText((Join-Path $badPayloadRoot 'appsettings.json'), '{}')
    Compress-Archive -Path (Join-Path $badPayloadRoot '*') -DestinationPath (Join-Path $nestedRoot 'payload\my-bundle.zip') -Force

    $nestedZip = Join-Path $tempRoot 'nested.zip'
    Compress-Archive -Path (Join-Path $nestedRoot '*') -DestinationPath $nestedZip -Force
    if (-not (Test-GuardThrows -ZipPath $nestedZip)) {
        Add-TestFailure 'Guard accepted a package whose nested payload zip contains appsettings.json.'
    }

    # --- 4. Exporter wiring: export-universal-package.ps1 must be guarded ---
    # The exporter assembles its object root in a private temp folder, so the
    # guard cannot be triggered from the outside with a poisoned object root.
    # Verify the wiring statically, then exercise the exporter end to end
    # against a fake repository below (a poisoned artifact must fail the whole
    # export; a clean one must export without false positives).
    $exporterScript = Join-Path $PSScriptRoot 'export-universal-package.ps1'
    $exporterText = Get-Content -LiteralPath $exporterScript -Raw -Encoding UTF8
    if ($exporterText -notmatch [Regex]::Escape(". (Join-Path (Get-ScriptDirectory) 'runtime-configuration-files.ps1')")) {
        Add-TestFailure 'export-universal-package.ps1 does not dot-source runtime-configuration-files.ps1.'
    }
    if ($exporterText -notmatch 'Assert-OmpArtifactPackageHasNoRuntimeConfiguration') {
        Add-TestFailure 'export-universal-package.ps1 does not call Assert-OmpArtifactPackageHasNoRuntimeConfiguration.'
    }

    # --- 5. Integration: fake repository with a reused artifact -------------
    # Reproduces the original regression: a stale pre-built artifact zip that
    # contains a runtime configuration file must not be silently bundled when
    # the builder reuses existing artifacts.
    $builderScript = Join-Path $PSScriptRoot 'build-repository-objects.ps1'
    $fakeRepo = Join-Path $tempRoot 'fake-repo'
    New-Item -ItemType Directory -Path (Join-Path $fakeRepo 'artifacts') -Force | Out-Null

    $fakeManifest = @{
        manifestVersion   = 1
        repositoryKey     = 'fakerepo'
        repositoryVersion = '1.0.0'
        moduleDefinitions = @()
        components        = @(
            @{
                componentKey = 'fake-web'
                moduleKey    = 'fake_module'
                appKey       = 'fake_app'
                packageType  = 'web-app'
                targetName   = 'fake-target'
                version      = '9.9.9'
            }
        )
    }
    ($fakeManifest | ConvertTo-Json -Depth 8) |
        Set-Content -LiteralPath (Join-Path $fakeRepo 'omp-components.json') -Encoding UTF8

    $builderArgs = @{
        RepositoryRoot = $fakeRepo
        AllComponents  = $true
    }
    if (-not [string]::IsNullOrWhiteSpace($ompRoot)) {
        $builderArgs.OmpRepositoryRoot = $ompRoot
    }

    Copy-Item -LiteralPath $legacyZip -Destination (Join-Path $fakeRepo 'artifacts\fake_module__fake_app__web-app__fake-target__9.9.9.zip') -Force

    $reuseFailed = $false
    $reuseMessage = ''
    try {
        & $builderScript @builderArgs -OutputRoot (Join-Path $tempRoot 'reuse-objects')
    }
    catch {
        $reuseFailed = $true
        $reuseMessage = $_.Exception.Message
    }
    if (-not $reuseFailed) {
        Add-TestFailure 'build-repository-objects.ps1 silently bundled a reused artifact containing odv.site.config.js.'
    }
    elseif ($reuseMessage -notmatch 'odv\.site\.config\.js') {
        Add-TestFailure "Reuse-path failure did not name the runtime configuration file: $reuseMessage"
    }

    # The exporter must also fail for the poisoned repository.
    $exportFailed = $false
    try {
        & $exporterScript @builderArgs -OutputPath (Join-Path $tempRoot 'export-invalid.zip')
    }
    catch {
        $exportFailed = $true
    }
    if (-not $exportFailed) {
        Add-TestFailure 'export-universal-package.ps1 did not fail for a repository with a poisoned artifact zip.'
    }

    # A valid reused artifact must be bundled without a rebuild, and the
    # exporter must produce a universal package without false positives.
    Copy-Item -LiteralPath $validZip -Destination (Join-Path $fakeRepo 'artifacts\fake_module__fake_app__web-app__fake-target__9.9.9.zip') -Force
    $validReuseFailed = $false
    try {
        & $builderScript @builderArgs -OutputRoot (Join-Path $tempRoot 'reuse-objects-valid')
    }
    catch {
        $validReuseFailed = $true
        Write-Host "Unexpected valid reuse failure: $($_.Exception.Message)"
    }
    if ($validReuseFailed -or
        -not (Test-Path -LiteralPath (Join-Path $tempRoot 'reuse-objects-valid\artifacts\fake_module__fake_app__web-app__fake-target__9.9.9.zip') -PathType Leaf)) {
        Add-TestFailure 'build-repository-objects.ps1 failed to bundle a valid reused artifact.'
    }

    $cleanExportZip = Join-Path $tempRoot 'export-valid.zip'
    $cleanExportFailed = $false
    try {
        & $exporterScript @builderArgs -OutputPath $cleanExportZip
    }
    catch {
        $cleanExportFailed = $true
        Write-Host "Unexpected clean export failure: $($_.Exception.Message)"
    }
    if ($cleanExportFailed -or -not (Test-Path -LiteralPath $cleanExportZip -PathType Leaf)) {
        Add-TestFailure 'export-universal-package.ps1 failed for a repository with a clean artifact.'
    }
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) {
    Write-Host ''
    Write-Host "Runtime configuration guard tests FAILED ($($failures.Count) failure(s))."
    exit 1
}

Write-Host ''
Write-Host 'Runtime configuration guard tests passed.'
exit 0
