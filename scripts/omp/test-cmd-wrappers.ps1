<#
.SYNOPSIS
Validates Open Module Platform (OMP) repository command wrappers with configurable per-repository timeouts.

.DESCRIPTION
Runs the wrapper specified by -CommandWrapperRelativePath in noninteractive mode
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
PerRepositoryTimeoutSeconds is deliberately bounded so parameter validation
fails before any repository process starts when the value is outside the
documented validation range.

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
Maximum validation time per repository. The value must be between 60 and 3600
seconds, inclusive. The upper bound of 3600 seconds (1 hour) is enforced by
ValidateRange and the default is 1200 seconds (20 minutes). The lower bound of
60 seconds avoids premature timeout failures during minimal dependency restore
and validation startup work on slower Windows runners.

.EXAMPLE
.\scripts\omp\test-cmd-wrappers.ps1 -RepositoryName OpenModulePlatform

Validates the current OpenModulePlatform repository wrapper and writes packages
and logs below the default user-temp validation folders.
#>
[CmdletBinding()]
param(
    [string]$WorkspaceRoot = '',
    [string[]]$RepositoryName = @(),
    [string]$ManifestRelativePath = 'omp-components.json',
    [string]$CommandWrapperRelativePath = 'scripts/omp/build-universal-package.cmd',
    [string]$OutputRoot = '',
    [string]$LogRoot = '',
    # Allow at least 60 seconds for minimal validation startup work, and cap the maximum at
    # 3600 seconds (1 hour) so CI/manual validation stays bounded. ValidateRange
    # requires literal values in a Windows PowerShell 5.1 script parameter block,
    # so the accepted range is repeated here and in the parameter help above.
    # These literal values cannot be replaced by constants in Windows PowerShell
    # 5.1 ValidateRange attributes.
    [ValidateRange(60, 3600)]
    [int]$PerRepositoryTimeoutSeconds = 1200
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-CurrentScriptDisplayName {
    if ([string]::IsNullOrWhiteSpace($PSCommandPath)) {
        return 'this script'
    }

    return Split-Path -Leaf $PSCommandPath
}

$CurrentScriptDisplayName = Get-CurrentScriptDisplayName

$SafeFileNamePattern = '[^-A-Za-z0-9._]+'
# Plus signs are allowed because repository versions can use SemVer build
# metadata. These identity parts are used only for local package filenames and
# are not embedded in URLs by this validation script.
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
# CRLF must be listed first so the regex consumes Windows line endings as one
# separator. The remaining alternatives cover LF-only, CR-only, and mixed text.
$LineBreakPattern = '\r\n|\n|\r'
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
# Keep at least a few characters before the truncation indicator so shortened
# diagnostics remain useful if the maximum length is changed later.
$MinimumDiagnosticPrefixLength = 8
# Component manifests are small metadata files. A larger file almost certainly
# means the caller pointed -ManifestRelativePath at the wrong file, so fail
# before ReadAllText can allocate a large string.
$MaximumManifestFileLengthBytes = 1MB
# JSON parse diagnostics include a small excerpt. If a manifest is above this
# threshold but still below the hard cap, add an explicit size hint to the parse
# error so operators know the selected file is unusually large for OMP metadata.
$LargeManifestDiagnosticThresholdBytes = 100KB
$TruncationIndicator = '...'
$MillisecondsPerSecond = 1000
# The shared wrappers are intentionally stored at scripts/omp/test-cmd-wrappers.ps1.
# Validate this relative path during startup so moving the script fails loudly.
$RepositoryRootRelativePath = Join-Path '..' '..'
# Store the theoretical .NET API limit separately because WaitForExit(int)
# accepts a signed Int32 millisecond value. The practical wrapper timeout is
# much lower and is constrained by the PerRepositoryTimeoutSeconds parameter.
$MaximumWaitForExitMilliseconds = [int]::MaxValue
# Floor gives the largest whole-second value that can round-trip through
# WaitForExit(int milliseconds) without overflowing after conversion back to
# milliseconds. This is about 24.855 days and is the single computed source of
# truth for the ValidateRange literal below.
$MaximumSafeSecondsForMillisecondConversion = [int][Math]::Floor($MaximumWaitForExitMilliseconds / $MillisecondsPerSecond)
# ValidateRange attributes in Windows PowerShell 5.1 cannot reference variables.
# Keep this named constant as the single documented literal value and assert
# below that the computed WaitForExit limit still matches it.
# [int]::MaxValue is 2147483647; 2147483647 / 1000 = 2147483.647,
# and floor(2147483.647) gives the literal 2147483 used by ValidateRange
# below. That value is about 24.855 days, far above the public wrapper timeout
# limit but still important for internal WaitForExit-compatible conversions.
$ValidateRangeLiteralForMaximumSafeSeconds = 2147483
$Win32ErrorAccessDenied = 5

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
$StdoutLogExtension = '.stdout.log'
$StderrLogExtension = '.stderr.log'
$GuidFormatNoHyphens = 'N'
$RunLogDirectoryCreationAttempts = 5
# The final table is intentionally compact. New-ValidationResult also carries
# StdoutLog, StderrLog, and Detail for callers that capture the returned objects.
$ValidationSummaryColumns = @('Repository', 'Status', 'ExitCode', 'Package')
# Windows can round Process.StartTime differently between the original Process
# handle and a refreshed lookup because process metadata is exposed through
# Windows/.NET snapshots with scheduler and timer-resolution limits. 100 ms is
# intentionally far above normal tick variance while still small enough to catch
# a different process after PID reuse.
$ProcessStartTimeToleranceMilliseconds = 100
# This startup guard intentionally protects future edits to the script-level
# constants. It keeps later truncation logic simple and avoids defensive math in
# hot diagnostic paths.
function Assert-ValidateRangeLiteralMatches {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralName,
        [Parameter(Mandatory = $true)][int]$LiteralValue,
        [Parameter(Mandatory = $true)][string]$ComputedName,
        [Parameter(Mandatory = $true)][int]$ComputedValue
    )

    if ($LiteralValue -ne $ComputedValue) {
        throw "ValidateRange literal mismatch for $LiteralName. Actual literal: $LiteralValue. Expected computed ${ComputedName}: $ComputedValue."
    }
}

function Assert-DiagnosticConstantsValid {
    if ($MaximumDiagnosticTextLength -le $TruncationIndicator.Length) {
        $message = @(
            'MaximumDiagnosticTextLength must be greater than the truncation indicator length.'
            "MaximumDiagnosticTextLength=$MaximumDiagnosticTextLength."
            "TruncationIndicatorLength=$($TruncationIndicator.Length)."
        ) -join ' '
        throw $message
    }

    if (($MaximumDiagnosticTextLength - $TruncationIndicator.Length) -lt $MinimumDiagnosticPrefixLength) {
        $message = @(
            'MaximumDiagnosticTextLength must leave a meaningful prefix before the truncation indicator.'
            "MinimumDiagnosticPrefixLength=$MinimumDiagnosticPrefixLength."
            "MaximumDiagnosticTextLength=$MaximumDiagnosticTextLength."
            "TruncationIndicatorLength=$($TruncationIndicator.Length)."
        ) -join ' '
        throw $message
    }

    if ($HashPrefixLength -lt 1 -or $HashPrefixLength -gt $Sha256HexLength) {
        throw "HashPrefixLength must be between 1 and Sha256HexLength. HashPrefixLength=$HashPrefixLength, Sha256HexLength=$Sha256HexLength."
    }
}

# Keep one startup function for diagnostic-only constants so the intent remains
# visible without mixing these checks with process execution logic below.
Assert-DiagnosticConstantsValid

# Keep both assertions separate on purpose: one validates the literal directly
# against the independent [int]::MaxValue calculation, and the other validates
# the named alias used by conversion logic. If either path drifts, fail at
# startup before any child process is started.
Assert-ValidateRangeLiteralMatches `
    -LiteralName 'ValidateRangeLiteralForMaximumSafeSeconds' `
    -LiteralValue $ValidateRangeLiteralForMaximumSafeSeconds `
    -ComputedName 'MaximumSafeSecondsForMillisecondConversion' `
    -ComputedValue $MaximumSafeSecondsForMillisecondConversion

function Convert-SecondsToIntMilliseconds {
    <#
    .SYNOPSIS
    Converts a timeout from whole seconds to WaitForExit-compatible milliseconds.

    .DESCRIPTION
    Process.WaitForExit(int) accepts a signed Int32 millisecond value. This
    helper validates second-based timeout values before multiplying them so
    future timeout constants cannot overflow during conversion.

    .PARAMETER TimeoutDescription
    Human-readable timeout name used in validation errors.

    .PARAMETER Seconds
    Whole-second timeout value to convert.

    .NOTES
    Windows PowerShell 5.1 requires literal values in ValidateRange attributes.
    Keep the upper-bound literal synchronized with
    $ValidateRangeLiteralForMaximumSafeSeconds; startup asserts that the literal
    still equals floor([int]::MaxValue / 1000). The lower bound is 1 because
    this helper also validates short internal process-cleanup timeouts; the
    public PerRepositoryTimeoutSeconds parameter enforces its own 60-second
    minimum before repository validation starts.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$TimeoutDescription,
        # SYNC-WITH: $ValidateRangeLiteralForMaximumSafeSeconds. The literal
        # 2147483 is floor([int]::MaxValue / 1000), approximately 24.855 days.
        # 2147483 is the literal form of
        # $ValidateRangeLiteralForMaximumSafeSeconds because Windows PowerShell
        # 5.1 does not allow constants in ValidateRange attributes.
        # ValidateRange requires a literal value in Windows PowerShell 5.1.
        [ValidateRange(1, 2147483)] # ~24.855 days; prevents WaitForExit(int) overflow.
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

function Convert-NamedTimeoutsToMilliseconds {
    <#
    .SYNOPSIS
    Converts named built-in timeout definitions to WaitForExit millisecond values.

    .DESCRIPTION
    Keeping built-in timeout conversion in a small loop avoids copy/paste drift
    while still assigning the resulting named values explicitly at the call site.
    #>
    param([Parameter(Mandatory = $true)][hashtable[]]$Timeouts)

    $converted = @{}
    foreach ($timeout in $Timeouts) {
        $targetName = [string]$timeout.TargetName
        $description = [string]$timeout.Description
        $seconds = [int]$timeout.Seconds
        if ([string]::IsNullOrWhiteSpace($targetName)) {
            throw 'Built-in timeout target name is required.'
        }

        if ([string]::IsNullOrWhiteSpace($description)) {
            throw "Built-in timeout description is required for target '$targetName'."
        }

        $converted[$targetName] = Convert-SecondsToIntMilliseconds `
            -TimeoutDescription $description `
            -Seconds $seconds
    }

    return $converted
}

function Get-SafeDiagnosticText {
    <#
    .SYNOPSIS
    Converts diagnostic text into a short, control-character-safe string.

    .DESCRIPTION
    Returns '<null>' for null input, preserves empty strings, replaces ASCII
    control characters, and truncates overly long values with an indicator.
    #>
    param([AllowEmptyString()][string]$Value)

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
        [AllowEmptyString()][string]$Value,
        [int]$MaximumLines = 5
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return '<empty>'
    }

    $safeLines = [System.Collections.Generic.List[string]]::new()
    $linesProcessed = 0
    foreach ($line in ($Value -split $LineBreakPattern)) {
        if ($linesProcessed -ge $MaximumLines) {
            break
        }

        $safeLines.Add((Get-SafeDiagnosticText -Value $line))
        $linesProcessed++
    }

    return ($safeLines.ToArray() -join ' | ')
}

function Get-JsonParseLocationDiagnostic {
    param([Parameter(Mandatory = $true)][System.Exception]$Exception)

    $message = $Exception.Message
    if ([string]::IsNullOrWhiteSpace($message)) {
        return 'Parser location: not reported by this PowerShell runtime.'
    }

    $matches = [regex]::Matches($message, '(?im)\b(line|position)\s+(\d+)\b')
    if ($matches.Count -eq 0) {
        return 'Parser location: not reported by this PowerShell runtime.'
    }

    $parts = [System.Collections.Generic.List[string]]::new()
    foreach ($match in $matches) {
        $parts.Add("$($match.Groups[1].Value): $($match.Groups[2].Value)")
    }

    return "Parser location: $($parts.ToArray() -join ', ')."
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
    $builtInWaitTimeouts = @(
        @{ TargetName = 'PostTerminationWaitMilliseconds'; Description = 'Post-termination wait timeout'; Seconds = $PostTerminationWaitSeconds }
        @{ TargetName = 'TaskKillWaitMilliseconds'; Description = 'taskkill.exe wait timeout'; Seconds = $TaskKillWaitSeconds }
        @{ TargetName = 'TaskKillPostTerminationWaitMilliseconds'; Description = 'taskkill.exe post-termination wait timeout'; Seconds = $TaskKillPostTerminationWaitSeconds }
        @{ TargetName = 'TaskKillStreamReadWaitMilliseconds'; Description = 'taskkill.exe stream-read wait timeout'; Seconds = $TaskKillStreamReadWaitSeconds }
        @{ TargetName = 'DirectProcessKillWaitMilliseconds'; Description = 'direct Process.Kill wait timeout'; Seconds = $DirectProcessKillWaitSeconds }
    )
    $convertedBuiltInWaitTimeouts = Convert-NamedTimeoutsToMilliseconds -Timeouts $builtInWaitTimeouts
    $PostTerminationWaitMilliseconds = $convertedBuiltInWaitTimeouts['PostTerminationWaitMilliseconds']
    $TaskKillWaitMilliseconds = $convertedBuiltInWaitTimeouts['TaskKillWaitMilliseconds']
    $TaskKillPostTerminationWaitMilliseconds = $convertedBuiltInWaitTimeouts['TaskKillPostTerminationWaitMilliseconds']
    $TaskKillStreamReadWaitMilliseconds = $convertedBuiltInWaitTimeouts['TaskKillStreamReadWaitMilliseconds']
    $DirectProcessKillWaitMilliseconds = $convertedBuiltInWaitTimeouts['DirectProcessKillWaitMilliseconds']
}
catch {
    throw "Invalid built-in process wait timeout in ${CurrentScriptDisplayName}: $($_.Exception.Message)"
}

function Get-ScriptDirectory {
    <#
    .SYNOPSIS
    Resolves the directory that contains this script.

    .DESCRIPTION
    Uses $PSScriptRoot during normal script execution and falls back to
    $PSCommandPath for unusual hosts that expose the script path but not the
    script root.
    #>
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

            $providerPath = $currentLocation.ProviderPath
            if ([string]::IsNullOrWhiteSpace($providerPath)) {
                $message = @(
                    'Current PowerShell location is a FileSystem provider location, but ProviderPath was empty.'
                    "Current path: $($currentLocation.Path)."
                    'Provide an explicit BasePath parameter, or use Set-Location to switch to a concrete filesystem directory.'
                ) -join ' '
                throw $message
            }

            $providerPath
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
    <#
    .SYNOPSIS
    Creates a directory with a descriptive error message.

    .PARAMETER Path
    Directory path to create.

    .PARAMETER Description
    Human-readable directory role used in error messages.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Description
    )

    try {
        # Suppress the returned DirectoryInfo; callers only need success/failure.
        [void][System.IO.Directory]::CreateDirectory($Path)
    }
    catch {
        throw "Could not create $Description '$Path': $($_.Exception.Message)"
    }
}

function New-RunLogDirectory {
    <#
    .SYNOPSIS
    Creates a unique run log directory below the selected log root.

    .DESCRIPTION
    Uses a GUID-based directory name and retries a small number of times to
    handle extremely rare collisions or concurrent validation runs.
    #>
    param([Parameter(Mandatory = $true)][string]$LogRootPath)

    for ($attempt = 1; $attempt -le $RunLogDirectoryCreationAttempts; $attempt++) {
        $runId = [Guid]::NewGuid().ToString($GuidFormatNoHyphens)
        $candidate = Join-Path $LogRootPath $runId
        if (Test-Path -LiteralPath $candidate) {
            continue
        }

        New-DirectorySafely -Path $candidate -Description 'run log directory'
        return $candidate
    }

    throw "Could not create a unique run log directory below '$LogRootPath' after $RunLogDirectoryCreationAttempts attempt(s). This may indicate filesystem latency, permission problems, or concurrent validation runs against the same log root. Verify that the log root is accessible and not a slow or unstable network location."
}

function Test-IsSubPath {
    <#
    .SYNOPSIS
    Checks whether a path is equal to or contained under a base path.

    .PARAMETER Path
    Candidate path to validate.

    .PARAMETER BasePath
    Base path that must contain the candidate path.

    .NOTES
    Paths are normalized to Windows directory separators and compared with
    OrdinalIgnoreCase to match normal Windows filesystem behavior for local
    drives and UNC paths.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    # This helper is used for low-volume boundary checks around repository and
    # output paths. Keep full resolution local to the helper so every call is a
    # complete containment check instead of relying on caller-side cache state.
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
    # Startup validation keeps HashPrefixLength within the fixed SHA256 hex
    # length, so this hot path can take the configured prefix directly.
    $hashText = [BitConverter]::ToString($hashBytes).Replace('-', '').ToLowerInvariant()
    return $hashText.Substring(0, $HashPrefixLength)
}

function Get-SafeFileName {
    param([Parameter(Mandatory = $true)][object]$Value)

    # Keep log filenames portable across Windows shells and filesystems.
    $safe = ([string]$Value) -replace $SafeFileNamePattern, '-'
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
    <#
    .SYNOPSIS
    Escapes and quotes one argument for the generated cmd.exe command line.

    .NOTES
    This helper expects raw, unescaped input. Feeding it already cmd-escaped
    text is intentionally unsupported because double escaping can change the
    literal value received by the child process. cmd.exe treats ^ as its escape
    character; ^^ emits one literal caret. Carets are escaped before quoting so
    a literal caret cannot alter parsing of the generated command line, including
    quoted edge cases. The script invokes cmd.exe without /v:on, so delayed !
    expansion is not active; AutoRun hooks are disabled later with /d.
    #>
    param([Parameter(Mandatory = $true)][string]$Value)

    # This helper only supports the argument shapes generated below; reject
    # characters that cmd.exe can reinterpret instead of attempting lossy escaping.
    # In particular, double quotes are rejected before quoting; keep that
    # pre-validation if this helper ever gains new callers.
    Assert-SafeCmdArgumentText -Name 'cmd wrapper argument' -Value $Value

    # Escape carets for cmd.exe parsing. The quoting pattern includes ^, so a
    # caret escaped to ^^ is still forced into a quoted argument below.
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
    # The filename check is authoritative. The extension check is kept as a
    # narrow defense-in-depth assertion so odd provider/path behavior cannot
    # silently broaden this validator beyond cmd.exe.
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
    catch [System.InvalidOperationException] {
        Write-Verbose "Could not read process start time because the process has exited or is not associated with a local process: $($_.Exception.Message)"
        return $null
    }
    catch [System.ComponentModel.Win32Exception] {
        Write-Verbose "Could not read process start time because Windows denied access or process metadata was unavailable: $($_.Exception.Message)"
        return $null
    }
    catch {
        Write-Verbose "Could not read process start time ($($_.Exception.GetType().FullName)): $($_.Exception.Message)"
        return $null
    }
}

function Get-ObjectTypeName {
    param([object]$Value)

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
    complete later; timeout cleanup is handled by the owning process path. A
    timed-out read task may hold stream resources until the helper process exits
    or the PowerShell process unloads its AppDomain. Repeated helper stream
    timeouts could therefore temporarily retain resources. There is no reliable
    cancellation fallback for these read tasks in Windows PowerShell 5.1, so the
    script reports those timeouts explicitly and remains bounded instead of
    waiting forever.
    This is acceptable here because the tasks read independent helper-process
    streams and do not marshal continuations back to the PowerShell thread; no
    synchronization context is required for their completion.
    #>
    param(
        [Parameter(Mandatory = $true)][System.Collections.Generic.List[string]]$Output,
        [Parameter(Mandatory = $true)][object]$Task,
        [Parameter(Mandatory = $true)][string]$StreamName
    )

    try {
        # Task.Wait can surface stream read failures as AggregateException; the
        # catch below converts them into diagnostics instead of hiding them.
        # The call blocks the current PowerShell thread, but the wait has an
        # explicit millisecond timeout and is safe from synchronization-context
        # deadlocks because these tasks only read independent redirected streams
        # from taskkill.exe.
        $taskCompleted = $Task.IsCompleted -or $Task.Wait($TaskKillStreamReadWaitMilliseconds)

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
                # Purely defensive: a faulted Task should normally expose an
                # AggregateException, but keep a useful diagnostic if a runtime
                # or mocked task reports an inconsistent state.
                $taskFaultedWithoutExceptionMessage = 'Async stream read task faulted without exception information'
                $taskObjectType = Get-ObjectTypeName -Value $Task
                $errorText = "$taskFaultedWithoutExceptionMessage; TaskObjectType=$taskObjectType."
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
    $taskKillArguments = @($TaskKillProcessIdSwitch, $processIdArgument, $TaskKillTerminateTreeSwitch, $TaskKillForceSwitch)
    foreach ($argument in $taskKillArguments) {
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
                $taskKillHelperProcessId = Get-ValidProcessIdOrNull -Process $taskKillProcess
                $taskKillHelperProcessIdOrSentinel = Get-ProcessIdOrSentinel -ProcessId $taskKillHelperProcessId
                $taskKillHelperDiagnosticCommand = Get-TaskListDiagnosticCommand -ProcessId $taskKillHelperProcessIdOrSentinel
                $warning = @(
                    'Could not terminate stuck taskkill.exe helper process.'
                    "Use Task Manager or run '$taskKillHelperDiagnosticCommand' to verify its state."
                    "Error: $($_.Exception.Message)"
                ) -join ' '
                Write-Warning $warning
            }

            $output = [System.Collections.Generic.List[string]]::new()
            $output.Add("taskkill.exe did not exit within $TaskKillWaitSeconds seconds.")

            # WaitForExit uses milliseconds; diagnostics report the matching
            # script-level seconds value because operators think in seconds.
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

function Test-IsValidProcessTimestamp {
    param([Parameter(Mandatory = $true)][DateTime]$Value)

    return ($Value -ne [DateTime]::MinValue -and $Value -ne [DateTime]::MaxValue)
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

        if (-not ($ExpectedStartTime -is [DateTime])) {
            Write-Verbose "Internal process verification skipped because expected start time was not [DateTime]. Actual type: '$(Get-ObjectTypeName -Value $ExpectedStartTime)'."
            return $false
        }

        $actualStartTime = Get-ProcessStartTimeOrNull -Process $Process
        if ($null -eq $actualStartTime) {
            Write-Verbose 'Could not read process start time before taskkill.'
            return $false
        }

        if (-not (Test-IsValidProcessTimestamp -Value $actualStartTime) -or
            -not (Test-IsValidProcessTimestamp -Value $ExpectedStartTime)) {
            Write-Verbose 'Process start time comparison skipped because one timestamp was DateTime.MinValue or DateTime.MaxValue.'
            return $false
        }

        try {
            # TotalMilliseconds is a double; keep that precision for the tolerance
            # comparison instead of rounding to whole milliseconds. The absolute
            # difference absorbs Windows timer-resolution variance between process
            # metadata snapshots.
            $startTimeDifferenceMilliseconds = [Math]::Abs(($actualStartTime - $ExpectedStartTime).TotalMilliseconds)
        }
        catch [System.ArgumentOutOfRangeException] {
            # Very defensive: subtracting two DateTime values can throw if the
            # values are so far apart that the resulting TimeSpan exceeds the
            # supported range. Treat that as an identity mismatch.
            Write-Verbose "Process start time comparison exceeded the supported TimeSpan range: $($_.Exception.Message)"
            return $false
        }
        catch {
            Write-Verbose "Could not compare process start times before taskkill: $($_.Exception.Message)"
            return $false
        }

        if ($startTimeDifferenceMilliseconds -gt $ProcessStartTimeToleranceMilliseconds) {
            Write-Verbose "Process start time changed by $startTimeDifferenceMilliseconds ms, which exceeds the $ProcessStartTimeToleranceMilliseconds ms tolerance."
            return $false
        }

        return $true
    }
    catch {
        Write-Verbose "Could not verify process name before taskkill: $($_.Exception.Message)"
        return $false
    }
}

function Test-ExpectedRunningCmdProcess {
    <#
    .SYNOPSIS
    Refreshes a Process object and verifies that it is still the expected cmd.exe.

    .DESCRIPTION
    Timeout cleanup has several natural-exit race windows. This helper keeps the
    repeated Refresh/HasExited/process-identity check in one place while callers
    provide phase-specific text for the warning.
    #>
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [object]$ExpectedStartTime = $null,
        [Parameter(Mandatory = $true)][string]$RepositoryName,
        [Parameter(Mandatory = $true)][string]$Phase,
        [Parameter(Mandatory = $true)][string]$ChangedIdentityAction
    )

    $Process.Refresh()
    if ($Process.HasExited) {
        Write-Warning "[$RepositoryName] Process exited $Phase; termination was not needed."
        return $false
    }

    if (-not (Test-ExpectedCmdProcess -Process $Process -ExpectedStartTime $ExpectedStartTime)) {
        Write-Warning "[$RepositoryName] Process identity changed $Phase; $ChangedIdentityAction Current identity: $(Get-ProcessIdentityDiagnostic -Process $Process)."
        return $false
    }

    return $true
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

function Get-ProcessKillFailureReason {
    param([Parameter(Mandatory = $true)][Exception]$Exception)

    if ($Exception -is [System.InvalidOperationException]) {
        return 'Process may already have exited, or the Process object is no longer associated with a local process.'
    }

    if ($Exception -is [System.ComponentModel.Win32Exception]) {
        if ($Exception.NativeErrorCode -eq $Win32ErrorAccessDenied) {
            return 'Access denied while terminating the process.'
        }

        return "Windows process API failure. NativeErrorCode=$($Exception.NativeErrorCode)."
    }

    if ($Exception -is [System.UnauthorizedAccessException]) {
        return 'Access denied while terminating the process.'
    }

    if ($Exception -is [System.NotSupportedException]) {
        return 'The process object does not support local termination.'
    }

    return "Unexpected Process.Kill failure type: $($Exception.GetType().FullName)."
}

function Get-TaskListDiagnosticCommand {
    param([int]$ProcessId = $InvalidProcessIdSentinel)

    if ($ProcessId -ge $MinimumValidProcessId) {
        # Display-only PowerShell text. The backticks make the filter readable
        # when written from PowerShell; adjust quoting if copying the command
        # into another shell.
        return "tasklist /FI `"PID eq $ProcessId`""
    }

    return 'tasklist.exe'
}

function Get-TaskKillDiagnosticCommand {
    param([int]$ProcessId = $InvalidProcessIdSentinel)

    $processIdText = Get-ProcessIdDisplayText -ProcessId $ProcessId -Fallback '<PID>'

    return "taskkill $TaskKillForceSwitch $TaskKillProcessIdSwitch $processIdText $TaskKillTerminateTreeSwitch"
}

function Get-ProcessIdDisplayText {
    param(
        [object]$ProcessId,
        [Parameter(Mandatory = $true)][string]$Fallback
    )

    if ($null -eq $ProcessId) {
        return $Fallback
    }

    if ($ProcessId -is [int] -and $ProcessId -ge $MinimumValidProcessId) {
        return [string]$ProcessId
    }

    return $Fallback
}

function Get-ProcessIdOrSentinel {
    param([object]$ProcessId)

    if ($ProcessId -is [int] -and $ProcessId -ge $MinimumValidProcessId) {
        return $ProcessId
    }

    # Windows PowerShell 5.1 does not support the ?? null-coalescing operator,
    # so keep this helper instead of inline PowerShell 7+ syntax.
    return $InvalidProcessIdSentinel
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
        # Repository remains object-shaped because callers may pass values
        # derived from DirectoryInfo or future repository descriptors; the
        # output is normalized to string below.
        [Parameter(Mandatory = $true)][object]$Repository,
        [Parameter(Mandatory = $true)][string]$Status,
        [object]$ExitCode,
        [AllowEmptyString()][Parameter(Mandatory = $true)][string]$Package,
        [AllowEmptyString()][Parameter(Mandatory = $true)][string]$StdoutLog,
        [AllowEmptyString()][Parameter(Mandatory = $true)][string]$StderrLog,
        [string]$Detail
    )

    return [pscustomobject]@{
        Repository = [string]$Repository
        Status = [string]$Status
        ExitCode = $ExitCode
        Package = [string]$Package
        StdoutLog = [string]$StdoutLog
        StderrLog = [string]$StderrLog
        Detail = $Detail
    }
}

function Write-ValidationProgressMessage {
    <#
    .SYNOPSIS
    Writes operator-facing progress without using the success output stream.

    .DESCRIPTION
    This script returns validation objects on the success stream. Progress is
    sent to the information stream and forced visible for interactive/manual
    runs, while callers can still redirect or suppress it with standard
    PowerShell information-stream controls.
    #>
    param([Parameter(Mandatory = $true)][string]$Message)

    Write-Information -MessageData $Message -InformationAction Continue
}

function Get-RepositoryPath {
    param([Parameter(Mandatory = $true)][object]$Repository)

    if ($Repository -is [System.IO.DirectoryInfo]) {
        return $Repository.FullName
    }

    # Repository discovery normally yields DirectoryInfo objects. Keep this
    # string fallback for tests or future callers that pass repository-like
    # values directly into this script block.
    return [string]$Repository
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

    # Dot validation is intentionally split into explicit cases: reject every
    # run of two or more consecutive dots, a single dot, and leading/trailing
    # dots. The allow-list above already rejects slash, backslash, and colon
    # separators, so these dot checks cover the remaining traversal-like forms.
    # Ordinary version text such as '1.0.0' stays valid, but path-like or
    # shell-normalized identity text is rejected before filenames are built.
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

    if ($Value.IndexOf($GlobalPackageFileNameDelimiter, [StringComparison]::Ordinal) -ge 0) {
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
# The public PerRepositoryTimeoutSeconds parameter has its own ValidateRange,
# but this conversion helper is also used for script constants and protects
# future edits that may not pass through parameter binding.
try {
    $repositoryTimeoutMilliseconds = Convert-SecondsToIntMilliseconds `
        -TimeoutDescription 'Per-repository wrapper timeout' `
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
    # This script is Windows-only because it launches cmd.exe and taskkill.exe.
    # On normal Windows developer machines and Windows GitHub-hosted runners,
    # GetTempPath() resolves to a user-specific temp folder. Pass -OutputRoot
    # explicitly when validating packages that should not be written to temp
    # storage.
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
# Retry a few times in the extremely unlikely event that concurrent validation
# runs produce the same GUID-named log directory below the same -LogRoot.
$runLogRootPath = New-RunLogDirectory -LogRootPath $logRootPath
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
                $candidateManifestPath = Join-Path $_.FullName $ManifestRelativePath
                $candidateWrapperPath = Join-Path $_.FullName $CommandWrapperRelativePath
                (Test-Path -LiteralPath $candidateManifestPath -PathType Leaf) -and
                    (Test-Path -LiteralPath $candidateWrapperPath -PathType Leaf)
            } |
            Sort-Object Name
    )
}

$commandWrapperDisplayName = Split-Path -Leaf $CommandWrapperRelativePath
if ([string]::IsNullOrWhiteSpace($commandWrapperDisplayName)) {
    # Display-only fallback for edge-case paths such as a trailing separator.
    # The actual wrapper path is validated separately before execution.
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
    $repositoryPath = Get-RepositoryPath -Repository $repository
    $repositoryName = Split-Path -Leaf $repositoryPath
    $manifestPath = Join-Path $repositoryPath $ManifestRelativePath
    $cmdPath = Join-Path $repositoryPath $CommandWrapperRelativePath

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

    Assert-RepositoryPathUnderWorkspace -RepositoryPath $repositoryPath -WorkspaceRootPath $workspaceRootPath

    $manifestFileLengthBytes = $null
    try {
        $manifestItem = Get-Item -LiteralPath $manifestPath -ErrorAction Stop
        if ($manifestItem -isnot [System.IO.FileInfo]) {
            throw [System.IO.InvalidDataException]::new("Component manifest path is not a regular file: $manifestPath")
        }

        $manifestFileLengthBytes = $manifestItem.Length
        if ($manifestFileLengthBytes -gt $MaximumManifestFileLengthBytes) {
            $maximumManifestSizeKilobytes = [int]($MaximumManifestFileLengthBytes / 1KB)
            throw [System.IO.InvalidDataException]::new("Component manifest '$manifestPath' is $manifestFileLengthBytes bytes, which exceeds the $maximumManifestSizeKilobytes KB limit. Component manifests are small metadata files; this usually means -ManifestRelativePath selected the wrong file.")
        }

        # Use .NET UTF-8 reading instead of PowerShell's -Encoding names so BOM
        # and non-BOM UTF-8 manifests behave consistently in Windows PowerShell
        # 5.1 and newer PowerShell versions. Component manifests are capped
        # above before full-document loading so an incorrect path fails fast.
        $manifestJson = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
    }
    catch [System.Management.Automation.ItemNotFoundException] {
        # The file was checked above, but it can still be removed or replaced
        # between Test-Path and manifest metadata/read operations.
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
    catch [System.IO.PathTooLongException] {
        $manifestReadFailureDetail = @(
            "Could not read component manifest '$manifestPath' because the path is too long for this Windows/.NET runtime."
            "Shorten the workspace path or enable long-path support where appropriate: $($_.Exception.Message)"
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
    catch [System.IO.InvalidDataException] {
        $results.Add((New-ValidationResult `
            -Repository $repositoryName `
            -Status 'Manifest read failed' `
            -ExitCode $null `
            -Package '' `
            -StdoutLog '' `
            -StderrLog '' `
            -Detail $_.Exception.Message))
        continue
    }
    catch [System.IO.IOException] {
        $manifestReadFailureDetail = @(
            "Could not read component manifest '$manifestPath' because of an I/O error."
            "Verify that the file is not locked, too large for a manifest, corrupted, being replaced, or on an unavailable drive: $($_.Exception.Message)"
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
    catch [System.OutOfMemoryException] {
        $manifestReadFailureDetail = @(
            "Could not read component manifest '$manifestPath' because the process ran out of memory while loading it."
            "The script rejects manifests larger than $MaximumManifestFileLengthBytes bytes before ReadAllText; verify the file was not replaced between the size check and read operation."
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
    catch [System.Text.DecoderFallbackException] {
        $manifestReadFailureDetail = @(
            "Could not read component manifest '$manifestPath' as UTF-8 text."
            "Verify that the manifest is valid UTF-8 JSON: $($_.Exception.Message)"
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
            "Also verify that it is not a directory-like reparse target, too large for a manifest, blocked by another process, or affected by path-length limits: $($_.Exception.Message)"
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
        $manifestLocationDiagnostic = Get-JsonParseLocationDiagnostic -Exception $_.Exception
        $manifestSizeDiagnostic = if ($manifestFileLengthBytes -gt $LargeManifestDiagnosticThresholdBytes) {
            "Manifest size warning: $manifestFileLengthBytes bytes is unusually large for OMP component metadata. Verify that -ManifestRelativePath points to the repository manifest."
        }
        else {
            'Manifest size warning: none.'
        }
        $manifestParseDetail = @(
            "Component manifest '$manifestPath' was read but could not be parsed as JSON."
            "Parser message: $($_.Exception.Message)"
            $manifestLocationDiagnostic
            $manifestSizeDiagnostic
            'Common causes include missing commas, trailing commas, or unescaped quotes.'
            "First lines from manifest: $manifestExcerpt"
            'Only the first few manifest lines are shown here; inspect the full file if the parser message points beyond this excerpt.'
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
    $expectedPackageFileName = @($packageKey, $GlobalPackageFileNameDelimiter, $packageVersion, '.zip') -join ''
    $expectedPackagePath = Join-Path $outputRootPath $expectedPackageFileName
    # Manifest fields are allow-listed before the filename is built, and this
    # final base-path check is kept as defense in depth against traversal if the
    # naming convention changes later.
    Assert-PathUnderBase -Path $expectedPackagePath -BasePath $outputRootPath -PathDescription 'Expected package path' -BaseDescription 'output root'
    Remove-ExistingFileSafely -Path $expectedPackagePath -Description 'expected package'

    # Keep the sanitized name for human-readable logs and the path hash for
    # uniqueness when different workspace roots contain same-named repositories.
    $safeRepositoryName = Get-SafeFileName -Value $repositoryName
    $repoPathHash = Get-ShortStableHash -Value $repositoryPath
    $safeName = "$safeRepositoryName-$repoPathHash"
    $stdoutPath = Join-Path $runLogRootPath "$safeName$StdoutLogExtension"
    $stderrPath = Join-Path $runLogRootPath "$safeName$StderrLogExtension"
    Assert-PathUnderBase -Path $stdoutPath -BasePath $runLogRootPath -PathDescription 'stdout log path' -BaseDescription 'run log root'
    Assert-PathUnderBase -Path $stderrPath -BasePath $runLogRootPath -PathDescription 'stderr log path' -BaseDescription 'run log root'
    Remove-ExistingFileSafely -Path $stdoutPath -Description 'stdout log'
    Remove-ExistingFileSafely -Path $stderrPath -Description 'stderr log'

    # This script is a manual/CI validation command, not an importable module.
    # Use the information stream for progress so the success output stream can
    # remain reserved for validation result objects.
    Write-ValidationProgressMessage "[$repositoryName] Running $commandWrapperDisplayName (timeout: $PerRepositoryTimeoutSeconds seconds)..."

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
    # 'call' is the cmd.exe built-in keyword, not user input. Only the wrapper
    # path and arguments are escaped and quoted.
    $cmdInvocation = @('call', $joinedWrapperArguments) -join ' '
    Assert-CmdCommandLineLength -CommandLine $cmdInvocation
    # /d disables cmd.exe AutoRun hooks and /c runs the wrapper then exits.
    $cmdArguments = @('/d', '/c', $cmdInvocation)
    # Display-only diagnostic text. Do not feed this back into cmd.exe; actual
    # execution uses ArgumentList above so arguments stay separated. Keep the
    # executable path and argument list as separate labeled fields so paths with
    # spaces are readable without pretending this is a pasteable command line.
    # This joined string is intentionally not shell-safe for all cmd.exe edge
    # cases; it is only human-readable context for start-failure diagnostics.
    $cmdArgumentDiagnosticOnlyText = $cmdArguments -join ' '
    $cmdStartDiagnosticText = "FilePath='$cmdExePath'; Arguments='$cmdArgumentDiagnosticOnlyText'"
    $process = $null
    $processStartTime = $null
    try {
        # -WindowStyle Hidden keeps validation noninteractive. -NoNewWindow is
        # intentionally not used because this script redirects stdout/stderr to
        # files and should not attach child command windows to the caller.
        # Re-check immediately before process start. This is intentionally kept
        # even though the repository was validated earlier, because junctions or
        # filesystem changes between enumeration and execution should not move
        # command execution outside the intended workspace.
        Assert-RepositoryPathUnderWorkspace -RepositoryPath $repositoryPath -WorkspaceRootPath $workspaceRootPath

        $processParameters = @{
            FilePath = $cmdExePath
            ArgumentList = $cmdArguments
            WorkingDirectory = $repositoryPath
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
            "Process start failed. Diagnostic only: $cmdStartDiagnosticText"
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
        # Strategy after timeout:
        # 1. Re-check that the original cmd.exe process is still alive and is
        #    still the expected process instance.
        # 2. Ask taskkill.exe to terminate the full process tree.
        # 3. If the wrapper cmd.exe remains alive, use direct Process.Kill() as
        #    a final fallback for that wrapper process only.
        # Known race: WaitForExit(false) only says the process was still running
        # when the timeout elapsed. It can exit naturally before any later
        # Refresh(), HasExited check, or taskkill call, so every later decision
        # treats process state as a fresh best-effort snapshot.
        $processTimedOut = -not $process.WaitForExit($repositoryTimeoutMilliseconds)
        if ($processTimedOut) {
            # The process can exit immediately after the timeout result is
            # observed. Refresh before every state decision and treat "already
            # exited" as a successful no-op so this known race never becomes a
            # script failure or an unsafe taskkill attempt.
            $process.Refresh()
            $processExitedAfterTimeout = $process.HasExited
            # Phase 1: verify the original cmd.exe still exists and is still the
            # same process instance before any termination attempt.
            if ($processExitedAfterTimeout) {
                Write-Warning "[$repositoryName] Process exited after the timeout was detected; taskkill was not needed."
            }
            else {
                $processId = Get-ValidProcessIdOrNull -Process $process
                $processIdText = Get-ProcessIdDisplayText -ProcessId $processId -Fallback '<unknown>'
                Write-Warning "[$repositoryName] Timeout reached after $PerRepositoryTimeoutSeconds seconds. Terminating process tree for PID $processIdText."

                if ($null -eq $processId) {
                    Write-Warning "[$repositoryName] Process PID could not be read or was invalid; taskkill was not attempted. Current identity: $(Get-ProcessIdentityDiagnostic -Process $process)."
                }
                elseif (Test-ExpectedRunningCmdProcess `
                        -Process $process `
                        -ExpectedStartTime $processStartTime `
                        -RepositoryName $repositoryName `
                        -Phase 'after the timeout was detected' `
                        -ChangedIdentityAction 'taskkill was not attempted.') {
                    $taskKillAttempted = $false
                    $taskKillOutput = @()
                    $taskKillExitCode = $TaskKillExecutionExceptionExitCode
                    try {
                        # Phase 2: use taskkill.exe for the process tree. Do not
                        # cache identity checks; each check follows a Refresh()
                        # because the process can exit or change state between
                        # timeout handling steps. Windows process termination is
                        # asynchronous, so this is best-effort safety rather
                        # than an atomic guarantee.
                        if (Test-ExpectedRunningCmdProcess `
                                -Process $process `
                                -ExpectedStartTime $processStartTime `
                                -RepositoryName $repositoryName `
                                -Phase 'immediately before taskkill' `
                                -ChangedIdentityAction 'termination was not attempted.') {
                            # This intentionally repeats the earlier process-state
                            # checks immediately before taskkill to narrow the
                            # time-of-check/time-of-use window.
                            # The Process object keeps a handle to the child cmd.exe
                            # and HasExited/ProcessName/StartTime are checked
                            # immediately before taskkill, so PID reuse is not
                            # expected in normal Windows process lifetime semantics.
                            $taskKillAttempted = $true
                            $taskKillResult = Invoke-TaskKillTree -ProcessId $processId
                            # Invoke-TaskKillTree returns only after taskkill.exe
                            # has exited, failed to start, or its helper process
                            # was itself timed out and terminated. Phase 3 below
                            # therefore does not run while an observed taskkill
                            # helper is still active.
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
                            # Phase 3: direct Process.Kill() is only a fallback
                            # for the wrapper cmd.exe itself when taskkill.exe
                            # could not end the tree. taskkill.exe helper
                            # termination is handled separately in
                            # Invoke-TaskKillTree. The repeated Refresh() calls
                            # below intentionally narrow, but cannot eliminate,
                            # the natural-exit race before Kill().
                            if (Test-ExpectedRunningCmdProcess `
                                    -Process $process `
                                    -ExpectedStartTime $processStartTime `
                                    -RepositoryName $repositoryName `
                                    -Phase 'immediately before direct Process.Kill()' `
                                    -ChangedIdentityAction 'termination was not attempted.') {
                                # The process can still exit between HasExited and
                                # Kill(); the catch below treats that race as a
                                # diagnostic warning instead of a script failure.
                                $process.Refresh()
                                if ($process.HasExited) {
                                    Write-Warning "[$repositoryName] Process exited immediately before direct Process.Kill(); no further termination was needed."
                                }
                                else {
                                    $currentProcessId = Get-ValidProcessIdOrNull -Process $process
                                    $currentProcessIdText = Get-ProcessIdDisplayText -ProcessId $currentProcessId -Fallback $processIdText
                                    Write-Warning "[$repositoryName] taskkill did not terminate the wrapper process tree; attempting direct Process.Kill() for PID $currentProcessIdText."
                                    $process.Kill()
                                    $process.Refresh()
                                    if ($process.HasExited) {
                                        Write-Verbose "[$repositoryName] Direct Process.Kill() completed before the follow-up wait."
                                    }
                                }
                            }

                            if (-not $process.WaitForExit($DirectProcessKillWaitMilliseconds)) {
                                $targetProcessId = Get-ValidProcessIdOrNull -Process $process
                                $targetProcessIdOrSentinel = Get-ProcessIdOrSentinel -ProcessId $targetProcessId
                                $targetProcessIdText = Get-ProcessIdDisplayText -ProcessId $targetProcessId -Fallback $processIdText
                                $targetDiagnosticCommand = Get-TaskListDiagnosticCommand -ProcessId $targetProcessIdOrSentinel
                                Write-Warning "[$repositoryName] Process with PID $targetProcessIdText still did not exit after direct Process.Kill(). Use Task Manager or run '$targetDiagnosticCommand' to verify the process tree has terminated before rerunning package validation."
                            }
                        }
                        catch {
                            $killError = $_.Exception.Message
                            $killFailureReason = Get-ProcessKillFailureReason -Exception $_.Exception
                            try {
                                $process.Refresh()
                                if ($process.HasExited) {
                                    Write-Warning "[$repositoryName] Direct Process.Kill() raced with natural process exit; no further termination was needed. Failure classification: $killFailureReason Original error: $killError"
                                }
                                else {
                                    Write-Warning "[$repositoryName] Direct Process.Kill() after timeout failed while the process still appeared to be running. Failure classification: $killFailureReason Original error: $killError"
                                }
                            }
                            catch {
                                Write-Warning "[$repositoryName] Direct Process.Kill() after timeout failed and the final process state could not be inspected. Failure classification: $killFailureReason Original error: $killError"
                            }
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
            # returns immediately for an exited process, but it still gives .NET
            # a chance to finish redirected stream flushing and process-handle
            # cleanup that may not be complete after the timed overload. This
            # follows the .NET Process.WaitForExit guidance for redirected
            # streams after using a timed wait.
            try {
                $process.WaitForExit()
            }
            catch {
                Write-Verbose "Process exited, but final WaitForExit stream-flushing/process-handle cleanup failed: $($_.Exception.Message)"
            }
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
        Write-ValidationProgressMessage "[$repositoryName] $status"
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
    # Keep this as an explicit loop instead of a pipeline so Windows PowerShell
    # 5.1 short-circuits immediately on the first failure.
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
