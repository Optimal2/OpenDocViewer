#requires -Version 5.1
<#
.SYNOPSIS
    Tests that the local CI module definition step rejects a forbidden SQL write.
.EXAMPLE
    .\scripts\omp\test-module-sql-import.ps1 -PlatformRepositoryRoot '<workspace>\OpenModulePlatform'
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$PlatformRepositoryRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).ProviderPath
$embedSql = Join-Path $PlatformRepositoryRoot 'scripts/dev/embed-module-definition-sql.ps1'
$validateImport = Join-Path $repositoryRoot 'scripts/validate-module-sql-import.ps1'
$sqlPath = 'sql/3-initialize-opendocviewer.sql'
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ('odv-module-sql-import-' + [guid]::NewGuid().ToString('N'))

try {
    $null = New-Item -ItemType Directory -Path (Join-Path $fixture 'sql') -Force
    foreach ($path in @('.gitattributes', 'omp-components.json', 'opendocviewer.module-definition.json', $sqlPath)) {
        Copy-Item -LiteralPath (Join-Path $repositoryRoot $path) -Destination (Join-Path $fixture $path)
    }
    # The embed tool reads the SQL line-ending policy through git check-attr.
    & git init --quiet $fixture
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the SQL import fixture.' }

    [System.IO.File]::AppendAllText((Join-Path $fixture $sqlPath), @'

GO
DECLARE @ownershipProbe nvarchar(max);
SET @ownershipProbe = N'ALTER TABLE omp.ArtifactConfigurationFiles ADD OwnershipProbe int NULL;';
EXEC (@ownershipProbe);
'@)
    $global:LASTEXITCODE = 0
    & $embedSql -RepositoryRoot $fixture
    if ($LASTEXITCODE -ne 0) { throw 'Could not re-embed the SQL import fixture.' }

    $output = [System.Collections.Generic.List[string]]::new()
    $guardFailed = $false
    try {
        & $validateImport -RepositoryRoot $fixture -PlatformRepositoryRoot $PlatformRepositoryRoot 6>&1 | ForEach-Object {
            $output.Add([string]$_)
            Write-Host $_
        }
    }
    catch {
        $guardFailed = $true
        Write-Host $_
    }
    if (-not $guardFailed -or -not ($output -match 'OMP-MODULE-SQL-CONFIG-OWNERSHIP:.*dynamic SQL payload cannot be resolved')) {
        throw 'Expected the module definition step to reject the embedded dynamic SQL with OMP-MODULE-SQL-CONFIG-OWNERSHIP.'
    }
    Write-Host 'PASS: module SQL import step rejects a forbidden write in embedded dynamic SQL'
}
finally {
    if (Test-Path -LiteralPath $fixture -PathType Container) {
        if ((Resolve-Path -LiteralPath $fixture).ProviderPath -ne $fixture) {
            throw "Refusing to remove an unexpected fixture path: '$fixture'."
        }
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}
