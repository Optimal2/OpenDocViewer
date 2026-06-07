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
    [int]$PerRepositoryTimeoutSeconds = 1200
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$MinimumTimeoutSeconds = 60
$MaximumTimeoutSeconds = 3600
$MillisecondsPerSecond = 1000
$ManifestRelativePath = 'omp-components.json'
$CommandWrapperRelativePath = 'scripts\omp\build-universal-package.cmd'
$SafeFileNamePattern = '[^A-Za-z0-9._-]+'
$PackageIdentityPattern = '^[A-Za-z0-9._+-]+$'
$GlobalPackageFileSegment = '__global__'
# 22 bytes is the smallest structurally valid empty ZIP file. OMP universal
# packages must contain a manifest and object payload, so useful output must be
# larger than this marker.
$MinimumZipFileLengthBytes = 22

# Give taskkill a short grace period to tear down child processes and flush
# redirected streams without letting a stuck validation run hang indefinitely.
$PostTerminationWaitMilliseconds = 10 * $MillisecondsPerSecond
# taskkill.exe uses normal process exit codes. -1 is reserved here to mean that
# PowerShell could not start or observe taskkill.exe itself.
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

function Test-IsSubPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $fullBasePath = [System.IO.Path]::GetFullPath($BasePath).TrimEnd('\', '/')
    return $fullPath.Equals($fullBasePath, [StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullBasePath + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullBasePath + [System.IO.Path]::AltDirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Get-ShortStableHash {
    param([Parameter(Mandatory = $true)][string]$Value)

    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    return $hash.Substring(0, [Math]::Min(8, $hash.Length))
}

function Get-SafeFileName {
    param([Parameter(Mandatory = $true)][string]$Value)

    # Keep log filenames portable across Windows shells and filesystems.
    $safe = $Value -replace $SafeFileNamePattern, '-'
    $safe = $safe.Trim('-')
    if ([string]::IsNullOrWhiteSpace($safe)) {
        return 'repository'
    }

    return $safe
}

function Assert-SafeCmdArgumentText {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    if ($Value.Contains('"')) {
        throw "$Name cannot contain double quotes when it is passed through cmd.exe: $Value"
    }

    if ($Value.Contains('%')) {
        throw "$Name cannot contain percent signs; cmd.exe expands environment variables even within quoted strings: $Value"
    }

    if ($Value -match '[\x00-\x1F\x7F]') {
        throw "$Name cannot contain control characters when it is passed through cmd.exe: $Value"
    }
}

function ConvertTo-CmdArgument {
    param([Parameter(Mandatory = $true)][string]$Value)

    # This helper only supports the argument shapes generated below; reject
    # characters that cmd.exe can reinterpret instead of attempting lossy escaping.
    Assert-SafeCmdArgumentText -Name 'CMD wrapper argument' -Value $Value

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

function Resolve-CmdExePath {
    $systemRoot = $env:SystemRoot
    if (-not [string]::IsNullOrWhiteSpace($systemRoot)) {
        $systemCmd = Join-Path $systemRoot 'System32\cmd.exe'
        if (Test-Path -LiteralPath $systemCmd -PathType Leaf) {
            return [System.IO.Path]::GetFullPath($systemCmd)
        }
    }

    $candidate = $env:ComSpec
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw 'Could not locate cmd.exe because SystemRoot/System32/cmd.exe was missing and ComSpec was empty.'
    }

    $candidate = [System.IO.Path]::GetFullPath($candidate)
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "ComSpec points to a missing executable: $candidate"
    }

    if ([System.IO.Path]::GetFileName($candidate) -ine 'cmd.exe') {
        throw "ComSpec must point to cmd.exe for wrapper validation. Actual value: $candidate"
    }

    return $candidate
}

function Get-ProcessExitCodeOrNull {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    try {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            # This is expected after a timeout if Windows has not finished
            # terminating the process tree yet; it is not treated as an error.
            return $null
        }

        return $Process.ExitCode
    }
    catch [System.InvalidOperationException] {
        Write-Verbose "Process state was unavailable while reading ExitCode. The process may still be running or may have already been disposed."
        return $null
    }
    catch {
        Write-Verbose "Could not read process state: $($_.Exception.Message)"
        return $null
    }
}

function Get-ValidProcessIdOrNull {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    try {
        $id = $Process.Id
    }
    catch {
        Write-Verbose "Could not read process ID: $($_.Exception.Message)"
        return $null
    }

    if ($null -eq $id -or $id -lt 1) {
        return $null
    }

    return [int]$id
}

function Test-ExpectedCmdProcess {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    try {
        $Process.Refresh()
        return $Process.ProcessName.Equals('cmd', [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        Write-Verbose "Could not verify process name before taskkill: $($_.Exception.Message)"
        return $false
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
    return $null
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

        if ($item -isnot [System.IO.FileInfo]) {
            return [pscustomobject]@{
                Exists = $false
                IsValid = $false
                Length = 0L
                Message = "Package path is not a file: $Path"
            }
        }

        $length = [int64]$item.Length
        $hasMeaningfulPayload = $length -gt $MinimumZipFileLengthBytes
        return [pscustomobject]@{
            Exists = $true
            IsValid = $hasMeaningfulPayload
            Length = $length
            Message = if ($hasMeaningfulPayload) {
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

function Assert-SafePackageIdentityPart {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$ManifestPath
    )

    if ($Value -notmatch $PackageIdentityPattern) {
        throw "Manifest field '$Name' contains characters that are unsafe for package filenames. Allowed characters are letters, digits, dot, underscore, hyphen, plus. Manifest: $ManifestPath"
    }
}

$scriptDirectory = Get-ScriptDirectory
# This script is intentionally kept in scripts/omp, so ..\.. is the repository
# root for every OMP-compatible repository that carries the shared wrappers.
$currentRepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory '..\..'))

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
    $WorkspaceRoot = Split-Path -Parent $currentRepositoryRoot
}

$workspaceRootPath = Resolve-FullDirectory -Path $WorkspaceRoot

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    # On normal Windows developer machines and GitHub runners, GetTempPath()
    # resolves to a user-specific temp folder. Pass -OutputRoot explicitly when
    # validating packages that should not be written to temp storage.
    $OutputRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'omp-cmd-wrapper-validation\packages'
}

if ([string]::IsNullOrWhiteSpace($LogRoot)) {
    $LogRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'omp-cmd-wrapper-validation\logs'
}

$outputRootPath = [System.IO.Path]::GetFullPath($OutputRoot)
$logRootPath = [System.IO.Path]::GetFullPath($LogRoot)
Assert-SafeCmdArgumentText -Name 'OutputRoot' -Value $outputRootPath
Assert-SafeCmdArgumentText -Name 'LogRoot' -Value $logRootPath
[System.IO.Directory]::CreateDirectory($outputRootPath) | Out-Null
[System.IO.Directory]::CreateDirectory($logRootPath) | Out-Null
$cmdExePath = Resolve-CmdExePath
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (@($RepositoryName).Count -gt 0) {
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
            (Test-Path -LiteralPath (Join-Path $_.FullName $ManifestRelativePath) -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName $CommandWrapperRelativePath) -PathType Leaf)
        } |
        Sort-Object Name
}

if ($null -eq $repositories -or @($repositories).Count -eq 0) {
    throw "No OMP-compatible repositories found below $workspaceRootPath."
}

if ($PerRepositoryTimeoutSeconds -lt $MinimumTimeoutSeconds -or $PerRepositoryTimeoutSeconds -gt $MaximumTimeoutSeconds) {
    throw "PerRepositoryTimeoutSeconds must be between $MinimumTimeoutSeconds and $MaximumTimeoutSeconds seconds."
}

# WaitForExit expects a 32-bit millisecond value. The timeout bounds above keep
# this conversion well below Int32.MaxValue.
$timeoutMilliseconds = [int](([int64]$PerRepositoryTimeoutSeconds) * $MillisecondsPerSecond)
# Validation results are assembled as PSCustomObjects in several branches; a
# generic object list keeps append behavior efficient without defining a custom
# class for this script-only report.
$results = [System.Collections.Generic.List[object]]::new()

foreach ($repository in $repositories) {
    $repoDisplayName = $repository.Name
    $manifestPath = Join-Path $repository.FullName $ManifestRelativePath
    $cmdPath = Join-Path $repository.FullName $CommandWrapperRelativePath

    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Component manifest not found: $manifestPath"
    }

    if (-not (Test-Path -LiteralPath $cmdPath -PathType Leaf)) {
        throw "Command wrapper not found: $cmdPath"
    }

    if (-not (Test-IsSubPath -Path $repository.FullName -BasePath $workspaceRootPath)) {
        throw "Repository path must stay within the workspace root. Repository: $($repository.FullName). Workspace: $workspaceRootPath"
    }

    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "Could not parse component manifest JSON '$manifestPath': $($_.Exception.Message)"
    }

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

    Assert-SafePackageIdentityPart -Name 'repositoryKey' -Value $packageKey -ManifestPath $manifestPath
    Assert-SafePackageIdentityPart -Name 'repositoryVersion' -Value $packageVersion -ManifestPath $manifestPath

    # build-universal-package.cmd creates the repository's global package by
    # default, and global packages use the same __global__ naming convention as
    # export-universal-package.ps1.
    $expectedPackagePath = Join-Path $outputRootPath ('{0}{1}{2}.zip' -f $packageKey, $GlobalPackageFileSegment, $packageVersion)
    if (Test-Path -LiteralPath $expectedPackagePath -PathType Leaf) {
        Remove-Item -LiteralPath $expectedPackagePath -Force
    }

    $safeName = '{0}-{1}-{2}' -f (Get-SafeFileName -Value $repoDisplayName), (Get-ShortStableHash -Value $repository.FullName), $runStamp
    $stdoutPath = Join-Path $logRootPath "$safeName.stdout.log"
    $stderrPath = Join-Path $logRootPath "$safeName.stderr.log"

    Write-Host "[$repoDisplayName] Running build-universal-package.cmd with a $PerRepositoryTimeoutSeconds second timeout..."

    # --no-pause is a CMD-wrapper flag; the wrapper removes it before invoking
    # the underlying PowerShell script. call ensures the invoked .cmd file
    # returns control to this cmd.exe instance when it is run through /c.
    $cmdInvocation = 'call {0}' -f (Join-CmdCommandLine -Arguments @($cmdPath, '--no-pause', '-OutputDirectory', $outputRootPath))
    # /d disables cmd.exe AutoRun hooks and /c runs the wrapper then exits.
    $cmdArguments = @('/d', '/c', $cmdInvocation)
    $process = $null
    try {
        # -WindowStyle Hidden keeps validation non-interactive. -NoNewWindow is
        # intentionally not used because this script redirects stdout/stderr to
        # files and should not attach child command windows to the caller.
        if (-not (Test-IsSubPath -Path $repository.FullName -BasePath $workspaceRootPath)) {
            throw "Repository path must stay within the workspace root immediately before command execution. Repository: $($repository.FullName). Workspace: $workspaceRootPath"
        }

        $process = Start-Process -FilePath $cmdExePath `
            -ArgumentList $cmdArguments `
            -WorkingDirectory $repository.FullName `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -WindowStyle Hidden `
            -PassThru
    }
    catch {
        $startError = $_.Exception.ToString()
        Write-Warning "[$repoDisplayName] Failed to start CMD wrapper: $startError"
        $results.Add([pscustomobject]@{
            Repository = $repoDisplayName
            Status = 'Start failed'
            ExitCode = $null
            Package = $expectedPackagePath
            StdoutLog = $stdoutPath
            StderrLog = $stderrPath
            Detail = $startError
        })
        continue
    }

    try {
        $exitedWithinTimeout = $process.WaitForExit($timeoutMilliseconds)
        if ($exitedWithinTimeout) {
            # The timed overload observes process exit; the parameterless overload
            # then blocks until redirected stdout/stderr finish flushing before
            # status checks inspect logs and package output.
            $process.WaitForExit()
        }

        $timedOut = -not $exitedWithinTimeout
        if ($timedOut) {
            $processId = Get-ValidProcessIdOrNull -Process $process
            $processIdText = if ($null -eq $processId) { '<unknown>' } else { [string]$processId }
            Write-Warning "[$repoDisplayName] Timeout reached after $PerRepositoryTimeoutSeconds second(s). Terminating process tree for PID $processIdText."
            $process.Refresh()
            if ($process.HasExited) {
                Write-Warning "[$repoDisplayName] Process exited after the timeout was detected; taskkill was not needed."
            }
            elseif ($null -eq $processId) {
                Write-Warning "[$repoDisplayName] Process has an invalid or unavailable PID; taskkill was not attempted."
            }
            elseif (-not (Test-ExpectedCmdProcess -Process $process)) {
                Write-Warning "[$repoDisplayName] Timed-out process is no longer the expected cmd.exe instance; taskkill was not attempted."
            }
            else {
                try {
                    $process.Refresh()
                    if ($process.HasExited) {
                        Write-Warning "[$repoDisplayName] Process exited immediately before taskkill; termination was not needed."
                        $taskKillOutput = @()
                        $taskKillExitCode = 0
                    }
                    else {
                        # The Process object keeps a handle to the child cmd.exe
                        # and HasExited/ProcessName are checked immediately
                        # before taskkill, so PID reuse is not expected in normal
                        # Windows process lifetime semantics.
                        $LASTEXITCODE = 0
                        $taskKillOutput = & taskkill.exe /PID $processId /T /F 2>&1
                        $taskKillExitCode = [int]$LASTEXITCODE
                    }
                }
                catch {
                    $taskKillOutput = @($_.Exception.ToString())
                    $taskKillExitCode = $TaskKillExecutionExceptionExitCode
                }

                if ($taskKillExitCode -ne 0) {
                    Write-TaskKillFailureWarning -RepositoryName $repoDisplayName -ExitCode $taskKillExitCode -Output @($taskKillOutput)
                }

                $process.Refresh()
                if ($process.HasExited) {
                    Write-Verbose "[$repoDisplayName] Process exited after termination attempt."
                }
                elseif (-not $process.WaitForExit($PostTerminationWaitMilliseconds)) {
                    $postTerminationWaitSeconds = [Math]::Round($PostTerminationWaitMilliseconds / $MillisecondsPerSecond, 2)
                    Write-Warning "[$repoDisplayName] Process did not exit within $postTerminationWaitSeconds seconds after termination attempt; exit code may be unavailable."
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
            Detail = $packageValidation.Message
        })

        Write-Host "[$repoDisplayName] $status"
    }
    finally {
        if ($null -ne $process) {
            $process.Dispose()
        }
    }
}

$results | Format-Table Repository, Status, ExitCode, Package -AutoSize

if ($results | Where-Object { $_.Status -ne 'OK' } | Select-Object -First 1) {
    # Keep one generic failure exit code for compatibility with existing
    # callers; individual failure categories are reported in the table above.
    exit 1
}
