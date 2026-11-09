#Requires -Version 5.1
<#
.SYNOPSIS
Tests runtime-config SRI injection into the OMP web payload HTML entries.

.DESCRIPTION
Update-OpenDocViewerIndexHtmlIntegrity (in build-repository-objects.ps1) must
write the data-odv-*-integrity attributes onto the data-odv-bootstrap script
tag of BOTH payload entries: index.html (the viewer) and manual/index.html
(the stand-alone manual page, which boots through the same ../src/app/bootConfig.js
and loads the same odv.config.js / odv.site.config.js files one level up).

Cases:
1. With a site-config mapping, both files get both attributes with the
   SHA-384 hashes of the same config files, and nothing else changes.
2. Without a site-config mapping, both files get only
   data-odv-config-integrity.
3. A manual/index.html without the bootstrap tag fails the build instead of
   shipping the manual page without integrity hashes.
4. A payload without manual/index.html still injects index.html.
5. A payload without odv.config.js fails (the hash source is required).
6. A payload without index.html returns without throwing (legacy behaviour).

The builder script is dot-sourced with a fake repository and a stub OMP root
so the real shipped functions are tested with no side effects on this repo.

Exits 1 when any check fails.

.EXAMPLE
pwsh -File scripts/omp/test-index-html-integrity.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$builderScript = Join-Path $PSScriptRoot 'build-repository-objects.ps1'
$failures = New-Object System.Collections.Generic.List[string]

function Add-TestFailure {
    param([Parameter(Mandatory = $true)][string]$Message)
    $failures.Add($Message)
    Write-Host "FAIL: $Message"
}

function Get-ExpectedSriHash {
    param([Parameter(Mandatory = $true)][string]$Path)
    $sha384 = [System.Security.Cryptography.SHA384]::Create()
    try {
        $hash = $sha384.ComputeHash([System.IO.File]::ReadAllBytes($Path))
        return 'sha384-' + [Convert]::ToBase64String($hash)
    }
    finally {
        $sha384.Dispose()
    }
}

function Add-ExpectedIntegrityAttributes {
    param(
        [Parameter(Mandatory = $true)][string]$Html,
        [Parameter(Mandatory = $true)][string[]]$Names,
        [Parameter(Mandatory = $true)][string[]]$Values
    )
    $match = [Regex]::Match($Html, '<script\s+[^>]*data-odv-bootstrap[^>]*>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        throw 'Test fixture has no data-odv-bootstrap script tag.'
    }
    $tag = $match.Value
    for ($i = 0; $i -lt $Names.Count; $i++) {
        $tag = $tag -replace '>$', (" {0}=""{1}"">" -f $Names[$i], $Values[$i])
    }
    return $Html.Substring(0, $match.Index) + $tag + $Html.Substring($match.Index + $match.Length)
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('odv-index-sri-test-' + [Guid]::NewGuid().ToString('N'))
$fakeRepo = Join-Path $tempRoot 'fake-repo'
$fakeOmp = Join-Path $tempRoot 'fake-omp'
$fakeOut = Join-Path $tempRoot 'objects'
try {
    New-Item -ItemType Directory -Path $fakeRepo -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fakeOmp (Join-Path 'scripts' 'deployment')) -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $fakeOmp (Join-Path 'scripts' (Join-Path 'deployment' 'new-omp-artifact-package.ps1'))) -Value '# stub' -Encoding UTF8
    $fakeManifest = @{
        manifestVersion = 1
        repositoryKey = 'fakerepo'
        repositoryVersion = '1.0.0'
        moduleDefinitions = @()
        components = @()
    }
    ($fakeManifest | ConvertTo-Json -Depth 8) |
        Set-Content -LiteralPath (Join-Path $fakeRepo 'omp-components.json') -Encoding UTF8

    # Defines the real shipped functions in this scope; the body runs with no
    # components selected, so nothing is built or packaged.
    . $builderScript -RepositoryRoot $fakeRepo -OutputRoot $fakeOut -OmpRepositoryRoot $fakeOmp | Out-Null

    if (-not (Get-Command -Name 'Update-OpenDocViewerIndexHtmlIntegrity' -ErrorAction SilentlyContinue)) {
        throw 'Dot-sourcing build-repository-objects.ps1 did not define Update-OpenDocViewerIndexHtmlIntegrity.'
    }

    $indexFixture = @(
        '<!doctype html>'
        '<html lang="en">'
        '<head><meta charset="utf-8" /></head>'
        '<body>'
        '<div id="root"></div>'
        '<script type="module" data-odv-bootstrap src="./assets/bootConfig-abc123.js"></script>'
        '</body>'
        '</html>'
        ''
    ) -join "`n"

    $manualFixture = @(
        '<!doctype html>'
        '<html lang="en">'
        '<head><meta charset="utf-8" />'
        '<meta name="odv-app-base" content="../" />'
        '<meta name="odv-page" content="manual" />'
        '</head>'
        '<body>'
        '<div id="root"></div>'
        '<script type="module" data-odv-bootstrap src="../assets/bootConfig-abc123.js"></script>'
        '</body>'
        '</html>'
        ''
    ) -join "`n"

    $configContent = 'window.__ODV_CONFIG__ = { app: "sri-test" };'
    $siteContent = 'window.__ODV_SITE_CONFIG__ = {};'

    # --- Case 1: both files get both attributes with the same hashes --------
    $payload = Join-Path $tempRoot 'payload-both'
    New-Item -ItemType Directory -Path (Join-Path $payload 'manual') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $payload 'index.html') -Value $indexFixture -Encoding UTF8 -NoNewline
    Set-Content -LiteralPath (Join-Path $payload (Join-Path 'manual' 'index.html')) -Value $manualFixture -Encoding UTF8 -NoNewline
    Set-Content -LiteralPath (Join-Path $payload 'odv.config.js') -Value $configContent -Encoding UTF8 -NoNewline
    $siteSource = Join-Path $tempRoot 'odv.site.config.js'
    Set-Content -LiteralPath $siteSource -Value $siteContent -Encoding UTF8 -NoNewline
    $mappings = @{ 'test-web' = @("odv.site.config.js=$siteSource") }

    Update-OpenDocViewerIndexHtmlIntegrity -PayloadPath $payload -ComponentKey 'test-web' -ConfigurationMappings $mappings

    $expectedConfigHash = Get-ExpectedSriHash -Path (Join-Path $payload 'odv.config.js')
    $expectedSiteHash = Get-ExpectedSriHash -Path $siteSource
    $actualIndex = [System.IO.File]::ReadAllText((Join-Path $payload 'index.html'))
    $actualManual = [System.IO.File]::ReadAllText((Join-Path $payload (Join-Path 'manual' 'index.html')))
    $expectedIndex = Add-ExpectedIntegrityAttributes -Html $indexFixture `
        -Names @('data-odv-config-integrity', 'data-odv-site-config-integrity') `
        -Values @($expectedConfigHash, $expectedSiteHash)
    $expectedManual = Add-ExpectedIntegrityAttributes -Html $manualFixture `
        -Names @('data-odv-config-integrity', 'data-odv-site-config-integrity') `
        -Values @($expectedConfigHash, $expectedSiteHash)

    if ($actualIndex -ceq $expectedIndex) {
        Write-Host 'PASS: index.html gets both integrity attributes with the config hashes.'
    }
    else {
        Add-TestFailure 'index.html content is not the expected bootstrap tag plus both integrity attributes.'
    }
    if ($actualManual -ceq $expectedManual) {
        Write-Host 'PASS: manual/index.html gets both integrity attributes with the same hashes.'
    }
    else {
        Add-TestFailure 'manual/index.html was skipped or got different attributes: it must carry the same data-odv-*-integrity values as index.html.'
    }

    # --- Case 2: no site mapping means config hash only, in both files ------
    $payloadNoSite = Join-Path $tempRoot 'payload-nosite'
    New-Item -ItemType Directory -Path (Join-Path $payloadNoSite 'manual') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $payloadNoSite 'index.html') -Value $indexFixture -Encoding UTF8 -NoNewline
    Set-Content -LiteralPath (Join-Path $payloadNoSite (Join-Path 'manual' 'index.html')) -Value $manualFixture -Encoding UTF8 -NoNewline
    Set-Content -LiteralPath (Join-Path $payloadNoSite 'odv.config.js') -Value $configContent -Encoding UTF8 -NoNewline

    Update-OpenDocViewerIndexHtmlIntegrity -PayloadPath $payloadNoSite -ComponentKey 'test-web' -ConfigurationMappings @{}

    $actualIndexNoSite = [System.IO.File]::ReadAllText((Join-Path $payloadNoSite 'index.html'))
    $actualManualNoSite = [System.IO.File]::ReadAllText((Join-Path $payloadNoSite (Join-Path 'manual' 'index.html')))
    $expectedConfigHashNoSite = Get-ExpectedSriHash -Path (Join-Path $payloadNoSite 'odv.config.js')
    $expectedIndexNoSite = Add-ExpectedIntegrityAttributes -Html $indexFixture `
        -Names @('data-odv-config-integrity') -Values @($expectedConfigHashNoSite)
    $expectedManualNoSite = Add-ExpectedIntegrityAttributes -Html $manualFixture `
        -Names @('data-odv-config-integrity') -Values @($expectedConfigHashNoSite)

    if (($actualIndexNoSite -ceq $expectedIndexNoSite) -and ($actualManualNoSite -ceq $expectedManualNoSite)) {
        Write-Host 'PASS: without a site mapping both files get only data-odv-config-integrity.'
    }
    else {
        Add-TestFailure 'Without a site mapping the files must carry only data-odv-config-integrity.'
    }

    # --- Case 3: manual page without the bootstrap tag must fail ------------
    $payloadNoTag = Join-Path $tempRoot 'payload-notag'
    New-Item -ItemType Directory -Path (Join-Path $payloadNoTag 'manual') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $payloadNoTag 'index.html') -Value $indexFixture -Encoding UTF8 -NoNewline
    Set-Content -LiteralPath (Join-Path $payloadNoTag (Join-Path 'manual' 'index.html')) -Value '<html><body>No bootstrap here.</body></html>' -Encoding UTF8 -NoNewline
    Set-Content -LiteralPath (Join-Path $payloadNoTag 'odv.config.js') -Value $configContent -Encoding UTF8 -NoNewline

    $threw = $false
    try {
        Update-OpenDocViewerIndexHtmlIntegrity -PayloadPath $payloadNoTag -ComponentKey 'test-web' -ConfigurationMappings @{}
    }
    catch {
        $threw = $true
        if ("$($_.Exception.Message)" -notmatch 'manual/index\.html') {
            Add-TestFailure "Manual-page failure did not name manual/index.html: $($_.Exception.Message)"
        }
    }
    if ($threw) {
        Write-Host 'PASS: a manual page without the bootstrap tag fails instead of shipping without SRI.'
    }
    else {
        Add-TestFailure 'A manual/index.html without the bootstrap tag was silently accepted (manual page would ship without SRI).'
    }

    # --- Case 4: missing manual file still injects index.html ----------------
    $payloadNoManual = Join-Path $tempRoot 'payload-nomanual'
    New-Item -ItemType Directory -Path $payloadNoManual -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $payloadNoManual 'index.html') -Value $indexFixture -Encoding UTF8 -NoNewline
    Set-Content -LiteralPath (Join-Path $payloadNoManual 'odv.config.js') -Value $configContent -Encoding UTF8 -NoNewline

    $noManualThrew = $false
    try {
        Update-OpenDocViewerIndexHtmlIntegrity -PayloadPath $payloadNoManual -ComponentKey 'test-web' -ConfigurationMappings @{} 3>$null
    }
    catch {
        $noManualThrew = $true
    }
    $expectedNoManual = Add-ExpectedIntegrityAttributes -Html $indexFixture `
        -Names @('data-odv-config-integrity') -Values @((Get-ExpectedSriHash -Path (Join-Path $payloadNoManual 'odv.config.js')))
    if ((-not $noManualThrew) -and ([System.IO.File]::ReadAllText((Join-Path $payloadNoManual 'index.html')) -ceq $expectedNoManual)) {
        Write-Host 'PASS: a payload without manual/index.html still injects index.html.'
    }
    else {
        Add-TestFailure 'A payload without manual/index.html must still inject index.html without throwing.'
    }

    # --- Case 5: missing odv.config.js fails --------------------------------
    $payloadNoConfig = Join-Path $tempRoot 'payload-noconfig'
    New-Item -ItemType Directory -Path $payloadNoConfig -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $payloadNoConfig 'index.html') -Value $indexFixture -Encoding UTF8 -NoNewline

    $configThrew = $false
    try {
        Update-OpenDocViewerIndexHtmlIntegrity -PayloadPath $payloadNoConfig -ComponentKey 'test-web' -ConfigurationMappings @{}
    }
    catch {
        $configThrew = $true
    }
    if ($configThrew) {
        Write-Host 'PASS: a payload without odv.config.js fails.'
    }
    else {
        Add-TestFailure 'A payload without odv.config.js was silently accepted.'
    }

    # --- Case 6: missing index.html returns without throwing -----------------
    $payloadNoIndex = Join-Path $tempRoot 'payload-noindex'
    New-Item -ItemType Directory -Path $payloadNoIndex -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $payloadNoIndex 'odv.config.js') -Value $configContent -Encoding UTF8 -NoNewline

    $indexThrew = $false
    try {
        Update-OpenDocViewerIndexHtmlIntegrity -PayloadPath $payloadNoIndex -ComponentKey 'test-web' -ConfigurationMappings @{} 3>$null
    }
    catch {
        $indexThrew = $true
    }
    if (-not $indexThrew) {
        Write-Host 'PASS: a payload without index.html is skipped without throwing.'
    }
    else {
        Add-TestFailure 'A payload without index.html threw instead of being skipped.'
    }
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($failures.Count -gt 0) {
    Write-Host "Index HTML integrity tests FAILED ($($failures.Count) failure(s))."
    exit 1
}

Write-Host 'Index HTML integrity tests passed.'
exit 0
