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
    # 60 seconds catches accidental tiny values; 3600 seconds prevents a hung
    # wrapper validation from consuming an entire workday.
    [ValidateRange(60, 3600)]
    [int]$PerRepositoryTimeoutSeconds = 1200
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$SafeFileNamePattern = '[^A-Za-z0-9._-]+'
$MinimumZipFileLengthBytes = 22

# Give taskkill a short grace period to tear down child processes and flush
# redirected streams without letting a stuck validation run hang indefinitely.
$PostTerminationWaitMilliseconds = 10000
$PostTerminationWaitSeconds = [int]($PostTerminationWaitMilliseconds / 1000)
$TaskKillExecutionExceptionExitCode = -1

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

    # Keep log filenames portable across Windows shells and filesystems.
    $safe = $Value -replace $SafeFileNamePattern, '-'
    $safe = $safe.Trim('-')
    if ([string]::IsNullOrWhiteSpace($safe)) {
        return 'repository-{0}' -f [Guid]::NewGuid().ToString('N').Substring(0, 8)
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

    # cmd.exe treats ^ as its escape character, so double carets when the
    # generated command line needs a literal caret.
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
        $Process.Refresh()
        if ($Process.HasExited) {
            return $Process.ExitCode
        }
    }
    catch [System.InvalidOperationException] {
        return $null
    }
}

function Write-TaskKillFailureWarning {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryName,
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [object[]]$Output = @()
    )

    $taskKillOutputText = ($Output | Out-String).Trim()
    if ($ExitCode -eq $TaskKillExecutionExceptionExitCode) {
        Write-Warning "[$RepositoryName] taskkill could not be started. Output:`n$taskKillOutputText"
        return
    }

    Write-Warning "[$RepositoryName] taskkill failed with exit code $ExitCode. The process may have already terminated. Output:`n$taskKillOutputText"
}

function Test-PackageCreated {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
        if ($null -eq $item) {
            return [pscustomobject]@{
                Exists = $false
                IsValid = $false
                Length = 0L
                Message = 'Package file was not created.'
            }
        }

        $length = [int64]$item.Length
        return [pscustomobject]@{
            Exists = $true
            IsValid = $length -gt $MinimumZipFileLengthBytes
            Length = $length
            Message = if ($length -gt $MinimumZipFileLengthBytes) {
                'Package file exists and has meaningful zip content.'
            }
            else {
                "Package file is too small to contain a meaningful zip payload. Minimum expected size is greater than $MinimumZipFileLengthBytes bytes."
            }
        }
    }
    catch {
        return [pscustomobject]@{
            Exists = $false
            IsValid = $false
            Length = 0L
            Message = "Could not inspect package file: $($_.Exception.Message)"
        }
    }
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

# WaitForExit expects a 32-bit millisecond value. The ValidateRange above keeps
# this conversion safely below Int32.MaxValue.
$timeoutMilliseconds = $PerRepositoryTimeoutSeconds * 1000
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
        $missingFields = [System.Collections.Generic.List[string]]::new()
        if ([string]::IsNullOrWhiteSpace($packageKey)) {
            $missingFields.Add('repositoryKey')
        }

        if ([string]::IsNullOrWhiteSpace($packageVersion)) {
            $missingFields.Add('repositoryVersion')
        }

        throw "Manifest must contain non-empty repositoryKey and repositoryVersion. Missing: $($missingFields -join ', '). Manifest: $manifestPath"
    }

    # build-universal-package.cmd creates the repository's global package by
    # default, and global packages use the same __global__ naming convention as
    # export-universal-package.ps1.
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

    # --no-pause is a CMD-wrapper flag; the wrapper removes it before invoking
    # the underlying PowerShell script.
    $cmdInvocation = 'call {0}' -f (Join-CmdCommandLine -Arguments @($cmdPath, '--no-pause', '-OutputDirectory', $outputRootPath))
    # /d disables cmd.exe AutoRun hooks and /c runs the wrapper then exits.
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
        Write-Warning "[$repoDisplayName] Timeout reached after $PerRepositoryTimeoutSeconds second(s). Terminating process tree for PID $($process.Id)."
        $process.Refresh()
        if ($process.HasExited) {
            Write-Warning "[$repoDisplayName] Process exited after the timeout was detected; taskkill was not needed."
        }
        elseif ($process.Id -le 0) {
            Write-Warning "[$repoDisplayName] Process has an invalid PID '$($process.Id)'; taskkill was not attempted."
        }
        else {
            try {
                $taskKillOutput = & taskkill.exe /PID $process.Id /T /F 2>&1
                $taskKillExitCode = $LASTEXITCODE
            }
            catch {
                $taskKillOutput = @($_.Exception.Message)
                $taskKillExitCode = $TaskKillExecutionExceptionExitCode
            }

            if ($taskKillExitCode -ne 0) {
                Write-TaskKillFailureWarning -RepositoryName $repoDisplayName -ExitCode $taskKillExitCode -Output @($taskKillOutput)
            }

            if (-not $process.WaitForExit($PostTerminationWaitMilliseconds)) {
                Write-Warning "[$repoDisplayName] Process did not report exit within $PostTerminationWaitSeconds seconds after taskkill; exit code will be reported as null if the process is still running."
            }
        }
    }

    $exitCode = Get-ProcessExitCodeOrNull -Process $process
    $packageValidation = Test-PackageCreated -Path $expectedPackagePath
    $status = if ($timedOut) {
        'Timeout'
    }
    elseif ($null -eq $exitCode) {
        'No exit code'
    }
    elseif ($exitCode -ne 0) {
        'Failed'
    }
    elseif (-not $packageValidation.Exists) {
        'Missing package'
    }
    elseif (-not $packageValidation.IsValid) {
        'Invalid package'
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
