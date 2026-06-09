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
Defaults to a user-temp validation folder when omitted or empty.

.PARAMETER LogRoot
Directory where stdout/stderr logs are written. Use a user-private or
ACL-protected location when logs may contain sensitive diagnostics.

.PARAMETER PerRepositoryTimeoutSeconds
Maximum build time per repository. Must be between 60 and 3600 seconds; the
upper bound of 3600 seconds (1 hour) is enforced by ValidateRange and the
default is 1200 seconds (20 minutes).
#>
[CmdletBinding()]
param(
    [string]$WorkspaceRoot = '',
    [string[]]$RepositoryName = @(),
    [string]$ManifestRelativePath = 'omp-components.json',
    [string]$CommandWrapperRelativePath = 'scripts/omp/build-universal-package.cmd',
    [string]$OutputRoot = '',
    [string]$LogRoot = '',
    # Allow at least 60 seconds for minimal build work, and cap the maximum at
    # 3600 seconds (1 hour) so CI/manual validation stays bounded. ValidateRange
    # requires literal values in a Windows PowerShell 5.1 script parameter block,
    # so the accepted range is repeated here and in the parameter help above.
    [ValidateRange(60, 3600)]
    [int]$PerRepositoryTimeoutSeconds = 1200
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$CurrentScriptDisplayName = if ([string]::IsNullOrWhiteSpace($PSCommandPath)) {
    'this script'
}
else {
    Split-Path -Leaf $PSCommandPath
}

$SafeFileNamePattern = '[^A-Za-z0-9._\-]+'
$PackageIdentityPattern = '^[A-Za-z0-9._+-]+$'
# Delimiter between repositoryKey and repositoryVersion in
# repositoryKey__global__repositoryVersion.zip.
$GlobalPackageFileNameDelimiter = '__global__'
$ValidationDirectoryName = 'omp-cmd-wrapper-validation'
# A SHA256 digest is 32 bytes, represented here as 64 hexadecimal characters.
$Sha256HexLength = 64
# 16 hex characters from SHA256 gives 64 bits of stable filename entropy.
# Keep this between 1 and $Sha256HexLength if it ever becomes configurable.
$HashPrefixLength = 16
# Only reject impossible child-process IDs. Windows reserves some low PIDs for
# system processes, but this script starts cmd.exe itself and only needs to
# prevent invalid zero/negative IDs from reaching taskkill.exe.
$MinimumValidProcessId = 1
# ASCII control characters: NUL through US (Unit Separator), including all
# whitespace controls such as TAB, vertical tab, form feed, CR, and LF, plus DEL.
$AsciiControlMaximum = 31
$AsciiDeleteCodePoint = 127
# Keep the replacement compact because the first control character is reported
# precisely by Get-ControlCharacterDiagnostic when validation rejects a value.
$ControlCharacterReplacement = '?'
# Same range as $AsciiControlMaximum and $AsciiDeleteCodePoint, expressed in
# regex hexadecimal notation for PowerShell's regular-expression engine.
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
$TruncationIndicator = '...'
$MillisecondsPerSecond = 1000
# The shared wrappers are intentionally stored at scripts/omp/test-cmd-wrappers.ps1.
# Build the relative path from segments and validate it during startup so moving
# the script fails loudly.
$RepositoryRootRelativePathSegments = @('..', '..')
$RepositoryRootRelativePath = Join-Path $RepositoryRootRelativePathSegments[0] $RepositoryRootRelativePathSegments[1]
# Store the theoretical .NET API limit separately because WaitForExit accepts an
# [int] millisecond value. The practical wrapper timeout is much lower and is
# constrained by the PerRepositoryTimeoutSeconds parameter.
$MaximumWaitForExitMilliseconds = [int]::MaxValue
# Floor gives the largest whole-second value that can round-trip through
# WaitForExit(int milliseconds) without overflowing after conversion back to
# milliseconds.
$MaximumWaitForExitSeconds = [int][Math]::Floor($MaximumWaitForExitMilliseconds / $MillisecondsPerSecond)
# Named alias for the same computed limit. The ValidateRange attribute inside
# Convert-SecondsToIntMilliseconds must still use a literal value in Windows
# PowerShell 5.1, because ValidateRange attribute arguments cannot reference
# variables there. Its inline comment explicitly ties the literal to this
# constant and the runtime check below remains the source of truth.
$MaximumSafeSecondsForMillisecondConversion = $MaximumWaitForExitSeconds

# Script-scoped second values are retained for human-readable diagnostics;
# helper functions intentionally read them from script scope after they are
# converted to WaitForExit-compatible millisecond values below.
# Keep them as conventional script constants instead of Set-Variable ReadOnly
# values so the script remains straightforward to dot-source and parser-test in
# Windows PowerShell 5.1. StrictMode and review keep this file from reassigning
# them during normal execution.
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
# Keep these timeouts separate even when defaults match: taskkill.exe has its
# own startup/runtime budget, while the target cmd.exe gets a separate grace
# period after taskkill asks Windows to terminate the process tree.
# taskkill.exe uses normal process exit codes. This distinctive sentinel means
# PowerShell could not start or observe taskkill.exe itself; it is not returned
# by taskkill.exe during normal process termination.
$TaskKillExecutionExceptionExitCode = [int]::MinValue
$InvalidProcessIdSentinel = -1
# taskkill.exe flags used after a repository wrapper exceeds its timeout.
# /T terminates the process tree; /F forces termination when cooperative exit
# is no longer expected.
$TaskKillProcessIdSwitch = '/PID'
$TaskKillTerminateTreeSwitch = '/T'
$TaskKillForceSwitch = '/F'
$CmdCallKeyword = 'call'
$StdoutLogExtension = '.stdout.log'
$StderrLogExtension = '.stderr.log'
$GuidFormatNoHyphens = 'N'
$ValidationSummaryColumns = @('Repository', 'Status', 'ExitCode', 'Package')
# Windows can round Process.StartTime differently between the original Process
# handle and a refreshed lookup because process metadata is read from snapshots
# with timer-resolution limits. 100 ms is intentionally far above normal tick
# variance while still small enough to catch a different process after PID reuse.
$ProcessStartTimeToleranceMilliseconds = 100
$ProcessStartTimeTolerance = [TimeSpan]::FromMilliseconds($ProcessStartTimeToleranceMilliseconds)
$NoTaskExceptionDiagnostic = 'Async stream read task faulted without exception information'

# This startup guard intentionally protects future edits to the script-level
# constants. It keeps later truncation logic simple and avoids defensive math in
# hot diagnostic paths.
if ($MaximumDiagnosticTextLength -le $TruncationIndicator.Length) {
    $message = @(
        'MaximumDiagnosticTextLength must be greater than the truncation indicator length.'
        "MaximumDiagnosticTextLength=$MaximumDiagnosticTextLength."
        "TruncationIndicatorLength=$($TruncationIndicator.Length)."
    ) -join ' '
    throw $message
}

if ($MaximumSafeSecondsForMillisecondConversion -ne 2147483) {
    throw "ValidateRange literal for Convert-SecondsToIntMilliseconds is out of sync. Expected 2147483 but computed $MaximumSafeSecondsForMillisecondConversion."
}

function Convert-SecondsToIntMilliseconds {
    param(
        [Parameter(Mandatory = $true)][string]$TimeoutDescription,
        # ValidateRange requires a literal value in Windows PowerShell 5.1.
        # 2147483 is floor([int]::MaxValue / 1000), or floor(2147483647 / 1000),
        # which is the largest whole-second value that safely converts back to
        # WaitForExit(int milliseconds). Keep this aligned with
        # $MaximumSafeSecondsForMillisecondConversion.
        [ValidateRange(1, 2147483)]
        [Parameter(Mandatory = $true)][int]$Seconds
    )

    # The input is whole seconds, so use integer arithmetic instead of
    # floating-point TimeSpan conversion or banker's rounding. Most callers are
    # script constants, but keep this guard because this helper is also used for
    # any future timeout value that must fit WaitForExit(int milliseconds).
    if ($Seconds -gt $MaximumSafeSecondsForMillisecondConversion) {
        throw "$TimeoutDescription is too large for .NET Process.WaitForExit(int): $Seconds seconds. Maximum supported value is $MaximumSafeSecondsForMillisecondConversion seconds."
    }

    # Force Int64 multiplication before casting back to Int32 so future timeout
    # constants cannot overflow during intermediate arithmetic.
    $milliseconds = ([int64]$Seconds) * $MillisecondsPerSecond
    # Defense in depth for future changes to the seconds cap above.
    if ($milliseconds -gt $MaximumWaitForExitMilliseconds) {
        throw "$TimeoutDescription converts to $milliseconds milliseconds, which exceeds the .NET Process.WaitForExit(int) maximum of $MaximumWaitForExitMilliseconds milliseconds."
    }

    return [int]$milliseconds
}

function Get-SafeDiagnosticText {
    param([AllowNull()][AllowEmptyString()][string]$Value)

    if ($null -eq $Value) {
        return '<null>'
    }

    $safe = $Value -replace $ControlCharacterPattern, $ControlCharacterReplacement
    if ($safe.Length -gt $MaximumDiagnosticTextLength) {
        $prefixLength = $MaximumDiagnosticTextLength - $TruncationIndicator.Length
        return $safe.Substring(0, $prefixLength) + $TruncationIndicator
    }

    return $safe
}

function Get-SafeDiagnosticExcerpt {
    param(
        [AllowNull()][AllowEmptyString()][string]$Value,
        [int]$MaximumLines = 5
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return '<empty>'
    }

    $safeLines = [System.Collections.Generic.List[string]]::new()
    $reader = [System.IO.StringReader]::new($Value)
    try {
        while ($safeLines.Count -lt $MaximumLines) {
            $line = $reader.ReadLine()
            if ($null -eq $line) {
                break
            }

            $safeLines.Add((Get-SafeDiagnosticText -Value $line))
        }
    }
    finally {
        $reader.Dispose()
    }

    return ($safeLines.ToArray() -join ' | ')
}

function Get-ControlCharacterDiagnostic {
    param([Parameter(Mandatory = $true)][string]$Value)

    foreach ($character in $Value.ToCharArray()) {
        $codePoint = [int][char]$character
        # This is intentionally ASCII-control detection. UTF-16 surrogate pairs
        # are irrelevant for the 0..31 and 127 code-unit checks below.
        if ($codePoint -le $AsciiControlMaximum -or $codePoint -eq $AsciiDeleteCodePoint) {
            return ('U+{0:X4}' -f $codePoint)
        }
    }

    # Callers should only invoke this after matching $ControlCharacterPattern.
    return 'no control character found'
}

try {
    # Keep these conversions explicit instead of looping over variable names:
    # each output variable is consumed by different process-wait branches, and
    # spelling them out makes timeout diagnostics easier to trace.
    $PostTerminationWaitMilliseconds = Convert-SecondsToIntMilliseconds -TimeoutDescription 'PostTerminationWaitSeconds' -Seconds $PostTerminationWaitSeconds
    $TaskKillWaitMilliseconds = Convert-SecondsToIntMilliseconds -TimeoutDescription 'TaskKillWaitSeconds' -Seconds $TaskKillWaitSeconds
    $TaskKillPostTerminationWaitMilliseconds = Convert-SecondsToIntMilliseconds -TimeoutDescription 'TaskKillPostTerminationWaitSeconds' -Seconds $TaskKillPostTerminationWaitSeconds
    $TaskKillStreamReadWaitMilliseconds = Convert-SecondsToIntMilliseconds -TimeoutDescription 'TaskKillStreamReadWaitSeconds' -Seconds $TaskKillStreamReadWaitSeconds
    $DirectProcessKillWaitMilliseconds = Convert-SecondsToIntMilliseconds -TimeoutDescription 'DirectProcessKillWaitSeconds' -Seconds $DirectProcessKillWaitSeconds
}
catch {
    throw "Invalid built-in process wait timeout in ${CurrentScriptDisplayName}: $($_.Exception.Message)"
}

function Get-ScriptDirectory {
    # $PSScriptRoot is expected for normal script execution. $PSCommandPath is
    # retained as a cheap fallback for unusual hosts that expose the script path
    # but not the script root.
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return $PSScriptRoot
    }

    $scriptPath = $PSCommandPath
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        throw 'Could not resolve script directory because both $PSScriptRoot and $PSCommandPath were unavailable.'
    }

    return Split-Path -Parent $scriptPath
}

function Resolve-FullPathSafely {
    <#
    .PARAMETER BasePath
    Optional base directory for relative paths. When omitted, the current
    filesystem location is used; callers that need containment guarantees must
    still validate the resolved path with the Assert-* helpers.

    .NOTES
    If BasePath is omitted while the current PowerShell location is not backed
    by the FileSystem provider, the helper throws a descriptive error instead
    of resolving against a non-filesystem provider path.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$BasePath = ''
    )

    try {
        # This helper only canonicalizes paths, including rooted paths. It is
        # intentionally not a security boundary because several callers resolve
        # user-selected output/log roots. Callers that require containment must
        # validate the resolved path against the intended workspace/output base
        # with Assert-* helpers before using it.
        if ([System.IO.Path]::IsPathRooted($Path)) {
            # Rooted paths are canonicalized only. This function deliberately
            # does not restrict them to the workspace or output root.
            return [System.IO.Path]::GetFullPath($Path)
        }

        $effectiveBasePath = if ([string]::IsNullOrWhiteSpace($BasePath)) {
            $currentLocation = Get-Location
            if ($currentLocation.Provider.Name -ne 'FileSystem') {
                $message = @(
                    'Current PowerShell location must be a filesystem path before resolving relative paths.'
                    "Actual provider: $($currentLocation.Provider.Name)."
                    "Current path: $($currentLocation.Path)."
                    'Provide an explicit BasePath parameter, or use Set-Location to switch to the relevant workspace directory before calling this helper.'
                ) -join ' '
                throw $message
            }

            $currentLocation.ProviderPath
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
    # Exact matches are allowed because callers use this helper for both
    # workspace roots themselves and strict children under those roots.
    return $fullPath.Equals($fullBasePath, [StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullBasePathWithSeparator, [StringComparison]::OrdinalIgnoreCase)
}

function Trim-TrailingDirectorySeparators {
    param([Parameter(Mandatory = $true)][string]$Path)

    # Trim both Windows separator styles so C:\path\ and C:/path/ compare the
    # same way, while preserving roots where the trailing separator is semantic.
    $trimmed = $Path.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    # Get the root from the original path, not the trimmed path, so drive and
    # UNC roots retain the separator that makes them absolute roots on Windows.
    $root = [System.IO.Path]::GetPathRoot($Path)
    if ([string]::IsNullOrEmpty($root)) {
        return $trimmed
    }

    $rootWithoutTrailingSeparator = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if ($trimmed.Equals($rootWithoutTrailingSeparator, [StringComparison]::OrdinalIgnoreCase)) {
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

    # The wrapper validation is Windows-only by design because it launches
    # cmd.exe and taskkill.exe. Use OrdinalIgnoreCase path comparisons to match
    # normal Windows filesystem behavior for local drives and UNC paths.
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

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $sha256 = $null
    try {
        # SHA256 output is standardized; the concrete provider chosen by
        # SHA256.Create() does not affect the resulting bytes.
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha256.ComputeHash($bytes)
    }
    finally {
        # SHA256.Create() can fail before assignment on unusual crypto-provider
        # problems, so only dispose the provider when construction succeeded.
        if ($null -ne $sha256) {
            $sha256.Dispose()
        }
    }

    # 16 hex characters gives 64 bits of stable filename entropy, which is
    # intentionally more than enough for the small set of sibling repositories.
    # Build the full SHA256 hex string before taking the configured prefix so
    # the length check below still verifies a complete digest.
    $hashBuilder = [System.Text.StringBuilder]::new($Sha256HexLength)
    foreach ($hashByte in $hashBytes) {
        $null = $hashBuilder.Append($hashByte.ToString('x2', [System.Globalization.CultureInfo]::InvariantCulture))
    }

    $hash = $hashBuilder.ToString()
    if ($hash.Length -lt $HashPrefixLength) {
        throw "Generated SHA256 hash was shorter than HashPrefixLength. HashLength=$($hash.Length), HashPrefixLength=$HashPrefixLength."
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
        throw "$Name cannot contain double quotes when it is passed through cmd.exe: $(Get-SafeDiagnosticText -Value $Value)"
    }

    if ($Value.Contains('%')) {
        throw "$Name cannot contain percent signs; cmd.exe expands environment variables even within quoted strings: $(Get-SafeDiagnosticText -Value $Value)"
    }

    # Newlines are also covered by $ControlCharacterPattern. Keep this branch
    # first so users get a clearer error for the most common control characters.
    if ($Value.Contains("`r") -or $Value.Contains("`n")) {
        throw "$Name cannot contain newline characters when it is passed through cmd.exe: $(Get-SafeDiagnosticText -Value $Value)"
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
    Assert-SafeCmdArgumentText -Name 'cmd wrapper argument' -Value $Value

    # cmd.exe treats ^ as its escape character; ^^ emits one literal caret.
    # Escape carets before quoting so a literal caret cannot alter parsing of
    # the generated command line. The quoting pattern includes ^, so a caret
    # escaped to ^^ is still forced into a quoted argument below. The script
    # invokes cmd.exe without /v:on, so this cmd instance does not perform
    # delayed ! expansion; AutoRun hooks are disabled later with /d.
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
    # Branch-specific early returns keep the system-cmd and ComSpec diagnostics
    # close to the condition that made each path acceptable or unusable.
    $systemRoot = $env:SystemRoot
    $systemCmdError = $null
    if (-not [string]::IsNullOrWhiteSpace($systemRoot)) {
        $system32Path = Join-Path $systemRoot 'System32'
        $systemCmdDiagnosticPath = Join-Path $system32Path 'cmd.exe'
        if (Test-Path -LiteralPath $systemCmdDiagnosticPath -PathType Leaf) {
            try {
                return Assert-CmdExecutablePath -Name 'system cmd.exe path' -Path $systemCmdDiagnosticPath
            }
            catch {
                $systemCmdError = $_.Exception.Message
            }
        }
        else {
            $systemCmdError = "System cmd.exe path was missing: $systemCmdDiagnosticPath"
        }
    }
    else {
        $systemCmdError = 'SystemRoot environment variable was empty.'
    }

    $candidate = $env:ComSpec
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw "Could not locate cmd.exe. System path check: $systemCmdError ComSpec was empty."
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
    # Branch-specific early returns keep the preferred System32 lookup separate
    # from the PATH fallback used only when SystemRoot is unavailable.
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
        Write-Verbose "Could not read process ID ($($_.Exception.GetType().FullName)): $($_.Exception.Message)"
        return $null
    }

    # Reject PIDs below 1 before any taskkill command is assembled. PID 0 is
    # the System Idle Process on Windows, not a normal child process.
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
        return '[null type]'
    }

    try {
        return $Value.GetType().FullName
    }
    catch {
        return "<unknown: $($_.Exception.Message)>"
    }
}

function Get-CurrentIdentityDiagnostic {
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        if ($null -ne $identity -and -not [string]::IsNullOrWhiteSpace($identity.Name)) {
            return $identity.Name
        }
    }
    catch {
        Write-Verbose "Could not read current Windows identity: $($_.Exception.Message)"
    }

    if (-not [string]::IsNullOrWhiteSpace($env:USERNAME)) {
        return $env:USERNAME
    }

    return '<unknown user>'
}

function ConvertTo-TaskKillProcessIdArgument {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    if ($ProcessId -lt $MinimumValidProcessId) {
        throw "Process ID must be positive before it is passed to taskkill.exe: $ProcessId"
    }

    return [string]$ProcessId
}

function Add-TaskOutputOrDiagnostic {
    <#
    .SYNOPSIS
    Adds redirected taskkill.exe stream output or a bounded diagnostic message.

    .NOTES
    Windows PowerShell 5.1 has no async/await syntax and ReadToEndAsync has no
    cancellation token on the supported runtimes. If the bounded Task.Wait call
    times out, this helper reports that condition and leaves the read task to
    complete later; timeout cleanup is handled by the owning process path.
    This is acceptable here because the tasks read independent helper-process
    streams and do not marshal continuations back to the PowerShell thread.
    #>
    param(
        [Parameter(Mandatory = $true)][System.Collections.Generic.List[string]]$Output,
        [Parameter(Mandatory = $true)][object]$Task,
        [Parameter(Mandatory = $true)][string]$StreamName
    )

    try {
        # Task.Wait can surface stream read failures as AggregateException; the
        # catch below converts them into diagnostics instead of hiding them.
        # The call blocks the current PowerShell thread, but the wait is
        # bounded and Windows PowerShell 5.1 has no async/await syntax that
        # would make this helper-process stream read clearer.
        $taskCompleted = $Task.Wait($TaskKillStreamReadWaitMilliseconds)

        if (-not $taskCompleted) {
            # ReadToEndAsync has no cancellation token in the runtimes this
            # script targets. Leave the task alone after this bounded diagnostic
            # wait; the owning process is already being observed separately.
            # Attaching a continuation would only add asynchronous bookkeeping
            # for helper-process diagnostics and would not make timeout handling
            # safer in Windows PowerShell 5.1. A timeout here can leave the
            # stream read task completing later; that is acceptable because the
            # helper process has already exited or is being handled by the
            # process-timeout path.
            $Output.Add("Timed out after $TaskKillStreamReadWaitSeconds seconds while reading taskkill $StreamName.")
            return
        }

        if ($Task.IsCanceled) {
            $Output.Add("Could not read taskkill ${StreamName}; the async stream read task was canceled.")
            return
        }

        if ($Task.IsFaulted) {
            if ($null -ne $Task.Exception) {
                $errorText = $Task.Exception.GetBaseException().Message
            }
            else {
                $taskObjectType = Get-ObjectTypeName -Value $Task
                $errorText = "$NoTaskExceptionDiagnostic. TaskObjectType=$taskObjectType."
            }

            $Output.Add("Could not read taskkill ${StreamName}; the async stream read task faulted: $errorText")
            return
        }

        # The task has completed and was checked for cancellation/fault above,
        # so reading Result is clearer than awaiting from Windows PowerShell 5.1.
        $text = $Task.Result
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            $Output.Add($text.Trim())
        }
    }
    catch [System.AggregateException] {
        $Output.Add("Could not read taskkill ${StreamName}; the async stream read task failed: $($_.Exception.GetBaseException().Message)")
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
    foreach ($argument in @($TaskKillProcessIdSwitch, $processIdArgument, $TaskKillTerminateTreeSwitch, $TaskKillForceSwitch)) {
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
                Write-Warning "taskkill.exe exceeded $TaskKillWaitSeconds seconds and is being forcefully terminated; this terminates the helper taskkill.exe process, not the target process tree."
                $taskKillProcess.Kill()
            }
            catch {
                $taskKillProcessId = Get-ValidProcessIdOrNull -Process $taskKillProcess
                $taskKillListProcessId = if ($null -ne $taskKillProcessId) { $taskKillProcessId } else { $InvalidProcessIdSentinel }
                $taskKillListCommand = Get-TaskListDiagnosticCommand -ProcessId $taskKillListProcessId
                $warning = @(
                    'Could not terminate stuck taskkill.exe helper process.'
                    "Use Task Manager or run '$taskKillListCommand' to verify its state."
                    "Error: $($_.Exception.Message)"
                ) -join ' '
                Write-Warning $warning
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

        if (-not ($ExpectedStartTime -is [System.DateTime])) {
            Write-Verbose "Expected process start time must be of type [System.DateTime] but got '$(Get-ObjectTypeName -Value $ExpectedStartTime)'."
            return $false
        }

        $actualStartTime = Get-ProcessStartTimeOrNull -Process $Process
        if ($null -eq $actualStartTime) {
            Write-Verbose 'Could not read process start time before taskkill.'
            return $false
        }

        # TotalMilliseconds is a double; keep that precision for the tolerance
        # comparison instead of rounding to whole milliseconds. The absolute
        # difference absorbs Windows timer-resolution variance between process
        # metadata snapshots.
        $startTimeDifferenceAbsoluteMilliseconds = [Math]::Abs(($actualStartTime - $ExpectedStartTime).TotalMilliseconds)
        if ($startTimeDifferenceAbsoluteMilliseconds -gt $ProcessStartTimeTolerance.TotalMilliseconds) {
            Write-Verbose "Process start time changed by $startTimeDifferenceAbsoluteMilliseconds ms, which exceeds the $($ProcessStartTimeTolerance.TotalMilliseconds) ms tolerance."
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

function Get-TaskListDiagnosticCommand {
    param([int]$ProcessId = $InvalidProcessIdSentinel)

    if ($ProcessId -ge $MinimumValidProcessId) {
        return "tasklist /FI `"PID eq $ProcessId`""
    }

    return 'tasklist.exe'
}

function Get-TaskKillDiagnosticCommand {
    param([int]$ProcessId = $InvalidProcessIdSentinel)

    if ($ProcessId -ge $MinimumValidProcessId) {
        $processIdText = [string]$ProcessId
    }
    else {
        $processIdText = '<PID>'
    }

    return "taskkill $TaskKillForceSwitch $TaskKillProcessIdSwitch $processIdText $TaskKillTerminateTreeSwitch"
}

function Write-TaskKillFailureWarning {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryName,
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [int]$ProcessId = 0,
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

    $taskListCommand = Get-TaskListDiagnosticCommand -ProcessId $ProcessId
    $taskKillCommand = Get-TaskKillDiagnosticCommand -ProcessId $ProcessId
    $manualTaskKillAdvice = "If the process is still running, verify it with Task Manager or run '$taskListCommand', or run '$taskKillCommand' manually."
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
        throw "Manifest field '$Name' contains characters that are unsafe for package filenames. Only letters, digits, dots, underscores, plus signs, and hyphens are allowed. Value: '$safeValue'. Manifest: $ManifestPath"
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

    if ($Value.Contains($GlobalPackageFileNameDelimiter)) {
        throw "Manifest field '$Name' must not contain the global package filename delimiter '$GlobalPackageFileNameDelimiter'. Value: '$safeValue'. Manifest: $ManifestPath"
    }
}

function Get-RequiredManifestText {
    <#
    .SYNOPSIS
    Reads a required string field from an OMP component manifest.

    .DESCRIPTION
    Validates that the requested manifest property exists, is non-empty, and is
    safe to use as part of the expected universal package filename.
    #>
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

# WaitForExit expects a 32-bit millisecond value. Validate timeout input before
# path setup creates output/log directories, so invalid parameters fail fast.
try {
    $perRepositoryTimeoutMilliseconds = Convert-SecondsToIntMilliseconds `
        -TimeoutDescription 'PerRepositoryTimeoutSeconds' `
        -Seconds $PerRepositoryTimeoutSeconds
}
catch {
    throw "Invalid timeout value for PerRepositoryTimeoutSeconds parameter: $($_.Exception.Message)"
}

$scriptDirectory = Get-ScriptDirectory
# This script is intentionally kept in scripts/omp, so ..\.. is the repository
# root for every OMP-compatible repository that carries the shared wrappers.
$scriptDirectoryLeaf = Split-Path -Leaf $scriptDirectory
$scriptParentDirectory = Split-Path -Parent $scriptDirectory
$scriptParentDirectoryLeaf = Split-Path -Leaf $scriptParentDirectory
if (-not [string]::Equals($scriptDirectoryLeaf, 'omp', [StringComparison]::OrdinalIgnoreCase) -or
    -not [string]::Equals($scriptParentDirectoryLeaf, 'scripts', [StringComparison]::OrdinalIgnoreCase)) {
    throw "$CurrentScriptDisplayName must be run from its shared scripts/omp location. Actual script directory: $scriptDirectory"
}

$currentRepositoryRoot = Resolve-FullPathSafely -Name 'current repository root' -Path $RepositoryRootRelativePath -BasePath $scriptDirectory
$currentRepositoryMarkerPath = Join-Path $currentRepositoryRoot $ManifestRelativePath
if (-not (Test-Path -LiteralPath $currentRepositoryMarkerPath -PathType Leaf)) {
    throw "Resolved repository root '$currentRepositoryRoot' does not contain $ManifestRelativePath. $CurrentScriptDisplayName assumes it is stored below scripts/omp."
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
# Resolve once before the repository loop; cmd.exe is a host-level dependency
# and does not vary per repository, while resolving it repeatedly would only add
# noise to the per-repository validation path.
$cmdExePath = Resolve-CmdExePath
# The 'N' GUID format is 32 hexadecimal characters without hyphens, which gives
# enough uniqueness for concurrent validation runs while keeping log paths
# shorter. The run id is not a security boundary. Keep -LogRoot in a
# user-private temp folder, an ACL-protected workspace folder, or another
# location where other local users cannot read build output that may include
# paths, environment-derived diagnostics, or package validation details.
# A GUID collision is not handled with a retry because the generated directory
# lives below a caller-controlled log root and the collision probability is
# negligible for this validation script.
$runId = [Guid]::NewGuid().ToString($GuidFormatNoHyphens)
$runLogRootPath = Join-Path $logRootPath $runId
New-DirectorySafely -Path $runLogRootPath -Description 'run log directory'
# Log directories are intentionally retained for failed-run diagnostics. Remove
# old $ValidationDirectoryName log folders manually or point -LogRoot at a
# disposable location when running frequent local validation loops.

if ($repositoryNames.Count -gt 0) {
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
    $commandWrapperDisplayName = 'command wrapper'
}

if ($repositories.Count -eq 0) {
    throw "No OMP-compatible repositories found below $workspaceRootPath. Each repository must contain $ManifestRelativePath and $CommandWrapperRelativePath."
}

# Validation results are assembled as PSCustomObjects in several branches. Each
# result has Repository, Status, ExitCode, Package, StdoutLog, StderrLog, and
# Detail properties; a generic object list keeps append behavior efficient
# without defining a custom class for this script-only report.
$results = [System.Collections.Generic.List[object]]::new()

foreach ($repository in $repositories) {
    $repositoryName = $repository.Name
    $manifestPath = Join-Path $repository.FullName $ManifestRelativePath
    $cmdPath = Join-Path $repository.FullName $CommandWrapperRelativePath

    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        $results.Add((New-ValidationResult `
            -Repository $repositoryName `
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
            -Repository $repositoryName `
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
        # Keep -Encoding UTF8 for Windows PowerShell 5.1 compatibility. The OMP
        # repository tooling writes component manifests as UTF-8 JSON, with or
        # without BOM depending on the writer. Windows PowerShell 5.1 treats
        # UTF8 writes differently from PowerShell 6+, but reads both BOM and
        # non-BOM UTF-8 manifests correctly here. Avoid the literal utf8NoBOM
        # -Encoding name because Windows PowerShell 5.1's Get-Content
        # -Encoding parameter does not support that value. -Raw is required so
        # ConvertFrom-Json receives the whole manifest as one string instead of
        # line-by-line input from an array of strings. Component manifests are
        # small repository metadata files, so full-document loading is expected.
        $manifestJson = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
    }
    catch [System.Management.Automation.ItemNotFoundException] {
        # The file was checked above, but it can still be removed or replaced
        # between Test-Path and Get-Content.
        $results.Add((New-ValidationResult `
            -Repository $repositoryName `
            -Status 'Manifest read failed' `
            -ExitCode $null `
            -Package '' `
            -StdoutLog '' `
            -StderrLog '' `
            -Detail "Component manifest disappeared before it could be read: $manifestPath"))
        continue
    }
    catch [System.UnauthorizedAccessException] {
        $currentIdentity = Get-CurrentIdentityDiagnostic
        $manifestReadFailureDetail = @(
            "Could not read component manifest '$manifestPath' because access was denied for '$currentIdentity'."
            "Check file permissions: $($_.Exception.Message)"
        ) -join ' '
        $results.Add((New-ValidationResult `
            -Repository $repositoryName `
            -Status 'Manifest read failed' `
            -ExitCode $null `
            -Package '' `
            -StdoutLog '' `
            -StderrLog '' `
            -Detail $manifestReadFailureDetail))
        continue
    }
    catch [System.IO.IOException] {
        $manifestReadFailureDetail = @(
            "Could not read component manifest '$manifestPath' because of an I/O error."
            "Verify that the file is not locked, being replaced, or on an unavailable drive: $($_.Exception.Message)"
        ) -join ' '
        $results.Add((New-ValidationResult `
            -Repository $repositoryName `
            -Status 'Manifest read failed' `
            -ExitCode $null `
            -Package '' `
            -StdoutLog '' `
            -StderrLog '' `
            -Detail $manifestReadFailureDetail))
        continue
    }
    catch {
        $currentIdentity = Get-CurrentIdentityDiagnostic
        $manifestReadFailureDetail = @(
            "Could not read component manifest '$manifestPath'."
            "Verify that the path is a filesystem file and readable by '$currentIdentity'."
            "Also verify that it is not a directory-like reparse target or blocked by another process: $($_.Exception.Message)"
        ) -join ' '
        $results.Add((New-ValidationResult `
            -Repository $repositoryName `
            -Status 'Manifest read failed' `
            -ExitCode $null `
            -Package '' `
            -StdoutLog '' `
            -StderrLog '' `
            -Detail $manifestReadFailureDetail))
        continue
    }

    try {
        $manifest = $manifestJson | ConvertFrom-Json
    }
    catch {
        $manifestExcerpt = Get-SafeDiagnosticExcerpt -Value $manifestJson
        $manifestParseDetail = @(
            "Component manifest '$manifestPath' was read but could not be parsed as JSON."
            'Common causes include missing commas, trailing commas, or unescaped quotes.'
            "First lines: $manifestExcerpt"
            "Parser message: $($_.Exception.Message)"
        ) -join [Environment]::NewLine

        $results.Add((New-ValidationResult `
            -Repository $repositoryName `
            -Status 'Manifest parse failed' `
            -ExitCode $null `
            -Package '' `
            -StdoutLog '' `
            -StderrLog '' `
            -Detail $manifestParseDetail))
        continue
    }

    try {
        $packageKey = Get-RequiredManifestText -Manifest $manifest -PropertyName 'repositoryKey' -ManifestPath $manifestPath
        $packageVersion = Get-RequiredManifestText -Manifest $manifest -PropertyName 'repositoryVersion' -ManifestPath $manifestPath
    }
    catch {
        $results.Add((New-ValidationResult `
            -Repository $repositoryName `
            -Status 'Manifest invalid' `
            -ExitCode $null `
            -Package '' `
            -StdoutLog '' `
            -StderrLog '' `
            -Detail $_.Exception.Message))
        continue
    }

    # The default command wrapper creates the repository's global package, and
    # global packages use the same __global__ naming convention as
    # export-universal-package.ps1.
    # Global package files are named repositoryKey__global__repositoryVersion.zip.
    $expectedPackageFileName = "${packageKey}${GlobalPackageFileNameDelimiter}${packageVersion}.zip"
    $expectedPackagePath = Join-Path $outputRootPath $expectedPackageFileName
    # Manifest fields are allow-listed before the filename is built, and this
    # final base-path check is kept as defense in depth against traversal if the
    # naming convention changes later.
    Assert-PathUnderBase -Path $expectedPackagePath -BasePath $outputRootPath -PathDescription 'Expected package path' -BaseDescription 'output root'
    Remove-ExistingFileSafely -Path $expectedPackagePath -Description 'expected package'

    # Keep the sanitized name for human-readable logs and the path hash for
    # uniqueness when different workspace roots contain same-named repositories.
    $safeRepositoryName = Get-SafeFileName -Value $repositoryName
    $repoPathHash = Get-ShortStableHash -Value $repository.FullName
    $safeName = "$safeRepositoryName-$repoPathHash"
    $stdoutPath = Join-Path $runLogRootPath "$safeName$StdoutLogExtension"
    $stderrPath = Join-Path $runLogRootPath "$safeName$StderrLogExtension"
    Assert-PathUnderBase -Path $stdoutPath -BasePath $runLogRootPath -PathDescription 'stdout log path' -BaseDescription 'run log root'
    Assert-PathUnderBase -Path $stderrPath -BasePath $runLogRootPath -PathDescription 'stderr log path' -BaseDescription 'run log root'
    Remove-ExistingFileSafely -Path $stdoutPath -Description 'stdout log'
    Remove-ExistingFileSafely -Path $stderrPath -Description 'stderr log'

    # This script is a manual/CI validation command, not an importable module.
    # Write-Host keeps progress visible even when the table output is captured;
    # Write-Information is hidden by default in Windows PowerShell 5.1 unless
    # callers remember to set InformationAction/InformationPreference.
    Write-Host "[$repositoryName] Running $commandWrapperDisplayName (timeout: $PerRepositoryTimeoutSeconds seconds)..."

    # --no-pause is a CMD-wrapper flag; the wrapper removes it before invoking
    # the underlying PowerShell script. call ensures the invoked .cmd file
    # returns control to this cmd.exe instance when it is run through /c. The
    # wrapper path and arguments are escaped first, then prefixed with the cmd.exe
    # built-in keyword.
    Assert-SafeCmdArgumentText -Name 'Command wrapper path' -Value $cmdPath
    # Join-CmdCommandLine validates every argument immediately before quoting,
    # including the immutable output root path.
    $wrapperArguments = @($cmdPath, '--no-pause', '-OutputDirectory', $outputRootPath)
    $joinedWrapperArguments = Join-CmdCommandLine -Arguments $wrapperArguments
    $cmdInvocation = "$CmdCallKeyword $joinedWrapperArguments"
    Assert-CmdCommandLineLength -CommandLine $cmdInvocation
    # /d disables cmd.exe AutoRun hooks and /c runs the wrapper then exits.
    $cmdArguments = @('/d', '/c', $cmdInvocation)
    # Display-only diagnostic text. Do not feed this back into cmd.exe; actual
    # execution uses ArgumentList above so arguments stay separated.
    $cmdArgumentDiagnosticOnlyText = $cmdArguments -join ' '
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
        Write-Warning "[$repositoryName] Failed to start CMD wrapper: $startError"
        $startFailureDetail = @(
            "Process start failed. Command: $cmdExePath $cmdArgumentDiagnosticOnlyText"
            'Stdout/stderr log files may not exist if cmd.exe could not start or if a redirected log path was locked.'
            $startError
        ) -join [Environment]::NewLine

        $results.Add((New-ValidationResult `
            -Repository $repositoryName `
            -Status 'Start failed' `
            -ExitCode $null `
            -Package $expectedPackagePath `
            -StdoutLog $stdoutPath `
            -StderrLog $stderrPath `
            -Detail $startFailureDetail))
        continue
    }

    try {
        # Timeout handling stays inline because it updates the per-repository
        # validation result, log paths, process identity diagnostics, and final
        # package inspection in one flow. Extracting it would require a wide
        # parameter object without making the operational logic safer.
        $processTimedOut = -not $process.WaitForExit($perRepositoryTimeoutMilliseconds)
        if ($processTimedOut) {
            # The process can exit between timeout detection and the following
            # state reads. Every termination branch refreshes the Process object
            # and treats "already exited" as a successful no-op.
            $processId = Get-ValidProcessIdOrNull -Process $process
            if ($null -eq $processId) {
                $processIdText = '<unknown>'
            }
            else {
                $processIdText = [string]$processId
            }
            Write-Warning "[$repositoryName] Timeout reached after $PerRepositoryTimeoutSeconds seconds. Terminating process tree for PID $processIdText."
            $process.Refresh()
            if ($process.HasExited) {
                Write-Warning "[$repositoryName] Process exited after the timeout was detected; taskkill was not needed."
            }
            elseif ($null -eq $processId) {
                Write-Warning "[$repositoryName] Process PID could not be read or was invalid; taskkill was not attempted. Current identity: $(Get-ProcessIdentityDiagnostic -Process $process)."
            }
            elseif (-not (Test-ExpectedCmdProcess -Process $process -ExpectedStartTime $processStartTime)) {
                Write-Warning "[$repositoryName] Timed-out process is no longer the expected cmd.exe instance; taskkill was not attempted. Current identity: $(Get-ProcessIdentityDiagnostic -Process $process)."
            }
            else {
                $taskKillAttempted = $false
                $taskKillOutput = @()
                $taskKillExitCode = $TaskKillExecutionExceptionExitCode
                try {
                    $process.Refresh()
                    if ($process.HasExited) {
                        Write-Warning "[$repositoryName] Process exited immediately before taskkill; termination was not needed."
                    }
                    elseif (-not (Test-ExpectedCmdProcess -Process $process -ExpectedStartTime $processStartTime)) {
                        Write-Warning "[$repositoryName] Process identity changed immediately before taskkill; termination was not attempted. Current identity: $(Get-ProcessIdentityDiagnostic -Process $process)."
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
                    Write-TaskKillFailureWarning -RepositoryName $repositoryName -ExitCode $taskKillExitCode -ProcessId $processId -Output @($taskKillOutput)
                }

                $process.Refresh()
                if ($process.HasExited) {
                    Write-Verbose "[$repositoryName] Process exited after termination attempt."
                }
                elseif (-not $process.WaitForExit($PostTerminationWaitMilliseconds)) {
                    Write-Warning "[$repositoryName] Process did not exit within $PostTerminationWaitSeconds seconds after termination attempt; exit code may be unavailable."
                    try {
                        $process.Refresh()
                        if ($process.HasExited) {
                            Write-Warning "[$repositoryName] Process exited immediately before direct Process.Kill(); no further termination was needed."
                        }
                        elseif (-not (Test-ExpectedCmdProcess -Process $process -ExpectedStartTime $processStartTime)) {
                            Write-Warning "[$repositoryName] Process identity changed immediately before direct Process.Kill(); termination was not attempted. Current identity: $(Get-ProcessIdentityDiagnostic -Process $process)."
                        }
                        else {
                            # The process can still exit between HasExited and
                            # Kill(); the catch below treats that race as a
                            # diagnostic warning instead of a script failure.
                            $process.Kill()
                        }

                        if (-not $process.WaitForExit($DirectProcessKillWaitMilliseconds)) {
                            $taskListProcessId = if ($null -ne $processId) { $processId } else { $InvalidProcessIdSentinel }
                            $taskListCommand = Get-TaskListDiagnosticCommand -ProcessId $taskListProcessId
                            Write-Warning "[$repositoryName] Process with PID $processIdText still did not exit after direct Process.Kill(). Use Task Manager or run '$taskListCommand' to verify the process tree has terminated before rerunning package validation."
                        }
                    }
                    catch {
                        $killError = $_.Exception.Message
                        try {
                            $process.Refresh()
                            if ($process.HasExited) {
                                Write-Warning "[$repositoryName] Direct Process.Kill() raced with natural process exit; no further termination was needed. Original error: $killError"
                            }
                            else {
                                Write-Warning "[$repositoryName] Direct Process.Kill() after timeout failed while the process still appeared to be running: $killError"
                            }
                        }
                        catch {
                            Write-Warning "[$repositoryName] Direct Process.Kill() after timeout failed and the final process state could not be inspected: $killError"
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
            # The timeout-based WaitForExit overload can return before all
            # process bookkeeping has been observed. The parameterless overload
            # returns immediately for an exited process and lets .NET finish its
            # final stream/handle bookkeeping without adding another timeout.
            $process.WaitForExit()
        }

        $exitCode = Get-ProcessExitCodeOrNull -Process $process
        $packageValidation = Test-PackageCreated -Path $expectedPackagePath
        $status = if ($processTimedOut) {
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
            -Repository $repositoryName `
            -Status $status `
            -ExitCode $exitCode `
            -Package $expectedPackagePath `
            -StdoutLog $stdoutPath `
            -StderrLog $stderrPath `
            -Detail $packageValidation.Message))

        # Keep final per-repository status visible for the same manual/CI
        # progress reason as the "Running ..." message above.
        Write-Host "[$repositoryName] $status"
    }
    finally {
        if ($null -ne $process) {
            $process.Dispose()
        }
    }
}

$results | Format-Table $ValidationSummaryColumns -AutoSize

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
