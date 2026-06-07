<#
.SYNOPSIS
Validates OMP repository command wrappers with per-repository timeouts.

.DESCRIPTION
Runs build-universal-package.cmd in non-interactive mode for one or more
OMP-compatible repositories. Each repository is executed in its own process with
stdout and stderr redirected to log files. If a repository exceeds the timeout,
the whole command process tree is terminated with taskkill so validation cannot
hang indefinitely.

The timeout is measured by WaitForExit after the child process has been started.
WaitForExit returns true when the process exits within that interval and false
when the timeout expires. On timeout, the script attempts to terminate the whole
cmd.exe process tree and avoids reading ExitCode until the process has exited.
#>
[CmdletBinding()]
param(
    [string]$WorkspaceRoot = '',
    [string[]]$RepositoryName = @(),
    [string]$OutputRoot = '',
    [string]$LogRoot = '',
    [ValidateRange(60, 86400)]
    [int]$PerRepositoryTimeoutSeconds = 1200
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PostTerminationWaitMilliseconds = 10000

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

function Resolve-FullDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = if ([System.IO.Path]::IsPathRooted($Path)) {
        [System.IO.Path]::GetFullPath($Path)
    }
    else {
        [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
    }

    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw "Directory not found: $resolved"
    }

    return $resolved
}

function Get-SafeFileName {
    param([Parameter(Mandatory = $true)][string]$Value)

    $safe = $Value -replace '[^A-Za-z0-9._-]+', '-'
    $safe = $safe.Trim('-')
    if ([string]::IsNullOrWhiteSpace($safe)) {
        return 'repository'
    }

    return $safe
}

function ConvertTo-CmdArgument {
    param([Parameter(Mandatory = $true)][string]$Value)

    # This helper only supports the argument shapes generated below; reject
    # characters that cmd.exe can reinterpret instead of attempting lossy escaping.
    if ($Value.Contains('"')) {
        throw "CMD wrapper arguments cannot contain double quotes: $Value"
    }

    if ($Value.Contains('%')) {
        throw "CMD wrapper arguments cannot contain percent signs because cmd.exe expands environment variables: $Value"
    }

    $escaped = $Value.Replace('^', '^^')
    if ($escaped -notmatch '[\s&|<>]') {
        return $escaped
    }

    return '"' + $escaped + '"'
}

function Join-CmdCommandLine {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    return ($Arguments | ForEach-Object { ConvertTo-CmdArgument -Value $_ }) -join ' '
}

function Get-ProcessExitCodeOrNull {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    try {
        if ($Process.HasExited) {
            return $Process.ExitCode
        }
    }
    catch [System.InvalidOperationException] {
        return $null
    }

    return $null
}

$scriptDirectory = Get-ScriptDirectory
$currentRepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory '..\..'))

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
    $WorkspaceRoot = Split-Path -Parent $currentRepositoryRoot
}

$workspaceRootPath = Resolve-FullDirectory -Path $WorkspaceRoot

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'omp-cmd-wrapper-validation\packages'
}

if ([string]::IsNullOrWhiteSpace($LogRoot)) {
    $LogRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'omp-cmd-wrapper-validation\logs'
}

$outputRootPath = [System.IO.Path]::GetFullPath($OutputRoot)
$logRootPath = [System.IO.Path]::GetFullPath($LogRoot)
[System.IO.Directory]::CreateDirectory($outputRootPath) | Out-Null
[System.IO.Directory]::CreateDirectory($logRootPath) | Out-Null

if ($RepositoryName.Count -gt 0) {
    $repositories = foreach ($name in $RepositoryName) {
        $candidate = Join-Path $workspaceRootPath $name
        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
            throw "Repository directory not found: $candidate"
        }

        Get-Item -LiteralPath $candidate
    }
}
else {
    $repositories = Get-ChildItem -LiteralPath $workspaceRootPath -Directory |
        Where-Object {
            (Test-Path -LiteralPath (Join-Path $_.FullName 'omp-components.json') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName 'scripts\omp\build-universal-package.cmd') -PathType Leaf)
        } |
        Sort-Object Name
}

if (@($repositories).Count -eq 0) {
    throw "No OMP-compatible repositories found below $workspaceRootPath."
}

$timeoutMilliseconds64 = ([int64]$PerRepositoryTimeoutSeconds) * 1000L
$timeoutMilliseconds = if ($timeoutMilliseconds64 -gt [int]::MaxValue) {
    [int]::MaxValue
}
else {
    [int]$timeoutMilliseconds64
}
$results = [System.Collections.Generic.List[object]]::new()

foreach ($repository in $repositories) {
    $repoDisplayName = $repository.Name
    $manifestPath = Join-Path $repository.FullName 'omp-components.json'
    $cmdPath = Join-Path $repository.FullName 'scripts\omp\build-universal-package.cmd'

    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Component manifest not found: $manifestPath"
    }

    if (-not (Test-Path -LiteralPath $cmdPath -PathType Leaf)) {
        throw "Command wrapper not found: $cmdPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $packageKey = [string]$manifest.repositoryKey
    $packageVersion = [string]$manifest.repositoryVersion
    if ([string]::IsNullOrWhiteSpace($packageKey) -or [string]::IsNullOrWhiteSpace($packageVersion)) {
        throw "Manifest must contain repositoryKey and repositoryVersion: $manifestPath"
    }

    $expectedPackagePath = Join-Path $outputRootPath ('{0}__global__{1}.zip' -f $packageKey, $packageVersion)
    if (Test-Path -LiteralPath $expectedPackagePath -PathType Leaf) {
        Remove-Item -LiteralPath $expectedPackagePath -Force
    }

    $safeName = Get-SafeFileName -Value $repoDisplayName
    $stdoutPath = Join-Path $logRootPath "$safeName.stdout.log"
    $stderrPath = Join-Path $logRootPath "$safeName.stderr.log"
    Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue

    Write-Host "[$repoDisplayName] Running build-universal-package.cmd with a $PerRepositoryTimeoutSeconds second timeout..."

    $cmdInvocation = 'call ' + (Join-CmdCommandLine -Arguments @($cmdPath, '--no-pause', '-OutputDirectory', $outputRootPath))
    $cmdArguments = @('/d', '/c', $cmdInvocation)
    $process = Start-Process -FilePath $env:ComSpec `
        -ArgumentList $cmdArguments `
        -WorkingDirectory $repository.FullName `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    $exitedWithinTimeout = $process.WaitForExit($timeoutMilliseconds)
    $timedOut = -not $exitedWithinTimeout
    if ($timedOut) {
        Write-Warning "[$repoDisplayName] Timeout reached. Terminating process tree for PID $($process.Id)."
        if ($process.HasExited) {
            Write-Warning "[$repoDisplayName] Process exited after the timeout was detected; taskkill was not needed."
        }
        else {
            try {
                $taskKillOutput = & taskkill.exe /PID $process.Id /T /F 2>&1
                $taskKillExitCode = $LASTEXITCODE
            }
            catch {
                $taskKillOutput = @($_.Exception.Message)
                $taskKillExitCode = -1
            }

            if ($taskKillExitCode -ne 0) {
                $taskKillOutputText = ($taskKillOutput | Out-String).Trim()
                Write-Warning "[$repoDisplayName] taskkill failed with exit code $taskKillExitCode. The process may have already terminated. Output:`n$taskKillOutputText"
            }

            if (-not $process.WaitForExit($PostTerminationWaitMilliseconds)) {
                Write-Warning "[$repoDisplayName] Process did not report exit within $($PostTerminationWaitMilliseconds / 1000) seconds after taskkill."
            }
        }
    }

    $exitCode = Get-ProcessExitCodeOrNull -Process $process
    $packageExists = Test-Path -LiteralPath $expectedPackagePath -PathType Leaf
    $packageLength = if ($packageExists) { (Get-Item -LiteralPath $expectedPackagePath).Length } else { 0L }
    $status = if ($timedOut) {
        'Timeout'
    }
    elseif ($exitCode -ne 0) {
        'Failed'
    }
    elseif (-not $packageExists -or $packageLength -le 0) {
        'Missing package'
    }
    else {
        'OK'
    }

    $results.Add([pscustomobject]@{
        Repository = $repoDisplayName
        Status = $status
        ExitCode = $exitCode
        Package = $expectedPackagePath
        StdoutLog = $stdoutPath
        StderrLog = $stderrPath
    })

    Write-Host "[$repoDisplayName] $status"
}

$results | Format-Table Repository, Status, ExitCode, Package -AutoSize

if (@($results | Where-Object { $_.Status -ne 'OK' }).Count -gt 0) {
    exit 1
}
