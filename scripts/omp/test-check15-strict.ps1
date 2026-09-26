#Requires -Version 5.1
<#
.SYNOPSIS
Tests how the local CI gate runs Check 15 (shared-script drift guard).

.DESCRIPTION
Check 15 calls validate-shared-scripts.ps1 from the OpenModulePlatform
checkout. When that checkout cannot be found, a non-strict run only warns
"NOT VERIFIED" and exits 0, which let shared-script drift through the
pre-push gate from git worktrees that have no sibling OpenModulePlatform
folder. This test pins the behaviour that closes that gap:

1. validate-component-versions.ps1 resolves the platform root in the same
   order as the canonical validate-shared-scripts.ps1: -PlatformRepositoryRoot,
   then $env:OMP_PLATFORM_ROOT, then $env:OpenModulePlatformRoot, then the
   sibling folder named OpenModulePlatform.
2. -Strict without a reachable platform root exits 1.
3. The resolved root and the Strict switch are forwarded to the guard.
4. local-ci.ps1 runs the validator with -Strict unless the caller passes
   -AllowUnverifiedSharedScripts, and forwards -PlatformRepositoryRoot.

The platform guard is replaced by a stub in a temporary folder so the test
does not depend on a real OpenModulePlatform checkout. When a real checkout is
available (-OmpRepositoryRoot, OMP_PLATFORM_ROOT, or the sibling folder), one
extra case runs the real guard against it; otherwise that case is skipped.

Exits 1 when any check fails.

.PARAMETER OmpRepositoryRoot
Optional real OpenModulePlatform checkout for the end-to-end case.

.EXAMPLE
pwsh -File scripts/omp/test-check15-strict.ps1
#>
[CmdletBinding()]
param(
    [string]$OmpRepositoryRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$validator = Join-Path $PSScriptRoot 'validate-component-versions.ps1'
$localCi = Join-Path (Join-Path $repositoryRoot 'scripts') 'local-ci.ps1'

$failures = New-Object System.Collections.Generic.List[string]
function Assert-True {
    param([bool]$Condition, [string]$Name, [string]$Detail = '')
    if ($Condition) {
        Write-Host "PASS: $Name" -ForegroundColor Green
    }
    else {
        Write-Host "FAIL: $Name $Detail" -ForegroundColor Red
        $failures.Add($Name)
    }
}

function New-StubPlatformRoot {
    param([int]$ExitCode)
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ("odv-check15-{0}" -f ([guid]::NewGuid().ToString('N')))
    $guardDirectory = Join-Path (Join-Path $root 'scripts') 'omp'
    New-Item -ItemType Directory -Path $guardDirectory -Force | Out-Null
    $stub = @"
param([string]`$ConsumerRepositoryRoot, [string]`$PlatformRepositoryRoot, [switch]`$Strict)
Write-Host "STUB-CHECK15 platform=`$PlatformRepositoryRoot strict=`$([bool]`$Strict)"
exit $ExitCode
"@
    Set-Content -LiteralPath (Join-Path $guardDirectory 'validate-shared-scripts.ps1') -Value $stub -Encoding UTF8
    return $root
}

# Runs the validator in-process (its 'exit N' ends only the script) with a
# controlled environment, and returns the exit code plus all output streams.
function Invoke-Validator {
    param(
        [string]$OmpPlatformRoot,
        [string]$OpenModulePlatformRoot,
        [hashtable]$Arguments
    )
    $savedOmp = $env:OMP_PLATFORM_ROOT
    $savedLegacy = $env:OpenModulePlatformRoot
    try {
        $env:OMP_PLATFORM_ROOT = $OmpPlatformRoot
        $env:OpenModulePlatformRoot = $OpenModulePlatformRoot
        $global:LASTEXITCODE = 0
        $output = & $validator -BaseCommit '' @Arguments *>&1 | Out-String
        return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
    }
    finally {
        $env:OMP_PLATFORM_ROOT = $savedOmp
        $env:OpenModulePlatformRoot = $savedLegacy
    }
}

$missingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("odv-check15-missing-{0}" -f ([guid]::NewGuid().ToString('N')))
$passingStub = New-StubPlatformRoot -ExitCode 0
$failingStub = New-StubPlatformRoot -ExitCode 1
try {
    # 1. Strict + no reachable platform root => exit 1 with the Check 15 error.
    $result = Invoke-Validator -OmpPlatformRoot $missingRoot -OpenModulePlatformRoot '' -Arguments @{ Strict = $true }
    Assert-True ($result.ExitCode -eq 1) 'strict without platform root exits 1' "(exit $($result.ExitCode))"
    Assert-True ($result.Output -match 'Check 15: canonical script not found') 'strict without platform root names Check 15'

    # 2. Non-strict + no root => warning only (ad-hoc and single-repo CI runs).
    $result = Invoke-Validator -OmpPlatformRoot $missingRoot -OpenModulePlatformRoot '' -Arguments @{}
    Assert-True ($result.Output -match 'Check 15: NOT VERIFIED') 'non-strict without platform root warns NOT VERIFIED'

    # 3. OMP_PLATFORM_ROOT is honoured and forwarded together with Strict.
    $result = Invoke-Validator -OmpPlatformRoot $passingStub -OpenModulePlatformRoot $missingRoot -Arguments @{ Strict = $true }
    Assert-True ($result.Output -match 'STUB-CHECK15') 'OMP_PLATFORM_ROOT runs the guard'
    Assert-True ($result.Output -match [regex]::Escape("platform=$passingStub strict=True")) 'OMP_PLATFORM_ROOT forwarded with Strict'
    Assert-True ($result.ExitCode -eq 0) 'passing guard via OMP_PLATFORM_ROOT exits 0' "(exit $($result.ExitCode))"

    # 4. OMP_PLATFORM_ROOT wins over OpenModulePlatformRoot.
    $result = Invoke-Validator -OmpPlatformRoot $failingStub -OpenModulePlatformRoot $passingStub -Arguments @{ Strict = $true }
    Assert-True ($result.ExitCode -eq 1) 'OMP_PLATFORM_ROOT precedes OpenModulePlatformRoot (failing guard fails)' "(exit $($result.ExitCode))"
    Assert-True ($result.Output -match 'Check 15 \(shared script drift\) failed') 'failing guard reported as Check 15 failure'

    # 5. OpenModulePlatformRoot is still honoured when OMP_PLATFORM_ROOT is unset.
    $result = Invoke-Validator -OmpPlatformRoot '' -OpenModulePlatformRoot $passingStub -Arguments @{ Strict = $true }
    Assert-True ($result.Output -match [regex]::Escape("platform=$passingStub")) 'OpenModulePlatformRoot fallback runs the guard'

    # 6. -PlatformRepositoryRoot wins over both environment variables.
    $result = Invoke-Validator -OmpPlatformRoot $failingStub -OpenModulePlatformRoot $failingStub -Arguments @{ Strict = $true; PlatformRepositoryRoot = $passingStub }
    Assert-True ($result.Output -match [regex]::Escape("platform=$passingStub")) '-PlatformRepositoryRoot precedes the environment'
    Assert-True ($result.ExitCode -eq 0) '-PlatformRepositoryRoot passing guard exits 0' "(exit $($result.ExitCode))"

    # 7. local-ci.ps1 wiring (static: running the whole gate would build and test).
    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($localCi, [ref]$tokens, [ref]$parseErrors)
    Assert-True ($parseErrors.Count -eq 0) 'local-ci.ps1 parses'
    $parameterNames = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    Assert-True ($parameterNames -contains 'AllowUnverifiedSharedScripts') 'local-ci.ps1 declares -AllowUnverifiedSharedScripts'
    Assert-True ($parameterNames -contains 'PlatformRepositoryRoot') 'local-ci.ps1 declares -PlatformRepositoryRoot'
    $validatorCalls = @($ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.CommandElements[0].Extent.Text -eq '$Validator'
    }, $true))
    Assert-True ($validatorCalls.Count -eq 1) 'local-ci.ps1 calls the validator once' "(found $($validatorCalls.Count))"
    if ($validatorCalls.Count -eq 1) {
        $callText = $validatorCalls[0].Extent.Text
        Assert-True ($callText -match '-Strict:\(-not \$AllowUnverifiedSharedScripts\)') 'local-ci.ps1 runs the validator strict unless opted out' "($callText)"
        Assert-True ($callText -match '-PlatformRepositoryRoot \$PlatformRepositoryRoot') 'local-ci.ps1 forwards -PlatformRepositoryRoot' "($callText)"
    }

    # 8. Optional end-to-end case against a real OpenModulePlatform checkout.
    $realRoot = $OmpRepositoryRoot
    if ([string]::IsNullOrWhiteSpace($realRoot)) { $realRoot = $env:OMP_PLATFORM_ROOT }
    if ([string]::IsNullOrWhiteSpace($realRoot)) { $realRoot = Join-Path (Join-Path $repositoryRoot '..') 'OpenModulePlatform' }
    $realGuard = Join-Path $realRoot (Join-Path 'scripts' (Join-Path 'omp' 'validate-shared-scripts.ps1'))
    if (Test-Path -LiteralPath $realGuard -PathType Leaf) {
        $result = Invoke-Validator -OmpPlatformRoot $realRoot -OpenModulePlatformRoot '' -Arguments @{ Strict = $true }
        Assert-True ($result.Output -notmatch 'Check 15: canonical script not found' -and $result.Output -notmatch 'NOT VERIFIED') 'real platform checkout: comparison runs'
        Assert-True ($result.Output -match 'canonical') 'real platform checkout: guard reports its comparison'
    }
    else {
        Write-Host "SKIP: real platform checkout case (no validate-shared-scripts.ps1 under '$realRoot')" -ForegroundColor Yellow
    }
}
finally {
    Remove-Item -LiteralPath $passingStub -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $failingStub -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($failures.Count -gt 0) {
    Write-Host "$($failures.Count) check(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host 'All Check 15 wiring checks passed.' -ForegroundColor Green
exit 0
