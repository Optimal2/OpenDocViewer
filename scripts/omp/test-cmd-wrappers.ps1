<#
.SYNOPSIS
Validates OpenModulePlatform (OMP) repository command wrappers with configurable per-repository timeouts.

.DESCRIPTION
Runs the wrapper specified by -CommandWrapperRelativePath in non-interactive mode
for one or more OMP-compatible repositories. The default wrapper is
scripts/omp/build-universal-package.cmd. Each repository is executed in its own
process with stdout and stderr redirected to log files. If a repository exceeds
the timeout, the whole command process tree is terminated with taskkill so
validation cannot hang indefinitely.

The script is expected to live in scripts/omp. Startup validates that ..\..
resolves to a repository root that contains omp-components.json, so the wrapper
fails loudly if it is moved without updating this assumption.

The timeout is measured by WaitForExit after the child process has been started.
WaitForExit returns true when the process exits within that interval and false
when the timeout expires. On timeout, the script attempts to terminate the whole
cmd.exe process tree and avoids reading ExitCode until the process has exited.

.PARAMETER WorkspaceRoot
Workspace that contains the OMP-compatible repository folders. Defaults to the
immediate parent folder of the repository that contains this script.

.PARAMETER RepositoryName
Optional repository folder names to validate. When omitted, sibling folders are
discovered only when they contain both the manifest and command wrapper paths.

.PARAMETER ManifestRelativePath
Manifest path inside each repository. Defaults to omp-components.json.

.PARAMETER CommandWrapperRelativePath
Command wrapper path inside each repository. Defaults to
scripts/omp/build-universal-package.cmd.

.PARAMETER OutputRoot
Directory where generated universal packages are written during validation.
Defaults to a user-temp validation folder.

.PARAMETER LogRoot
Directory where stdout/stderr logs are written. Use a user-private or
ACL-protected location when logs may contain sensitive diagnostics.

.PARAMETER PerRepositoryTimeoutSeconds
Maximum build time per repository. The accepted range is 60 to 3600 seconds;
the default is 1200 seconds (20 minutes).
#>
[CmdletBinding()]
param(
    [string]$WorkspaceRoot = '',
    [string[]]$RepositoryName = @(),
    [string]$ManifestRelativePath = 'omp-components.json',
    [string]$CommandWrapperRelativePath = 'scripts/omp/build-universal-package.cmd',
    [string]$OutputRoot = '',
    [string]$LogRoot = '',
    # The default gives ordinary repository builds 1200 seconds (20 minutes).
    # Larger package builds can opt into any value from 60 to 3600 seconds (1 hour).
    # Allow at least 60 seconds for minimal build work, and cap at 1 hour so
    # CI/manual validation cannot hang indefinitely.
    # ValidateRange requires literal values in a script parameter block. The
    # mirrored constants below deliberately document the same limits for runtime
    # diagnostics; update both places together if this range changes.
    [ValidateRange(60, 3600)]
    [int]$PerRepositoryTimeoutSeconds = 1200
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$SafeFileNamePattern = '[^A-Za-z0-9._\-]+'
$PackageIdentityPattern = '^[A-Za-z0-9._+\-]+$'
# Delimiter between repositoryKey and repositoryVersion in
# repositoryKey__global__repositoryVersion.zip.
$GlobalPackageFileDelimiter = '__global__'
$ValidationDirectoryName = 'omp-cmd-wrapper-validation'
# 16 hex characters from SHA256 gives 64 bits of stable filename entropy.
$HashPrefixLength = 16
# Only reject impossible child-process IDs. Windows reserves some low PIDs for
# system processes, but this script starts cmd.exe itself and only needs to
# prevent invalid zero/negative IDs from reaching taskkill.exe.
$MinimumValidProcessId = 1
# ASCII control characters: NUL through US (Unit Separator), including all
# whitespace controls such as TAB, vertical tab, form feed, CR, and LF, plus DEL.
$ControlCharacterPattern = '[\x00-\x1F\x7F]'
# Whitespace and these cmd.exe metacharacters can change command parsing unless
# the generated argument is quoted.
$CmdArgumentNeedsQuotingPattern = '[\s&|<>()^,;=]'
# Windows cmd.exe accepts at most 8191 characters in a command line. Keep this
# guard because the wrapper path plus output directory is assembled as one
# cmd.exe /c command.
$MaximumCmdCommandLineLength = 8191
# 22 bytes is the smallest structurally valid empty ZIP file. OMP universal
# packages must contain at least the package manifest and object payload, so a
# useful package must be larger than the empty-archive end-of-central-directory
# marker.
$MinimumMeaningfulZipFileLengthBytes = 22
# Keep diagnostics short enough for CI tables and warnings while still showing
# enough context to identify the bad value.
$MaximumDiagnosticTextLength = 160
# Documentation mirrors for the literal ValidateRange bounds in the parameter
# block above. PowerShell attributes cannot reference variables from the script
# body, so the attribute remains the source of truth for parameter binding.
$MinimumTimeoutSeconds = 60
$MaximumTimeoutSeconds = 3600
$MillisecondsPerSecond = [int64]1000
$Sha256HexLength = 64
$RepositoryRootRelativePath = '..\..'
# Store the millisecond limit separately because WaitForExit accepts an [int]
# millisecond value, while user-facing validation and diagnostics use seconds.
$MaximumWaitForExitMilliseconds = [int]::MaxValue
# PowerShell division returns a floating-point value even for integer inputs, so
# Floor keeps this as the largest whole number of seconds accepted by
# WaitForExit's millisecond API.
$MaximumWaitForExitSeconds = [int][Math]::Floor($MaximumWaitForExitMilliseconds / $MillisecondsPerSecond)

# Script-scoped second values are retained for human-readable diagnostics;
# helper functions intentionally read them from script scope after they are
# converted to WaitForExit-compatible millisecond values below.
# Ten seconds is long enough for typical Windows process tree cleanup without
# making timeout validation feel stuck when a child process is wedged.
$PostTerminationWaitSeconds = 10
# taskkill.exe should be quick; ten seconds accommodates slow process creation
# on busy runners without letting the wrapper validation hang.
$TaskKillWaitSeconds = 10
# After killing taskkill.exe itself, wait only briefly for redirected streams.
$TaskKillPostTerminationWaitSeconds = 3
# ReadToEndAsync tasks should complete after taskkill.exe exits. Keep a small
# upper bound so diagnostics cannot hang if a redirected stream behaves oddly.
$TaskKillStreamReadWaitSeconds = 3
# Direct Process.Kill() is the last fallback for a stuck cmd.exe process; reuse
# the same ten-second grace period as taskkill-driven termination.
$DirectProcessKillWaitSeconds = 10
# The command output is redirected to files, so only a short final flush wait is
# needed once the process has already exited.
$StreamFlushWaitSeconds = 3
# Keep these timeouts separate even when defaults match: taskkill.exe has its
# own startup/runtime budget, while the target cmd.exe gets a separate grace
# period after taskkill asks Windows to terminate the process tree.
# taskkill.exe uses normal process exit codes. -1 is reserved here to mean that
# PowerShell could not start or observe taskkill.exe itself.
$TaskKillExecutionExceptionExitCode = -1
# Windows can round Process.StartTime differently between the original Process
# handle and a refreshed lookup because process metadata is read from snapshots
# with timer-resolution limits. A small tolerance avoids rejecting the same
# child process because of timestamp precision differences.
$ProcessStartTimeTolerance = [TimeSpan]::FromMilliseconds(100)

function Convert-SecondsToIntMilliseconds {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][int]$Seconds
    )

    # The input is whole seconds, so use integer arithmetic instead of
    # floating-point TimeSpan conversion or banker's rounding.
    if ($Seconds -gt $MaximumWaitForExitSeconds) {
        throw "$Name is too large for WaitForExit: $Seconds seconds. Maximum supported value is $MaximumWaitForExitSeconds seconds."
    }

    $milliseconds = ([int64]$Seconds) * $MillisecondsPerSecond
    return [int]$milliseconds
}

function Get-SafeDiagnosticText {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) {
        return '<null>'
    }

    $safe = $Value -replace $ControlCharacterPattern, '?'
    if ($safe.Length -gt $MaximumDiagnosticTextLength) {
        return $safe.Substring(0, $MaximumDiagnosticTextLength) + '...'
    }

    return $safe
}

function Get-ControlCharacterDiagnostic {
    param([Parameter(Mandatory = $true)][string]$Value)

    foreach ($character in $Value.ToCharArray()) {
        $codePoint = [int][char]$character
        if ($codePoint -le 31 -or $codePoint -eq 127) {
            return ('U+{0:X4}' -f $codePoint)
        }
    }

    return 'unknown control character'
}

try {
    # Keep these conversions explicit instead of looping over variable names:
    # each output variable is consumed by different process-wait branches, and
    # spelling them out makes timeout diagnostics easier to trace.
    $PostTerminationWaitMilliseconds = Convert-SecondsToIntMilliseconds -Name 'PostTerminationWaitSeconds' -Seconds $PostTerminationWaitSeconds
    $TaskKillWaitMilliseconds = Convert-SecondsToIntMilliseconds -Name 'TaskKillWaitSeconds' -Seconds $TaskKillWaitSeconds
    $TaskKillPostTerminationWaitMilliseconds = Convert-SecondsToIntMilliseconds -Name 'TaskKillPostTerminationWaitSeconds' -Seconds $TaskKillPostTerminationWaitSeconds
    $TaskKillStreamReadWaitMilliseconds = Convert-SecondsToIntMilliseconds -Name 'TaskKillStreamReadWaitSeconds' -Seconds $TaskKillStreamReadWaitSeconds
    $DirectProcessKillWaitMilliseconds = Convert-SecondsToIntMilliseconds -Name 'DirectProcessKillWaitSeconds' -Seconds $DirectProcessKillWaitSeconds
    $StreamFlushWaitMilliseconds = Convert-SecondsToIntMilliseconds -Name 'StreamFlushWaitSeconds' -Seconds $StreamFlushWaitSeconds
}
catch {
    throw "Invalid built-in process wait timeout in test-cmd-wrappers.ps1: $($_.Exception.Message)"
}

function Get-ScriptDirectory {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return $PSScriptRoot
    }

    $scriptPath = $PSCommandPath
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        throw 'Could not resolve script directory.'
    }

    return Split-Path -Parent $scriptPath
}

function Resolve-FullPathSafely {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$BasePath = ''
    )

    try {
        # This helper only canonicalizes paths, including rooted paths. It is
        # not a security boundary: callers that accept rooted inputs must still
        # validate the resolved path against the intended workspace/output base
        # with Assert-* helpers before using it.
        if ([System.IO.Path]::IsPathRooted($Path)) {
            return [System.IO.Path]::GetFullPath($Path)
        }

        $effectiveBasePath = if ([string]::IsNullOrWhiteSpace($BasePath)) {
            (Get-Location).ProviderPath
        }
        else {
            $BasePath
        }

        return [System.IO.Path]::GetFullPath((Join-Path $effectiveBasePath $Path))
    }
    catch {
        throw "Could not resolve $Name '$Path' to a full path: $($_.Exception.Message)"
    }
}

function Resolve-FullDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = Resolve-FullPathSafely -Name 'directory path' -Path $Path

    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw "Directory not found: $resolved"
    }

    return $resolved
}

function New-DirectorySafely {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Description
    )

    try {
        [System.IO.Directory]::CreateDirectory($Path) | Out-Null
    }
    catch {
        throw "Could not create $Description '$Path': $($_.Exception.Message)"
    }
}

function Test-IsSubPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    $fullPath = ConvertTo-ComparablePath -Name 'path' -Path $Path
    $fullBasePath = ConvertTo-ComparablePath -Name 'base path' -Path $BasePath
    # ConvertTo-ComparablePath trims trailing separators, so adding exactly one
    # separator here works for both "C:\Root" and "C:\Root\" inputs.
    $fullBasePathWithSeparator = $fullBasePath + [System.IO.Path]::DirectorySeparatorChar
    return $fullPath.Equals($fullBasePath, [StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullBasePathWithSeparator, [StringComparison]::OrdinalIgnoreCase)
}

function Trim-TrailingDirectorySeparators {
    param([Parameter(Mandatory = $true)][string]$Path)

    $trimmed = $Path.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    # Get the root from the original path, not the trimmed path, so drive and
    # UNC roots retain the separator that makes them absolute roots on Windows.
    $root = [System.IO.Path]::GetPathRoot($Path)
    if ([string]::IsNullOrEmpty($root)) {
        return $trimmed
    }

    $trimmedRoot = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if ($trimmed.Equals($trimmedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        # Preserve the trailing separator for roots such as C:\ and \\server\share\
        # because C: has different semantics from C:\ on Windows.
        return $root
    }

    return $trimmed
}

function ConvertTo-ComparablePath {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $fullPath = Trim-TrailingDirectorySeparators -Path (Resolve-FullPathSafely -Name $Name -Path $Path)
    return $fullPath.Replace([System.IO.Path]::AltDirectorySeparatorChar, [System.IO.Path]::DirectorySeparatorChar)
}

function Assert-RepositoryPathUnderWorkspace {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryPath,
        [Parameter(Mandatory = $true)][string]$WorkspaceRootPath
    )

    if (-not (Test-IsSubPath -Path $RepositoryPath -BasePath $WorkspaceRootPath)) {
        throw "Repository path must stay within the workspace root. Repository: $RepositoryPath. Workspace: $WorkspaceRootPath"
    }
}

function Assert-PathUnderBase {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$PathDescription,
        [Parameter(Mandatory = $true)][string]$BaseDescription
    )

    if (-not (Test-IsSubPath -Path $Path -BasePath $BasePath)) {
        throw "$PathDescription must stay within $BaseDescription. Path: $Path. Base: $BasePath"
    }
}

function Get-ShortStableHash {
    param([Parameter(Mandatory = $true)][string]$Value)

    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $sha256 = $null
    try {
        # SHA256 output is standardized; the concrete provider chosen by
        # SHA256.Create() does not affect the resulting bytes.
        $sha256 = [Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha256.ComputeHash($bytes)
    }
    finally {
        if ($null -ne $sha256) {
            $sha256.Dispose()
        }
    }

    # 16 hex characters gives 64 bits of stable filename entropy, which is
    # intentionally more than enough for the small set of sibling repositories.
    # BitConverter is clear enough here; this script hashes only a small set of
    # repository paths, so avoiding Replace() would be a negligible micro-optimization.
    $hashWithSeparators = [BitConverter]::ToString($hashBytes)
    $hash = $hashWithSeparators.Replace('-', '').ToLowerInvariant()
    if ($hash.Length -ne $Sha256HexLength) {
        throw "SHA256 hash output must be exactly $Sha256HexLength hexadecimal characters. Actual length: $($hash.Length)."
    }

    if ($HashPrefixLength -gt $hash.Length) {
        throw "Configured hash prefix length $HashPrefixLength exceeds SHA256 hash length $($hash.Length)."
    }

    return $hash.Substring(0, $HashPrefixLength)
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

    # Newlines are also covered by $ControlCharacterPattern. Keep this branch
    # first so users get a clearer error for the most common control characters.
    if ($Value.Contains("`r") -or $Value.Contains("`n")) {
        throw "$Name cannot contain newline characters when it is passed through cmd.exe: $Value"
    }

    if ($Value -match $ControlCharacterPattern) {
        $controlCharacter = Get-ControlCharacterDiagnostic -Value $Value
        throw "$Name cannot contain control characters ($controlCharacter) when it is passed through cmd.exe: $(Get-SafeDiagnosticText -Value $Value)"
    }
}

function ConvertTo-CmdArgument {
    param([Parameter(Mandatory = $true)][string]$Value)

    # This helper only supports the argument shapes generated below; reject
    # characters that cmd.exe can reinterpret instead of attempting lossy escaping.
    # In particular, double quotes are rejected before quoting; keep that
    # pre-validation if this helper ever gains new callers.
    Assert-SafeCmdArgumentText -Name 'CMD wrapper argument' -Value $Value

    # cmd.exe treats ^ as its escape character; ^^ emits one literal caret.
    # Escape carets before quoting so a literal caret cannot alter parsing of
    # the generated command line.
    $escaped = $Value.Replace('^', '^^')
    if ($escaped -notmatch $CmdArgumentNeedsQuotingPattern) {
        return $escaped
    }

    return '"' + $escaped + '"'
}

function Join-CmdCommandLine {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    return ($Arguments | ForEach-Object { ConvertTo-CmdArgument -Value $_ }) -join ' '
}

function Assert-CmdCommandLineLength {
    param([Parameter(Mandatory = $true)][string]$CommandLine)

    if ($CommandLine.Length -gt $MaximumCmdCommandLineLength) {
        throw "CMD command line is $($CommandLine.Length) characters, which exceeds the Windows cmd.exe limit of $MaximumCmdCommandLineLength characters."
    }
}

function Resolve-CmdExePath {
    $systemRoot = $env:SystemRoot
    if (-not [string]::IsNullOrWhiteSpace($systemRoot)) {
        $system32Path = Join-Path $systemRoot 'System32'
        $systemCmdDiagnosticPath = Join-Path $system32Path 'cmd.exe'
        if (Test-Path -LiteralPath $systemCmdDiagnosticPath -PathType Leaf) {
            return Assert-CmdExecutablePath -Name 'system cmd.exe path' -Path $systemCmdDiagnosticPath
        }
    }
    else {
        $systemCmdDiagnosticPath = '<SystemRoot>\System32\cmd.exe (SystemRoot environment variable was empty)'
    }

    $candidate = $env:ComSpec
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw "Could not locate cmd.exe because '$systemCmdDiagnosticPath' was missing and ComSpec was empty."
    }

    return Assert-CmdExecutablePath -Name 'ComSpec path' -Path $candidate
}

function Assert-CmdExecutablePath {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $candidate = Resolve-FullPathSafely -Name $Name -Path $Path
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "$Name points to a missing executable: $candidate"
    }

    $fileName = [System.IO.Path]::GetFileName($candidate)
    $extension = [System.IO.Path]::GetExtension($candidate)
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals($fileName, 'cmd.exe') -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals($extension, '.exe')) {
        throw "$Name must point to cmd.exe for wrapper validation. Actual value: $candidate"
    }

    return $candidate
}

function Resolve-TaskKillExePath {
    $systemRoot = $env:SystemRoot
    if (-not [string]::IsNullOrWhiteSpace($systemRoot)) {
        $system32Path = Join-Path $systemRoot 'System32'
        $systemTaskKill = Join-Path $system32Path 'taskkill.exe'
        if (Test-Path -LiteralPath $systemTaskKill -PathType Leaf) {
            return Resolve-FullPathSafely -Name 'system taskkill.exe path' -Path $systemTaskKill
        }
    }

    # taskkill.exe is not configurable like ComSpec; when SystemRoot lookup is
    # unavailable, allow normal PATH resolution and surface any launch failure
    # through Invoke-TaskKillTree diagnostics.
    return 'taskkill.exe'
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
        Write-Verbose 'Process has not exited or is no longer accessible while reading ExitCode. This may occur after a timeout before Windows completes process termination.'
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

    # Windows never assigns process ID 0 or negative values to normal child
    # processes; reject them before any taskkill command is assembled.
    if ($id -lt $MinimumValidProcessId) {
        Write-Verbose "Rejected invalid process ID before taskkill: $id"
        return $null
    }

    return [int]$id
}

function Get-ProcessStartTimeOrNull {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    try {
        $Process.Refresh()
        return $Process.StartTime
    }
    catch {
        # StartTime can be unavailable when the process exits between checks or
        # when the caller lacks permission to inspect process metadata.
        Write-Verbose "Could not read process start time: $($_.Exception.Message)"
        return $null
    }
}

function Get-ObjectTypeName {
    param([AllowNull()][object]$Value)

    if ($null -eq $Value) {
        return '<null>'
    }

    try {
        return $Value.GetType().FullName
    }
    catch {
        return '<unknown>'
    }
}

function ConvertTo-TaskKillProcessIdArgument {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    if ($ProcessId -lt $MinimumValidProcessId) {
        throw "Process ID must be positive before it is passed to taskkill.exe: $ProcessId"
    }

    return [string]$ProcessId
}

function Add-TaskOutputOrDiagnostic {
    param(
        [Parameter(Mandatory = $true)][System.Collections.Generic.List[string]]$Output,
        [Parameter(Mandatory = $true)][object]$Task,
        [Parameter(Mandatory = $true)][string]$StreamName
    )

    try {
        # Task.Wait can surface stream read failures as AggregateException; the
        # catch below converts them into diagnostics instead of hiding them. The
        # ReadToEndAsync tasks come from process streams and the wait is bounded,
        # so this path is intentionally synchronous; Windows PowerShell 5.1 has
        # no async/await syntax that would make the call clearer.
        if (-not $Task.Wait($TaskKillStreamReadWaitMilliseconds)) {
            # ReadToEndAsync has no cancellation token in the runtimes this
            # script targets. Leave the task alone after this bounded diagnostic
            # wait; the owning process is already being observed separately.
            $Output.Add("Timed out after $TaskKillStreamReadWaitSeconds seconds while reading taskkill $StreamName.")
            return
        }

        $text = $Task.GetAwaiter().GetResult()
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            $Output.Add($text.Trim())
        }
    }
    catch {
        $Output.Add("Could not read taskkill ${StreamName}: $($_.Exception.Message)")
    }
}

function Invoke-TaskKillTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $processIdArgument = ConvertTo-TaskKillProcessIdArgument -ProcessId $ProcessId
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = Resolve-TaskKillExePath
    # Required for redirected stdout/stderr streams below.
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    # Add arguments one by one: ProcessStartInfo.ArgumentList is not guaranteed
    # to expose AddRange across the Windows PowerShell/.NET versions we support.
    foreach ($argument in @('/PID', $processIdArgument, '/T', '/F')) {
        $startInfo.ArgumentList.Add($argument)
    }

    $taskKillProcess = $null
    try {
        $taskKillProcess = [System.Diagnostics.Process]::Start($startInfo)
        if ($null -eq $taskKillProcess) {
            throw 'Process.Start returned null.'
        }

        # Start both reads before waiting so taskkill cannot block on a full
        # redirected stream buffer.
        $stdoutTask = $taskKillProcess.StandardOutput.ReadToEndAsync()
        $stderrTask = $taskKillProcess.StandardError.ReadToEndAsync()
        $taskKillCompletedWithinTimeout = $taskKillProcess.WaitForExit($TaskKillWaitMilliseconds)
        if (-not $taskKillCompletedWithinTimeout) {
            try {
                Write-Verbose "taskkill.exe exceeded $TaskKillWaitSeconds seconds and is being forcefully terminated; this terminates the helper taskkill.exe process, not the target process tree."
                $taskKillProcess.Kill()
            }
            catch {
                Write-Verbose "Could not terminate stuck taskkill.exe process: $($_.Exception.Message)"
            }

            $output = [System.Collections.Generic.List[string]]::new()
            $output.Add("taskkill.exe did not exit within $TaskKillWaitSeconds seconds.")

            if ($taskKillProcess.WaitForExit($TaskKillPostTerminationWaitMilliseconds)) {
                Add-TaskOutputOrDiagnostic -Output $output -Task $stdoutTask -StreamName 'stdout'
                Add-TaskOutputOrDiagnostic -Output $output -Task $stderrTask -StreamName 'stderr'
            }
            else {
                $output.Add("taskkill.exe did not exit after an additional $TaskKillPostTerminationWaitSeconds seconds termination wait; redirected output was not read.")
            }

            return [pscustomobject]@{
                ExitCode = $TaskKillExecutionExceptionExitCode
                Output = $output.ToArray()
            }
        }

        $output = [System.Collections.Generic.List[string]]::new()
        Add-TaskOutputOrDiagnostic -Output $output -Task $stdoutTask -StreamName 'stdout'
        Add-TaskOutputOrDiagnostic -Output $output -Task $stderrTask -StreamName 'stderr'

        return [pscustomobject]@{
            ExitCode = $taskKillProcess.ExitCode
            Output = $output.ToArray()
        }
    }
    catch {
        return [pscustomobject]@{
            ExitCode = $TaskKillExecutionExceptionExitCode
            Output = @($_.Exception.ToString())
        }
    }
    finally {
        if ($null -ne $taskKillProcess) {
            $taskKillProcess.Dispose()
        }
    }
}

function Test-IsCmdProcessName {
    param([Parameter(Mandatory = $true)][string]$ProcessName)

    return (
        $ProcessName.Equals('cmd', [StringComparison]::OrdinalIgnoreCase) -or
        $ProcessName.Equals('cmd.exe', [StringComparison]::OrdinalIgnoreCase)
    )
}

function Test-ExpectedCmdProcess {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        # Keep this nullable object-shaped parameter because callers pass the
        # optional value returned by Get-ProcessStartTimeOrNull. Non-null values
        # are validated below so callers get a clear diagnostic instead of a
        # parameter-binding failure when process metadata is unavailable.
        [object]$ExpectedStartTime = $null
    )

    try {
        $Process.Refresh()
        $processName = $Process.ProcessName
        # ProcessName normally omits .exe on Windows, but accept both forms to
        # keep the guard clear if the runtime behavior ever changes.
        $isCmdProcess = Test-IsCmdProcessName -ProcessName $processName

        if (-not $isCmdProcess) {
            return $false
        }

        if ($null -eq $ExpectedStartTime) {
            return $true
        }

        if ($ExpectedStartTime -isnot [System.DateTime]) {
            Write-Verbose "Expected process start time should be of type [System.DateTime] but got '$(Get-ObjectTypeName -Value $ExpectedStartTime)'."
            return $false
        }

        $actualStartTime = Get-ProcessStartTimeOrNull -Process $Process
        if ($null -eq $actualStartTime) {
            Write-Verbose 'Could not read process start time before taskkill.'
            return $false
        }

        # TotalMilliseconds is a double; keep that precision for the tolerance
        # comparison instead of rounding to whole milliseconds.
        $startTimeDeltaMs = [Math]::Abs(($actualStartTime - $ExpectedStartTime).TotalMilliseconds)
        if ($startTimeDeltaMs -gt $ProcessStartTimeTolerance.TotalMilliseconds) {
            Write-Verbose "Process start time changed by $startTimeDeltaMs ms, which exceeds the $($ProcessStartTimeTolerance.TotalMilliseconds) ms tolerance."
            return $false
        }

        return $true
    }
    catch {
        Write-Verbose "Could not verify process name before taskkill: $($_.Exception.Message)"
        return $false
    }
}

function Get-ProcessIdentityDiagnostic {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    try {
        $Process.Refresh()
        $processName = $Process.ProcessName
        $processId = Get-ValidProcessIdOrNull -Process $Process
        $startTime = Get-ProcessStartTimeOrNull -Process $Process
        return "Name='$processName'; PID='$processId'; StartTime='$startTime'"
    }
    catch {
        return "Unavailable: $($_.Exception.Message)"
    }
}

function Write-TaskKillFailureWarning {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryName,
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [object[]]$Output = @()
    )

    $taskKillOutputText = ($Output -join [Environment]::NewLine).Trim()
    if ([string]::IsNullOrWhiteSpace($taskKillOutputText)) {
        $taskKillOutputText = '(no output)'
    }

    $taskKillAvailabilityAdvice = 'Verify that taskkill.exe is available and that the caller has permission to inspect or terminate the process tree.'
    if ($ExitCode -eq $TaskKillExecutionExceptionExitCode) {
        Write-Warning "[$RepositoryName] taskkill could not be started. $taskKillAvailabilityAdvice Output:$([Environment]::NewLine)$taskKillOutputText"
        return
    }

    $manualTaskKillAdvice = "If the process is still running, verify it with Task Manager or run 'taskkill /F /PID <PID> /T' manually."
    Write-Warning "[$RepositoryName] taskkill failed with exit code $ExitCode. The process may have already terminated. $taskKillAvailabilityAdvice $manualTaskKillAdvice Output:$([Environment]::NewLine)$taskKillOutputText"
}

function New-ValidationResult {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string]$Status,
        [AllowNull()][object]$ExitCode,
        [Parameter(Mandatory = $true)][string]$Package,
        [Parameter(Mandatory = $true)][string]$StdoutLog,
        [Parameter(Mandatory = $true)][string]$StderrLog,
        [AllowNull()][string]$Detail
    )

    return [pscustomobject]@{
        Repository = $Repository
        Status = $Status
        ExitCode = $ExitCode
        Package = $Package
        StdoutLog = $StdoutLog
        StderrLog = $StderrLog
        Detail = $Detail
    }
}

function Test-PackageCreated {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction Stop

        if ($item -isnot [System.IO.FileInfo]) {
            # A directory or other filesystem object at the expected package
            # path is a failed validation result. The expected package path is
            # always filesystem-backed, not a registry/provider path. Do not
            # read Length here; only FileInfo exposes meaningful package size
            # for the generated ZIP.
            return [pscustomobject]@{
                Exists = $true
                IsValid = $false
                Length = [int64]0
                Message = "Package path is not a file: $Path"
            }
        }

        $length = $item.Length
        $meetsMinimumSizeRequirement = $length -gt $MinimumMeaningfulZipFileLengthBytes
        $message = if ($meetsMinimumSizeRequirement) {
            'Package file exists and has meaningful zip content.'
        }
        else {
            "Package file is too small to contain a meaningful zip payload. Expected size must be greater than $MinimumMeaningfulZipFileLengthBytes bytes."
        }

        return [pscustomobject]@{
            Exists = $true
            IsValid = $meetsMinimumSizeRequirement
            Length = $length
            Message = $message
        }
    }
    catch [System.Management.Automation.ItemNotFoundException] {
        return [pscustomobject]@{
            Exists = $false
            IsValid = $false
            Length = [int64]0
            Message = 'Package file was not created.'
        }
    }
    catch {
        return [pscustomobject]@{
            Exists = $false
            IsValid = $false
            Length = [int64]0
            Message = "Could not inspect package file: $($_.Exception.Message)"
        }
    }
}

function Remove-ExistingFileSafely {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Description
    )

    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    }
    catch [System.Management.Automation.ItemNotFoundException] {
        return
    }
    catch {
        throw "Could not inspect existing $Description '$Path': $($_.Exception.Message)"
    }

    if ($item -isnot [System.IO.FileInfo]) {
        throw "Existing $Description path is not a file and will not be removed: $Path"
    }

    try {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
    }
    catch {
        throw "Could not remove existing $Description '$Path': $($_.Exception.Message)"
    }
}

function Assert-SafePackageIdentityPart {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$ManifestPath
    )

    $safeValue = Get-SafeDiagnosticText -Value $Value

    # The allow-list intentionally excludes slash, backslash, colon, and all
    # other path syntax. The final package path is still checked with
    # Assert-PathUnderBase after it is constructed.
    if ($Value -notmatch $PackageIdentityPattern) {
        throw "Manifest field '$Name' contains characters that are unsafe for package filenames. Only letters, digits, dots, underscores, plus signs, and hyphens are allowed. Pattern: $PackageIdentityPattern. Value: '$safeValue'. Manifest: $ManifestPath"
    }

    # Contains('..') rejects every run of two or more consecutive dots, including
    # '...' and longer runs, while ordinary version text such as '1.0.0' remains
    # valid. Leading/trailing dots are rejected separately because they can be
    # normalized away by file systems and shells.
    if ($Value.Contains('..')) {
        throw "Manifest field '$Name' must not contain two or more consecutive dots, including path traversal sequences like '..'. Value: '$safeValue'. Manifest: $ManifestPath"
    }

    if ($Value -eq '.') {
        throw "Manifest field '$Name' must not be a single dot. Value: '$safeValue'. Manifest: $ManifestPath"
    }

    if ($Value.StartsWith('.')) {
        throw "Manifest field '$Name' must not start with a dot. Value: '$safeValue'. Manifest: $ManifestPath"
    }

    if ($Value.EndsWith('.')) {
        throw "Manifest field '$Name' must not end with a dot. Value: '$safeValue'. Manifest: $ManifestPath"
    }
}

function Get-RequiredManifestText {
    param(
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][string]$PropertyName,
        [Parameter(Mandatory = $true)][string]$ManifestPath
    )

    $property = $Manifest.PSObject.Properties[$PropertyName]
    if ($null -eq $property) {
        throw "Manifest field '$PropertyName' is required. Manifest: $ManifestPath"
    }

    if ($null -eq $property.Value) {
        throw "Manifest field '$PropertyName' is required and must not be null. Manifest: $ManifestPath"
    }

    $value = [string]$property.Value
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Manifest field '$PropertyName' is required and must not be empty. Manifest: $ManifestPath"
    }

    Assert-SafePackageIdentityPart -Name $PropertyName -Value $value -ManifestPath $ManifestPath
    return $value
}

$scriptDirectory = Get-ScriptDirectory
# This script is intentionally kept in scripts/omp, so ..\.. is the repository
# root for every OMP-compatible repository that carries the shared wrappers.
$currentRepositoryRoot = Resolve-FullPathSafely -Name 'current repository root' -Path $RepositoryRootRelativePath -BasePath $scriptDirectory
$currentRepositoryMarkerPath = Join-Path $currentRepositoryRoot 'omp-components.json'
if (-not (Test-Path -LiteralPath $currentRepositoryMarkerPath -PathType Leaf)) {
    throw "Resolved repository root '$currentRepositoryRoot' does not contain omp-components.json. test-cmd-wrappers.ps1 assumes it is stored below scripts/omp."
}

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
    # OMP-compatible repositories are normally cloned as siblings; default to
    # the parent folder of the current repository so one run can validate all of
    # those sibling repositories.
    $WorkspaceRoot = Split-Path -Parent $currentRepositoryRoot
}

$workspaceRootPath = Resolve-FullDirectory -Path $WorkspaceRoot
$repositoryNames = @($RepositoryName)
$defaultValidationRoot = Join-Path ([System.IO.Path]::GetTempPath()) $ValidationDirectoryName

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    # On normal Windows developer machines and GitHub runners, GetTempPath()
    # resolves to a user-specific temp folder. Pass -OutputRoot explicitly when
    # validating packages that should not be written to temp storage.
    $OutputRoot = Join-Path $defaultValidationRoot 'packages'
}

if ([string]::IsNullOrWhiteSpace($LogRoot)) {
    $LogRoot = Join-Path $defaultValidationRoot 'logs'
}

$outputRootPath = Resolve-FullPathSafely -Name 'output root path' -Path $OutputRoot
$logRootPath = Resolve-FullPathSafely -Name 'log root path' -Path $LogRoot
Assert-SafeCmdArgumentText -Name 'OutputRoot' -Value $outputRootPath
Assert-SafeCmdArgumentText -Name 'LogRoot' -Value $logRootPath
New-DirectorySafely -Path $outputRootPath -Description 'output root directory'
New-DirectorySafely -Path $logRootPath -Description 'log root directory'
$cmdExePath = Resolve-CmdExePath
# The 'N' GUID format is 32 hexadecimal characters without hyphens, which gives
# enough uniqueness for concurrent validation runs while keeping log paths
# shorter. The run id is not a security boundary. Keep -LogRoot in a
# user-private temp folder, an ACL-protected workspace folder, or another
# location where other local users cannot read build output that may include
# paths, environment-derived diagnostics, or package validation details.
$runId = [Guid]::NewGuid().ToString('N')
$runLogRootPath = Join-Path $logRootPath $runId
New-DirectorySafely -Path $runLogRootPath -Description 'run log directory'

if ($repositoryNames.Length -gt 0) {
    $repositories = @(
        foreach ($name in $repositoryNames) {
            $candidate = Join-Path $workspaceRootPath $name
            if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
                throw "Repository directory not found: $candidate"
            }

            Get-Item -LiteralPath $candidate
        }
    )
}
else {
    $repositories = @(
        Get-ChildItem -LiteralPath $workspaceRootPath -Directory |
            Where-Object {
                (Test-Path -LiteralPath (Join-Path $_.FullName $ManifestRelativePath) -PathType Leaf) -and
                (Test-Path -LiteralPath (Join-Path $_.FullName $CommandWrapperRelativePath) -PathType Leaf)
            } |
            Sort-Object Name
    )
}

$commandWrapperDisplayName = Split-Path -Leaf $CommandWrapperRelativePath
if ([string]::IsNullOrWhiteSpace($commandWrapperDisplayName)) {
    $commandWrapperDisplayName = $CommandWrapperRelativePath
}

if ($repositories.Count -eq 0) {
    throw "No OMP-compatible repositories found below $workspaceRootPath. Each repository must contain $ManifestRelativePath and $CommandWrapperRelativePath."
}

# WaitForExit expects a 32-bit millisecond value. This is intentionally computed
# from the parameter so the unit conversion stays close to the configured
# timeout; ValidateRange caps it at 3,600 seconds (3,600,000 ms), well below
# [int]::MaxValue, and Convert-SecondsToIntMilliseconds also rejects values
# above the WaitForExit-compatible seconds limit.
try {
    $timeoutMilliseconds = Convert-SecondsToIntMilliseconds -Name 'PerRepositoryTimeoutSeconds' -Seconds $PerRepositoryTimeoutSeconds
}
catch {
    throw "Invalid per-repository validation timeout configuration used by the main repository loop: $($_.Exception.Message)"
}
$timeoutSecondsDisplay = $PerRepositoryTimeoutSeconds
# Validation results are assembled as PSCustomObjects in several branches; a
# generic object list keeps append behavior efficient without defining a custom
# class for this script-only report.
$results = [System.Collections.Generic.List[object]]::new()

foreach ($repository in $repositories) {
    $repoDisplayName = $repository.Name
    $manifestPath = Join-Path $repository.FullName $ManifestRelativePath
    $cmdPath = Join-Path $repository.FullName $CommandWrapperRelativePath

    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        $results.Add((New-ValidationResult `
            -Repository $repoDisplayName `
            -Status 'Missing manifest' `
            -ExitCode $null `
            -Package '' `
            -StdoutLog '' `
            -StderrLog '' `
            -Detail "Component manifest not found: $manifestPath"))
        continue
    }

    if (-not (Test-Path -LiteralPath $cmdPath -PathType Leaf)) {
        $results.Add((New-ValidationResult `
            -Repository $repoDisplayName `
            -Status 'Missing wrapper' `
            -ExitCode $null `
            -Package '' `
            -StdoutLog '' `
            -StderrLog '' `
            -Detail "Command wrapper not found: $cmdPath"))
        continue
    }

    Assert-RepositoryPathUnderWorkspace -RepositoryPath $repository.FullName -WorkspaceRootPath $workspaceRootPath

    try {
        # Keep -Encoding UTF8 for Windows PowerShell compatibility. The OMP
        # repository tooling writes component manifests as UTF-8 JSON. Avoid
        # utf8NoBOM here because Windows PowerShell 5.1 does not support it.
        # For reads, -Encoding UTF8 handles both BOM and no-BOM UTF-8 manifests
        # in the PowerShell versions targeted by these wrapper scripts, so avoid
        # a version-specific branch only to choose utf8NoBOM on newer shells.
        $manifestJson = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
    }
    catch [System.Management.Automation.ItemNotFoundException] {
        # The file was checked above, but it can still be removed or replaced
        # between Test-Path and Get-Content.
        throw "Component manifest is missing: $manifestPath"
    }
    catch [System.UnauthorizedAccessException] {
        throw "Could not read component manifest '$manifestPath' because access was denied. Check file permissions for the current user: $($_.Exception.Message)"
    }
    catch [System.IO.IOException] {
        throw "Could not read component manifest '$manifestPath' because of an I/O error. Verify that the file is not locked, being replaced, or on an unavailable drive: $($_.Exception.Message)"
    }
    catch {
        throw "Could not read component manifest '$manifestPath'. Verify that the path is a filesystem file, readable by the current user, and not blocked by another process: $($_.Exception.Message)"
    }

    try {
        $manifest = $manifestJson | ConvertFrom-Json
    }
    catch {
        throw "Component manifest '$manifestPath' was read but could not be parsed as JSON. Check for common JSON syntax issues such as missing commas, trailing commas, or unescaped quotes: $($_.Exception.Message)"
    }

    $packageKey = Get-RequiredManifestText -Manifest $manifest -PropertyName 'repositoryKey' -ManifestPath $manifestPath
    $packageVersion = Get-RequiredManifestText -Manifest $manifest -PropertyName 'repositoryVersion' -ManifestPath $manifestPath

    # The default command wrapper creates the repository's global package, and
    # global packages use the same __global__ naming convention as
    # export-universal-package.ps1.
    # Global package files are named repositoryKey__global__repositoryVersion.zip.
    $expectedPackageFileName = '{0}{1}{2}.zip' -f $packageKey, $GlobalPackageFileDelimiter, $packageVersion
    $expectedPackagePath = Join-Path $outputRootPath $expectedPackageFileName
    # Manifest fields are allow-listed before the filename is built, and this
    # final base-path check is kept as defense in depth against traversal if the
    # naming convention changes later.
    Assert-PathUnderBase -Path $expectedPackagePath -BasePath $outputRootPath -PathDescription 'Expected package path' -BaseDescription 'output root'
    Remove-ExistingFileSafely -Path $expectedPackagePath -Description 'expected package'

    # Keep the sanitized name for human-readable logs and the path hash for
    # uniqueness when different workspace roots contain same-named repositories.
    $safeName = '{0}-{1}' -f (Get-SafeFileName -Value $repoDisplayName), (Get-ShortStableHash -Value $repository.FullName)
    $stdoutPath = Join-Path $runLogRootPath "$safeName.stdout.log"
    $stderrPath = Join-Path $runLogRootPath "$safeName.stderr.log"
    Assert-PathUnderBase -Path $stdoutPath -BasePath $runLogRootPath -PathDescription 'stdout log path' -BaseDescription 'run log root'
    Assert-PathUnderBase -Path $stderrPath -BasePath $runLogRootPath -PathDescription 'stderr log path' -BaseDescription 'run log root'
    Remove-ExistingFileSafely -Path $stdoutPath -Description 'stdout log'
    Remove-ExistingFileSafely -Path $stderrPath -Description 'stderr log'

    Write-Host "[$repoDisplayName] Running $commandWrapperDisplayName (timeout: $timeoutSecondsDisplay seconds)..."

    # --no-pause is a CMD-wrapper flag; the wrapper removes it before invoking
    # the underlying PowerShell script. call ensures the invoked .cmd file
    # returns control to this cmd.exe instance when it is run through /c. The
    # wrapper path and arguments are escaped first, then prefixed with the cmd.exe
    # built-in keyword.
    Assert-SafeCmdArgumentText -Name 'Command wrapper path' -Value $cmdPath
    # Join-CmdCommandLine validates every argument immediately before quoting,
    # including the immutable output root path.
    $wrapperArguments = @($cmdPath, '--no-pause', '-OutputDirectory', $outputRootPath)
    $cmdInvocation = 'call {0}' -f (Join-CmdCommandLine -Arguments $wrapperArguments)
    Assert-CmdCommandLineLength -CommandLine $cmdInvocation
    # /d disables cmd.exe AutoRun hooks and /c runs the wrapper then exits.
    $cmdArguments = @('/d', '/c', $cmdInvocation)
    # Display-only diagnostic text. Do not feed this back into cmd.exe; actual
    # execution uses ArgumentList above so arguments stay separated.
    $cmdArgumentDisplayText = $cmdArguments -join ' '
    $process = $null
    $processStartTime = $null
    try {
        # -WindowStyle Hidden keeps validation non-interactive. -NoNewWindow is
        # intentionally not used because this script redirects stdout/stderr to
        # files and should not attach child command windows to the caller.
        # Re-check immediately before process start. This is intentionally kept
        # even though the repository was validated earlier, because junctions or
        # filesystem changes between enumeration and execution should not move
        # command execution outside the intended workspace.
        Assert-RepositoryPathUnderWorkspace -RepositoryPath $repository.FullName -WorkspaceRootPath $workspaceRootPath

        $processParameters = @{
            FilePath = $cmdExePath
            ArgumentList = $cmdArguments
            WorkingDirectory = $repository.FullName
            RedirectStandardOutput = $stdoutPath
            RedirectStandardError = $stderrPath
            WindowStyle = 'Hidden'
            PassThru = $true
        }
        $process = Start-Process @processParameters
        $processStartTime = Get-ProcessStartTimeOrNull -Process $process
    }
    catch {
        $startError = $_.Exception.ToString()
        Write-Warning "[$repoDisplayName] Failed to start CMD wrapper: $startError"
        $results.Add((New-ValidationResult `
            -Repository $repoDisplayName `
            -Status 'Start failed' `
            -ExitCode $null `
            -Package $expectedPackagePath `
            -StdoutLog $stdoutPath `
            -StderrLog $stderrPath `
            -Detail "Process start failed. Command: $cmdExePath $cmdArgumentDisplayText$([Environment]::NewLine)Stdout/stderr log files may not exist if cmd.exe could not start or if a redirected log path was locked.$([Environment]::NewLine)$startError"))
        continue
    }

    try {
        # Timeout handling stays inline because it updates the per-repository
        # validation result, log paths, process identity diagnostics, and final
        # package inspection in one flow. Extracting it would require a wide
        # parameter object without making the operational logic safer.
        $completedWithinTimeout = $process.WaitForExit($timeoutMilliseconds)
        $timedOut = -not $completedWithinTimeout
        if ($timedOut) {
            # The process can exit between timeout detection and the following
            # state reads. Every termination branch refreshes the Process object
            # and treats "already exited" as a successful no-op.
            $processId = Get-ValidProcessIdOrNull -Process $process
            $processIdText = if ($null -eq $processId) { '<unknown>' } else { [string]$processId }
            Write-Warning "[$repoDisplayName] Timeout reached after $timeoutSecondsDisplay seconds. Terminating process tree for PID $processIdText."
            $process.Refresh()
            if ($process.HasExited) {
                Write-Warning "[$repoDisplayName] Process exited after the timeout was detected; taskkill was not needed."
            }
            elseif ($null -eq $processId) {
                Write-Warning "[$repoDisplayName] Process PID could not be read or was invalid; taskkill was not attempted. Current identity: $(Get-ProcessIdentityDiagnostic -Process $process)."
            }
            elseif (-not (Test-ExpectedCmdProcess -Process $process -ExpectedStartTime $processStartTime)) {
                Write-Warning "[$repoDisplayName] Timed-out process is no longer the expected cmd.exe instance; taskkill was not attempted. Current identity: $(Get-ProcessIdentityDiagnostic -Process $process)."
            }
            else {
                $taskKillAttempted = $false
                $taskKillOutput = @()
                $taskKillExitCode = $TaskKillExecutionExceptionExitCode
                try {
                    $process.Refresh()
                    if ($process.HasExited) {
                        Write-Warning "[$repoDisplayName] Process exited immediately before taskkill; termination was not needed."
                    }
                    elseif (-not (Test-ExpectedCmdProcess -Process $process -ExpectedStartTime $processStartTime)) {
                        Write-Warning "[$repoDisplayName] Process identity changed immediately before taskkill; termination was not attempted. Current identity: $(Get-ProcessIdentityDiagnostic -Process $process)."
                    }
                    else {
                        # This intentionally repeats the earlier process-state
                        # checks immediately before taskkill to narrow the
                        # time-of-check/time-of-use window.
                        # The Process object keeps a handle to the child cmd.exe
                        # and HasExited/ProcessName/StartTime are checked
                        # immediately before taskkill, so PID reuse is not
                        # expected in normal Windows process lifetime semantics.
                        $taskKillAttempted = $true
                        $taskKillResult = Invoke-TaskKillTree -ProcessId $processId
                        $taskKillOutput = $taskKillResult.Output
                        $taskKillExitCode = $taskKillResult.ExitCode
                    }
                }
                catch {
                    $taskKillOutput = @($_.Exception.ToString())
                    $taskKillExitCode = $TaskKillExecutionExceptionExitCode
                }

                if ($taskKillAttempted -and $taskKillExitCode -ne 0) {
                    Write-TaskKillFailureWarning -RepositoryName $repoDisplayName -ExitCode $taskKillExitCode -Output @($taskKillOutput)
                }

                $process.Refresh()
                if ($process.HasExited) {
                    Write-Verbose "[$repoDisplayName] Process exited after termination attempt."
                }
                elseif (-not $process.WaitForExit($PostTerminationWaitMilliseconds)) {
                    Write-Warning "[$repoDisplayName] Process did not exit within $PostTerminationWaitSeconds seconds after termination attempt; exit code may be unavailable."
                    try {
                        $process.Refresh()
                        if ($process.HasExited) {
                            Write-Warning "[$repoDisplayName] Process exited immediately before direct Process.Kill(); no further termination was needed."
                        }
                        elseif (-not (Test-ExpectedCmdProcess -Process $process -ExpectedStartTime $processStartTime)) {
                            Write-Warning "[$repoDisplayName] Process identity changed immediately before direct Process.Kill(); termination was not attempted. Current identity: $(Get-ProcessIdentityDiagnostic -Process $process)."
                        }
                        else {
                            # The process can still exit between HasExited and
                            # Kill(); the catch below treats that race as a
                            # diagnostic warning instead of a script failure.
                            $process.Kill()
                        }

                        if (-not $process.WaitForExit($DirectProcessKillWaitMilliseconds)) {
                            Write-Warning "[$repoDisplayName] Process with PID $processIdText still did not exit after direct Process.Kill(). Use Task Manager or tasklist.exe to verify the process tree has terminated before rerunning package validation."
                        }
                    }
                    catch {
                        $killError = $_.Exception.Message
                        try {
                            $process.Refresh()
                            if ($process.HasExited) {
                                Write-Warning "[$repoDisplayName] Direct Process.Kill() raced with natural process exit; no further termination was needed. Original error: $killError"
                            }
                            else {
                                Write-Warning "[$repoDisplayName] Direct Process.Kill() after timeout failed while the process still appeared to be running: $killError"
                            }
                        }
                        catch {
                            Write-Warning "[$repoDisplayName] Direct Process.Kill() after timeout failed and the final process state could not be inspected: $killError"
                        }
                    }
                }
            }
        }

        $process.Refresh()
        if ($process.HasExited) {
            # Start-Process redirects stdout/stderr directly to files here, not
            # through async .NET event handlers. A short bounded wait is enough
            # to let the process object observe final stream state without
            # introducing an unbounded wait after timeout handling.
            if (-not $process.WaitForExit($StreamFlushWaitMilliseconds)) {
                Write-Verbose "[$repoDisplayName] Process had exited, but final stream flush wait did not complete within $StreamFlushWaitSeconds seconds."
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

        $results.Add((New-ValidationResult `
            -Repository $repoDisplayName `
            -Status $status `
            -ExitCode $exitCode `
            -Package $expectedPackagePath `
            -StdoutLog $stdoutPath `
            -StderrLog $stderrPath `
            -Detail $packageValidation.Message))

        Write-Host "[$repoDisplayName] $status"
    }
    finally {
        if ($null -ne $process) {
            $process.Dispose()
        }
    }
}

$results | Format-Table Repository, Status, ExitCode, Package -AutoSize

# The table stays compact for CI logs. StdoutLog, StderrLog, and Detail remain
# on each result object for callers that capture the script output.
$hasFailures = $false
foreach ($result in $results) {
    if ($result.Status -ne 'OK') {
        $hasFailures = $true
        break
    }
}

if ($hasFailures) {
    # Keep one generic failure exit code for compatibility with existing
    # callers; individual failure categories are reported in the table above.
    exit 1
}
