<#
.SYNOPSIS
Shared runtime configuration file rules for OMP packaging scripts.

.DESCRIPTION
Runtime configuration files (appsettings.json, appsettings.*.json,
odv.site.config.js) must never ship inside an immutable artifact payload. They
belong in the artifact package configuration-files section or in config
overlays so changing configuration never changes the artifact hash.

The canonical rule is RuntimeConfigurationFiles.IsRuntimeConfigurationFileName
in OpenModulePlatform.Artifacts/RuntimeConfigurationFiles.cs (OpenModulePlatform
repository). The import-time validators (HostAgent ArtifactZipImportService,
Portal package service, admin artifact upload) enforce that rule when a package
is imported. This helper mirrors the same rule at package build time so an
invalid payload fails the build instead of the import.
scripts/omp/test-runtime-configuration-guard.ps1 verifies that this mirror
stays in parity with the canonical C# list.

Dot-source this file from packaging scripts:

    . (Join-Path $PSScriptRoot 'runtime-configuration-files.ps1')
#>

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Test-OmpRuntimeConfigurationFileName {
    [CmdletBinding()]
    [OutputType([bool])]
    param([AllowEmptyString()][string]$FileName)

    # Mirrors RuntimeConfigurationFiles.IsRuntimeConfigurationFileName in
    # OpenModulePlatform.Artifacts (the canonical list). Keep in sync; parity
    # is verified by scripts/omp/test-runtime-configuration-guard.ps1.
    if ([string]::IsNullOrWhiteSpace($FileName)) {
        return $false
    }

    if ([string]::Equals($FileName, 'appsettings.json', [StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }

    if ($FileName.StartsWith('appsettings.', [StringComparison]::OrdinalIgnoreCase) `
            -and $FileName.EndsWith('.json', [StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }

    return [string]::Equals($FileName, 'odv.site.config.js', [StringComparison]::OrdinalIgnoreCase)
}

function Remove-OmpRuntimeConfigurationFilesFromFolder {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    Get-ChildItem -LiteralPath $Path -File -Recurse |
        Where-Object { Test-OmpRuntimeConfigurationFileName -FileName $_.Name } |
        Remove-Item -Force
}

function Get-OmpNestedZipEntryNames {
    [CmdletBinding()]
    [OutputType([string[]])]
    param([Parameter(Mandatory = $true)][System.IO.Compression.ZipArchiveEntry]$Entry)

    $names = [System.Collections.Generic.List[string]]::new()
    $stream = $Entry.Open()
    try {
        $memory = [System.IO.MemoryStream]::new()
        try {
            $stream.CopyTo($memory)
            $memory.Position = 0
            $nested = [System.IO.Compression.ZipArchive]::new($memory, [System.IO.Compression.ZipArchiveMode]::Read)
            try {
                foreach ($nestedEntry in $nested.Entries) {
                    if (-not [string]::IsNullOrWhiteSpace($nestedEntry.Name)) {
                        $names.Add($nestedEntry.FullName)
                    }
                }
            }
            finally {
                $nested.Dispose()
            }
        }
        finally {
            $memory.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }

    return $names.ToArray()
}

function Assert-OmpArtifactPackageHasNoRuntimeConfiguration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$Description
    )

    # Mirrors the import-time rule in ArtifactZipImportService: no payload
    # entry may be a runtime configuration file. At build time the whole
    # artifact zip is scanned (covers legacy whole-zip payloads) plus one level
    # of the nested payload zip used by the current package format
    # (payload/artifact.zip). Configuration-section entries are stored with an
    # index prefix (configuration/000-name.ext) and never match the rule.
    $offenders = [System.Collections.Generic.List[string]]::new()

    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($entry in $archive.Entries) {
            if ([string]::IsNullOrWhiteSpace($entry.Name)) {
                continue
            }

            if (Test-OmpRuntimeConfigurationFileName -FileName $entry.Name) {
                $offenders.Add($entry.FullName)
                continue
            }

            # Entry names may use backslashes when the zip was created by
            # Windows PowerShell 5.1 Compress-Archive; normalize before the
            # payload prefix check.
            $normalizedFullName = $entry.FullName.Replace('\', '/')
            if ($normalizedFullName.StartsWith('payload/', [StringComparison]::OrdinalIgnoreCase) `
                    -and $entry.Name.EndsWith('.zip', [StringComparison]::OrdinalIgnoreCase)) {
                foreach ($nestedName in (Get-OmpNestedZipEntryNames -Entry $entry)) {
                    $nestedFileName = ($nestedName.Split('/') | Select-Object -Last 1)
                    if (Test-OmpRuntimeConfigurationFileName -FileName $nestedFileName) {
                        $offenders.Add(('{0}!{1}' -f $entry.FullName, $nestedName))
                    }
                }
            }
        }
    }
    finally {
        $archive.Dispose()
    }

    if ($offenders.Count -gt 0) {
        throw ("{0} contains runtime configuration file(s): {1}. Put runtime configuration in the artifact package configuration-files section instead." -f $Description, ($offenders -join ', '))
    }
}
