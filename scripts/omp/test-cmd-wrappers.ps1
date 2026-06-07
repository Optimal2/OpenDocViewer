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
    # Allow at least 60 seconds for minimal build work, and cap at 1 hour so
    # CI/manual validation cannot hang indefinitely.
    [ValidateRange(60, 3600)]
    [int]$PerRepositoryTimeoutSeconds = 1200
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$MillisecondsPerSecond = 1000
$ManifestRelativePath = 'omp-components.json'
$CommandWrapperRelativePath = 'scripts\omp\build-universal-package.cmd'
$SafeFileNamePattern = '[^A-Za-z0-9._-]+'
$PackageIdentityPattern = '^[A-Za-z0-9._+-]+$'
$GlobalPackageFileSegment = '__global__'
$ValidationDirectoryName = 'omp-cmd-wrapper-validation'
$HashPrefixLength = 16
$DecimalPlacesForTimeDisplay = 2
$PositiveIntegerPattern = '^[1-9][0-9]*$'
$MinimumValidProcessId = 1
# ASCII control characters: NUL through US (Unit Separator) plus DEL.
$ControlCharacterPattern = '[\x00-\x1F\x7F]'
$CmdArgumentNeedsQuotingPattern = '[\s&|<>()^,;=]'
$MaximumCmdCommandLineLength = 8191
# 22 bytes is the smallest structurally valid empty ZIP file. OMP universal
# packages must contain a manifest and object payload, so useful output must be
# larger than this marker.
$MinimumMeaningfulZipFileLengthBytes = 22

$PostTerminationWaitSeconds = 10
$TaskKillWaitSeconds = 10
# Give taskkill and the target process a short grace period to tear down child
# processes and flush redirected streams without letting validation hang.
$PostTerminationWaitMilliseconds = $PostTerminationWaitSeconds * $MillisecondsPerSecond
$TaskKillWaitMilliseconds = $TaskKillWaitSeconds * $MillisecondsPerSecond
# taskkill.exe uses normal process exit codes. -1 is reserved here to mean that
# PowerShell could not start or observe taskkill.exe itself.
$TaskKillExecutionExceptionExitCode = -1

function Get-ScriptDirectory {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return $PSScriptRoot
    }

    $scriptPath = $script:PSCommandPath
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        $scriptPath = $script:MyInvocation.MyCommand.Path
    }

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
    return $fullPath.Equals($fullBasePath, [StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullBasePath + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullBasePath + [System.IO.Path]::AltDirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function ConvertTo-ComparablePath {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Path
    )

    return (Resolve-FullPathSafely -Name $Name -Path $Path).TrimEnd('\', '/')
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
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha256.ComputeHash($bytes)
    }
    finally {
        $sha256.Dispose()
    }

    # 16 hex characters gives 64 bits of stable filename entropy, which is
    # intentionally more than enough for the small set of sibling repositories.
    $hash = [BitConverter]::ToString($hashBytes).Replace('-', '').ToLowerInvariant()
    return $hash.Substring(0, [Math]::Min($HashPrefixLength, $hash.Length))
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

    if ($Value -match $ControlCharacterPattern) {
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
        $systemCmd = Join-Path $systemRoot 'System32\cmd.exe'
        if (Test-Path -LiteralPath $systemCmd -PathType Leaf) {
            return Resolve-FullPathSafely -Name 'system cmd.exe path' -Path $systemCmd
        }
    }

    $candidate = $env:ComSpec
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw 'Could not locate cmd.exe because SystemRoot/System32/cmd.exe was missing and ComSpec was empty.'
    }

    $candidate = Resolve-FullPathSafely -Name 'ComSpec path' -Path $candidate
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "ComSpec points to a missing executable: $candidate"
    }

    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([System.IO.Path]::GetFileName($candidate), 'cmd.exe')) {
        throw "ComSpec must point to cmd.exe for wrapper validation. Actual value: $candidate"
    }

    return $candidate
}

function Resolve-TaskKillExePath {
    $systemRoot = $env:SystemRoot
    if (-not [string]::IsNullOrWhiteSpace($systemRoot)) {
        $systemTaskKill = Join-Path $systemRoot 'System32\taskkill.exe'
        if (Test-Path -LiteralPath $systemTaskKill -PathType Leaf) {
            return Resolve-FullPathSafely -Name 'system taskkill.exe path' -Path $systemTaskKill
        }
    }

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
        Write-Verbose "Process state is unavailable while reading ExitCode. The process may be running or may have been disposed."
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

    # Windows process IDs are positive decimal integers; zero or negative values
    # are treated as invalid before any taskkill command is assembled.
    if ($id -lt 1) {
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
        Write-Verbose "Could not read process start time: $($_.Exception.Message)"
        return $null
    }
}

function ConvertTo-TaskKillProcessIdArgument {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $processIdText = [string]$ProcessId
    # Defense in depth: the parameter is already an int, but taskkill receives a
    # string argument and should only ever see a positive decimal PID.
    if ($processIdText -notmatch $PositiveIntegerPattern) {
        throw "Process ID is not a positive integer and cannot be passed to taskkill.exe: $processIdText"
    }

    return $processIdText
}

function Invoke-TaskKillTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $processIdArgument = ConvertTo-TaskKillProcessIdArgument -ProcessId $ProcessId
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = Resolve-TaskKillExePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.ArgumentList.Add('/PID')
    $startInfo.ArgumentList.Add($processIdArgument)
    $startInfo.ArgumentList.Add('/T')
    $startInfo.ArgumentList.Add('/F')

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
        if (-not $taskKillProcess.WaitForExit($TaskKillWaitMilliseconds)) {
            try {
                $taskKillProcess.Kill()
            }
            catch {
                Write-Verbose "Could not terminate stuck taskkill.exe process: $($_.Exception.Message)"
            }

            $taskKillProcess.WaitForExit()
            return [pscustomobject]@{
                ExitCode = $TaskKillExecutionExceptionExitCode
                Output = @("taskkill.exe did not exit within $TaskKillWaitSeconds seconds.")
            }
        }

        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $output = [System.Collections.Generic.List[string]]::new()
        if (-not [string]::IsNullOrWhiteSpace($stdout)) {
            $output.Add($stdout.Trim())
        }

        if (-not [string]::IsNullOrWhiteSpace($stderr)) {
            $output.Add($stderr.Trim())
        }

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

function Test-ExpectedCmdProcess {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [object]$ExpectedStartTime = $null
    )

    try {
        $Process.Refresh()
        $processName = $Process.ProcessName
        # ProcessName normally omits .exe on Windows, but accept both forms to
        # keep the guard clear if the runtime behavior ever changes.
        $isCmdProcess = $processName.Equals('cmd', [StringComparison]::OrdinalIgnoreCase) -or
            $processName.Equals('cmd.exe', [StringComparison]::OrdinalIgnoreCase)

        if (-not $isCmdProcess) {
            return $false
        }

        if ($null -ne $ExpectedStartTime) {
            if ($ExpectedStartTime -isnot [datetime]) {
                Write-Verbose "Expected process start time had unexpected type '$($ExpectedStartTime.GetType().FullName)'."
                return $false
            }

            $actualStartTime = Get-ProcessStartTimeOrNull -Process $Process
            if ($null -eq $actualStartTime -or $actualStartTime -ne $ExpectedStartTime) {
                return $false
            }
        }

        return $true
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
        Write-Warning "[$RepositoryName] taskkill could not be started. This can indicate missing taskkill.exe or insufficient permissions. Output:$([Environment]::NewLine)$taskKillOutputText"
        return
    }

    Write-Warning "[$RepositoryName] taskkill failed with exit code $ExitCode. The process may have already terminated, taskkill.exe may be unavailable, or the caller may lack permission. Output:$([Environment]::NewLine)$taskKillOutputText"
}

function Test-PackageCreated {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction Stop

        if ($item -isnot [System.IO.FileInfo]) {
            return [pscustomobject]@{
                Exists = $false
                IsValid = $false
                Length = 0L
                Message = "Package path is not a file: $Path"
            }
        }

        $length = $item.Length
        $hasMeaningfulPayload = $length -gt $MinimumMeaningfulZipFileLengthBytes
        return [pscustomobject]@{
            Exists = $true
            IsValid = $hasMeaningfulPayload
            Length = $length
            Message = if ($hasMeaningfulPayload) {
                'Package file exists and has meaningful zip content.'
            }
            else {
                "Package file is too small to contain a meaningful zip payload. Expected size must be greater than $MinimumMeaningfulZipFileLengthBytes bytes."
            }
        }
    }
    catch [System.Management.Automation.ItemNotFoundException] {
        return [pscustomobject]@{
            Exists = $false
            IsValid = $false
            Length = 0L
            Message = 'Package file was not created.'
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

    if ($Value -notmatch $PackageIdentityPattern) {
        throw "Manifest field '$Name' contains characters that are unsafe for package filenames. Allowed characters are letters, digits, dot, underscore, hyphen, plus. Manifest: $ManifestPath"
    }
}

function Get-RequiredManifestText {
    param(
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][string]$PropertyName,
        [Parameter(Mandatory = $true)][string]$ManifestPath
    )

    $value = [string]$Manifest.$PropertyName
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Manifest field '$PropertyName' is required and must not be empty. Manifest: $ManifestPath"
    }

    Assert-SafePackageIdentityPart -Name $PropertyName -Value $value -ManifestPath $ManifestPath
    return $value
}

$scriptDirectory = Get-ScriptDirectory
# This script is intentionally kept in scripts/omp, so ..\.. is the repository
# root for every OMP-compatible repository that carries the shared wrappers.
$currentRepositoryRoot = Resolve-FullPathSafely -Name 'current repository root' -Path '..\..' -BasePath $scriptDirectory

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
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
# A GUID alone gives enough uniqueness while keeping log paths shorter.
$runId = [Guid]::NewGuid().ToString('N')
$runLogRootPath = Join-Path $logRootPath $runId
New-DirectorySafely -Path $runLogRootPath -Description 'run log directory'

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

if ($repositories.Count -eq 0) {
    throw "No OMP-compatible repositories found below $workspaceRootPath. Each repository must contain $ManifestRelativePath and $CommandWrapperRelativePath."
}

# WaitForExit expects a 32-bit millisecond value; ValidateRange caps this at
# 3,600,000 ms, well below [int]::MaxValue.
$timeoutMilliseconds = [int]($PerRepositoryTimeoutSeconds * $MillisecondsPerSecond)
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

    Assert-RepositoryPathUnderWorkspace -RepositoryPath $repository.FullName -WorkspaceRootPath $workspaceRootPath

    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "Could not parse component manifest JSON '$manifestPath': $($_.Exception.Message). The manifest must be valid JSON with repositoryKey and repositoryVersion fields."
    }

    $packageKey = Get-RequiredManifestText -Manifest $manifest -PropertyName 'repositoryKey' -ManifestPath $manifestPath
    $packageVersion = Get-RequiredManifestText -Manifest $manifest -PropertyName 'repositoryVersion' -ManifestPath $manifestPath

    # build-universal-package.cmd creates the repository's global package by
    # default, and global packages use the same __global__ naming convention as
    # export-universal-package.ps1.
    $expectedPackagePath = Join-Path $outputRootPath ('{0}{1}{2}.zip' -f $packageKey, $GlobalPackageFileSegment, $packageVersion)
    Assert-PathUnderBase -Path $expectedPackagePath -BasePath $outputRootPath -PathDescription 'Expected package path' -BaseDescription 'output root'
    Remove-ExistingFileSafely -Path $expectedPackagePath -Description 'expected package'

    $safeName = '{0}-{1}' -f (Get-SafeFileName -Value $repoDisplayName), (Get-ShortStableHash -Value $repository.FullName)
    $stdoutPath = Join-Path $runLogRootPath "$safeName.stdout.log"
    $stderrPath = Join-Path $runLogRootPath "$safeName.stderr.log"
    Assert-PathUnderBase -Path $stdoutPath -BasePath $runLogRootPath -PathDescription 'stdout log path' -BaseDescription 'run log root'
    Assert-PathUnderBase -Path $stderrPath -BasePath $runLogRootPath -PathDescription 'stderr log path' -BaseDescription 'run log root'

    Write-Host "[$repoDisplayName] Running build-universal-package.cmd with a timeout of $PerRepositoryTimeoutSeconds seconds..."

    # --no-pause is a CMD-wrapper flag; the wrapper removes it before invoking
    # the underlying PowerShell script. call ensures the invoked .cmd file
    # returns control to this cmd.exe instance when it is run through /c.
    Assert-SafeCmdArgumentText -Name 'Command wrapper path' -Value $cmdPath
    Assert-SafeCmdArgumentText -Name 'OutputRoot' -Value $outputRootPath
    $cmdInvocation = 'call ' + (Join-CmdCommandLine -Arguments @($cmdPath, '--no-pause', '-OutputDirectory', $outputRootPath))
    Assert-CmdCommandLineLength -CommandLine $cmdInvocation
    # /d disables cmd.exe AutoRun hooks and /c runs the wrapper then exits.
    $cmdArguments = @('/d', '/c', $cmdInvocation)
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

        $process = Start-Process -FilePath $cmdExePath `
            -ArgumentList $cmdArguments `
            -WorkingDirectory $repository.FullName `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -WindowStyle Hidden `
            -PassThru
        $processStartTime = Get-ProcessStartTimeOrNull -Process $process
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
            # The timed overload observes process exit. The second, parameterless
            # call is still required by .NET so redirected stdout/stderr are fully
            # flushed before status checks inspect logs and package output.
            $process.WaitForExit()
        }

        $timedOut = -not $exitedWithinTimeout
        if ($timedOut) {
            $processId = Get-ValidProcessIdOrNull -Process $process
            $processIdText = if ($null -eq $processId) { '<unknown>' } else { [string]$processId }
            Write-Warning "[$repoDisplayName] Timeout reached after $PerRepositoryTimeoutSeconds seconds. Terminating process tree for PID $processIdText."
            $process.Refresh()
            if ($process.HasExited) {
                Write-Warning "[$repoDisplayName] Process exited after the timeout was detected; taskkill was not needed."
            }
            elseif ($null -eq $processId) {
                Write-Warning "[$repoDisplayName] Process has an invalid or unavailable PID; taskkill was not attempted."
            }
            elseif (-not (Test-ExpectedCmdProcess -Process $process -ExpectedStartTime $processStartTime)) {
                Write-Warning "[$repoDisplayName] Timed-out process is no longer the expected cmd.exe instance; taskkill was not attempted."
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
                        Write-Warning "[$repoDisplayName] Process identity changed immediately before taskkill; termination was not attempted."
                    }
                    else {
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
                    # This is display text only; the actual wait uses
                    # PostTerminationWaitMilliseconds above.
                    $postTerminationWaitSecondsDisplay = [Math]::Round($PostTerminationWaitMilliseconds / $MillisecondsPerSecond, $DecimalPlacesForTimeDisplay)
                    Write-Warning "[$repoDisplayName] Process did not exit within $postTerminationWaitSecondsDisplay seconds after termination attempt; exit code may be unavailable."
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

$hasFailures = $null -ne ($results | Where-Object { $_.Status -ne 'OK' } | Select-Object -First 1)
if ($hasFailures) {
    # Keep one generic failure exit code for compatibility with existing
    # callers; individual failure categories are reported in the table above.
    exit 1
}
