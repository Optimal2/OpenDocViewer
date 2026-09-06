<#
.SYNOPSIS
Helper functions for validate-component-versions.ps1 that are shared with
Pester tests. Keep this file free of side effects so it can be dot-sourced
safely in test contexts.

.DESCRIPTION
This file is the SHARED CORE of the component-version validator family. It is
copied verbatim into every OMP-compatible repository (same relative path,
scripts/omp/validate-component-versions.helpers.ps1) and the shared-script
drift guard (validate-shared-scripts.ps1, wired as Check 15 in the consumer
validators) compares every copy byte-for-byte against this canonical one.
Never make a repo-local edit to a copy: change this file and redistribute it
in the same change. The check-numbering contract that these helpers serve is
documented in docs/VALIDATOR_CHECKS.md.
#>

function ConvertFrom-JsonDocument {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseCompatibleCommands', '', Justification = 'The ConvertFrom-Json -Depth call is guarded at runtime by checking Get-Command for the Depth parameter; on Windows PowerShell 5.1 the fallback branch without -Depth runs.')]
    param(
        [Parameter(Mandatory = $true)][string]$Json,
        [Parameter(Mandatory = $true)][int]$Depth
    )

    $command = Get-Command ConvertFrom-Json
    if ($command.Parameters.ContainsKey('Depth')) {
        return $Json | ConvertFrom-Json -Depth $Depth
    }

    return $Json | ConvertFrom-Json
}

function Get-OptionalPropertyValue {
    param(
        [Parameter(Mandatory = $true)][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Resolve-RepositoryPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$BasePath
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Add-ValidationError {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[string]]$Errors,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    [void]$Errors.Add($Message)
}

function Add-ValidationWarning {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[string]]$Warnings,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    [void]$Warnings.Add($Message)
}

# ---------------------------------------------------------------------------
# Git readers that cannot fail silently.
# ---------------------------------------------------------------------------
# Every diff-based check in this family used to ask git a question, send git's
# error output to $null, and then treat an empty answer as "nothing changed" --
# which is also exactly what a failed git call produces. A blobless clone, a
# squashed base commit, a missing object: any of them turned a check into a
# no-op that still printed a pass (R7-G8). These helpers make an unreadable
# answer a validation error instead of a silent skip, in one place, so no call
# site can forget.

# R12-A6. '2>&1' on a native command merges git's stderr into the PowerShell
# pipeline as ErrorRecords, and the validators run with $ErrorActionPreference
# = 'Stop'. Under Windows PowerShell 5.1 that combination TERMINATES the script
# the moment git writes anything to stderr -- before the $LASTEXITCODE check
# below ever runs. Measured on a Windows 5.1 host against both runtimes, with
# an invalid ref and with a path missing at the base ref: pwsh 7 reached the
# $LASTEXITCODE check (LASTEXITCODE=128); powershell.exe 5.1 terminated with a
# RemoteException. The pre-push hook runs 5.1, so the runtime that actually
# gates a push was the broken one.
#
# Restoring 'Continue' for the duration of the call keeps stderr as plain
# strings in both runtimes. It is restored in a finally so an exception cannot
# leave the rest of the script running with the wrong preference.
function Invoke-GitCapture {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& git @Arguments 2>&1)
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Lines    = $output
            Text     = ($output -join "`n")
        }
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-GitChangedFiles {
    <#
    .SYNOPSIS
    Returns the newline-joined list of files changed relative to a base ref:
    committed changes (base...HEAD, three-dot), uncommitted working-tree
    changes (HEAD vs worktree), and untracked files. Returns $null (after
    recording a validation error) when git could not answer.

    The committed-only form of this check was blind to uncommitted edits, so a
    change sat invisible until after commit; the worktree/untracked inclusions
    catch it while it is still cheap to fix. In CI the tree is clean, so the
    committed answer is the whole answer there.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$BaseRef,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Errors,
        [Parameter(Mandatory = $true)][string]$CheckDescription
    )

    $pathSpec = $Path
    if ([string]::IsNullOrWhiteSpace($pathSpec)) {
        $pathSpec = '.'
    }

    $committed = Invoke-GitCapture -Arguments @('-C', $RepositoryRoot, 'diff', '--name-only', "$BaseRef...HEAD", '--', $pathSpec)
    if ($committed.ExitCode -ne 0) {
        Add-ValidationError -Errors $Errors -Message "$CheckDescription could not run: 'git diff $BaseRef...HEAD -- $pathSpec' exited with $($committed.ExitCode). $($committed.Text)"
        return $null
    }

    $worktree = Invoke-GitCapture -Arguments @('-C', $RepositoryRoot, 'diff', '--name-only', 'HEAD', '--', $pathSpec)
    if ($worktree.ExitCode -ne 0) {
        Add-ValidationError -Errors $Errors -Message "$CheckDescription could not run: 'git diff HEAD -- $pathSpec' exited with $($worktree.ExitCode). $($worktree.Text)"
        return $null
    }

    $untracked = Invoke-GitCapture -Arguments @('-C', $RepositoryRoot, 'ls-files', '--others', '--exclude-standard', '--', $pathSpec)
    if ($untracked.ExitCode -ne 0) {
        Add-ValidationError -Errors $Errors -Message "$CheckDescription could not run: 'git ls-files --others -- $pathSpec' exited with $($untracked.ExitCode). $($untracked.Text)"
        return $null
    }

    $all = @($committed.Lines) + @($worktree.Lines) + @($untracked.Lines) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique
    return ($all -join "`n")
}

function Get-GitFileTextAtRef {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$BaseRef,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Errors,
        [Parameter(Mandatory = $true)][string]$CheckDescription
    )

    # R12-A13. "Did this path exist at the base ref" used to be answered by
    # matching git's error prose ('exists on disk, but not in', 'does not exist
    # in'). That text is not a contract: it varies by git version and is
    # translated when the user has a localised git, so on some machines a genuinely
    # broken read would be silently reported as "new file, nothing to check" --
    # the fail-open direction these helpers exist to remove. Ask git the question
    # it can answer with an exit code instead.
    $exists = Invoke-GitCapture -Arguments @('-C', $RepositoryRoot, 'cat-file', '-e', "${BaseRef}:$Path")
    if ($exists.ExitCode -ne 0) {
        # Distinguish "the ref itself is unreadable" from "the path is not in it".
        # Only the second is a new file; the first must still be an error.
        $refReadable = Invoke-GitCapture -Arguments @('-C', $RepositoryRoot, 'rev-parse', '--verify', '--quiet', "$BaseRef^{commit}")
        if ($refReadable.ExitCode -ne 0) {
            Add-ValidationError -Errors $Errors -Message "$CheckDescription could not run: base ref '$BaseRef' is not readable in '$RepositoryRoot'. $($refReadable.Text)"
            return $null
        }

        # Every caller already treats empty text as "new file".
        return ''
    }

    $result = Invoke-GitCapture -Arguments @('-C', $RepositoryRoot, 'show', "${BaseRef}:$Path")
    if ($result.ExitCode -ne 0) {
        Add-ValidationError -Errors $Errors -Message "$CheckDescription could not run: 'git show ${BaseRef}:$Path' exited with $($result.ExitCode). $($result.Text)"
        return $null
    }

    return (Remove-Utf8Bom -Text ($result.Text))
}

function Test-GitRefAvailable {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$Ref
    )

    $result = Invoke-GitCapture -Arguments @('-C', $RepositoryRoot, 'rev-parse', '--verify', '--quiet', $Ref)
    return ($result.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($result.Text))
}

function Test-SemverLikeVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Value
    )

    return $Value -match '^\d+\.\d+(?:\.\d+)?$'
}

function ConvertTo-VersionOrNull {
    param(
        [Parameter(Mandatory = $true)][string]$Value
    )

    $version = $null
    if ([Version]::TryParse($Value, [ref]$version)) {
        return $version
    }

    return $null
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Text)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-FileSha256Hex {
    <#
    .SYNOPSIS
    Computes the lower-case hex SHA-256 hash of a file.
    #>
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "File not found for SHA-256 computation: $Path"
    }

    $stream = [System.IO.FileStream]::new($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        $hash = $sha256.ComputeHash($stream)
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Remove-Utf8Bom {
    <#
    .SYNOPSIS
    Removes a leading UTF-8 BOM from a string so it can be parsed as JSON or SQL.
    Git may preserve BOMs written by some editors/encodings, and ConvertFrom-Json
    treats a BOM as an unexpected character.

    IMPORTANT: Must use $Text[0] -eq [char]0xFEFF (not StartsWith) because
    StartsWith([char]) is culture-sensitive in Windows PowerShell 5.1 (.NET Framework)
    where U+FEFF is an "ignorable" character - it returns true for ANY string,
    silently stripping the first character. Measured: "hello world".StartsWith(
    [char]0xFEFF) returns True under 5.1. [AllowEmptyString()] is required too:
    without it, an empty file dies on the Mandatory parameter binding instead of
    being validated.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Text
    )

    if ($Text.Length -gt 0 -and $Text[0] -eq [char]0xFEFF) {
        return $Text.Substring(1)
    }

    return $Text
}

function Get-ProjectReferences {
    <#
    .SYNOPSIS
    Returns the parent directory paths of all projects referenced by the
    specified .csproj file (or the first .csproj in the specified directory).
    #>
    param(
        [Parameter(Mandatory = $true)][string]$CsprojPath
    )

    $resolvedCsproj = $CsprojPath
    if (Test-Path -LiteralPath $CsprojPath -PathType Container) {
        $csprojFiles = @(Get-ChildItem -LiteralPath $CsprojPath -Filter '*.csproj' -File -ErrorAction SilentlyContinue)
        if ($csprojFiles.Count -eq 0) {
            return @()
        }
        $resolvedCsproj = $csprojFiles[0].FullName
    }

    if (-not (Test-Path -LiteralPath $resolvedCsproj -PathType Leaf)) {
        return @()
    }

    $csprojDir = Split-Path -Parent $resolvedCsproj
    $csprojText = Get-Content -LiteralPath $resolvedCsproj -Raw -Encoding UTF8

    $referencedDirs = [System.Collections.Generic.List[string]]::new()
    # Not $matches: that is PowerShell's automatic variable, written by every -match in
    # the same scope. Assigning to it is legal and quietly makes any later -match result
    # in this function read as project references.
    $projectReferenceMatches = [System.Text.RegularExpressions.Regex]::Matches($csprojText, '<ProjectReference\s+Include="([^"]+)"')
    foreach ($match in $projectReferenceMatches) {
        $includePath = $match.Groups[1].Value
        $resolvedRefPath = [System.IO.Path]::GetFullPath((Join-Path $csprojDir $includePath))
        if (Test-Path -LiteralPath $resolvedRefPath -PathType Leaf) {
            $refDir = [System.IO.Path]::GetFullPath((Split-Path -Parent $resolvedRefPath))
            if (-not $referencedDirs.Contains($refDir)) {
                [void]$referencedDirs.Add($refDir)
            }
        }
    }

    return $referencedDirs.ToArray()
}

function ConvertTo-NormalizedSql {
    param([Parameter(Mandatory = $true)][string]$SqlText)

    # Strip the historical local development database switch so the same
    # SQL can be compared across branches/installations.
    $normalized = [System.Text.RegularExpressions.Regex]::Replace(
        $SqlText,
        '(?im)^\s*USE\s+\[OpenModulePlatform\]\s*;\s*\r?\n\s*GO\s*(?:--.*)?\s*(?:\r?\n)?',
        '')

    # Strip single-line comments.
    $normalized = [System.Text.RegularExpressions.Regex]::Replace($normalized, '--[^\r\n]*', '')

    # Strip block comments.
    $normalized = [System.Text.RegularExpressions.Regex]::Replace($normalized, '/\*[\s\S]*?\*/', '')

    # Collapse all whitespace to a single space and trim.
    $normalized = [System.Text.RegularExpressions.Regex]::Replace($normalized, '\s+', ' ').Trim()

    return $normalized
}

function ConvertTo-PortableModuleDefinitionSql {
    <#
    .SYNOPSIS
    Applies the same transformation as the OpenModulePlatform embed tool
    (scripts/dev/embed-module-definition-sql.ps1) before SQL text is stored in a
    module definition: strip the historical local development database switch.
    All other bytes (comments, whitespace, line endings) are preserved exactly,
    so the result can be compared byte-for-byte with embedded base64 content.
    #>
    param([Parameter(Mandatory = $true)][string]$SqlText)

    return [System.Text.RegularExpressions.Regex]::Replace(
        $SqlText,
        '(?im)^\s*USE\s+\[OpenModulePlatform\]\s*;\s*\r?\n\s*GO\s*(?:--.*)?\s*(?:\r?\n)?',
        '')
}

function ConvertTo-LfLineEndings {
    <#
    .SYNOPSIS
    Normalizes CRLF line endings to LF. SQL blobs in git are LF-only, but a
    working tree checked out with core.autocrlf=true materializes CRLF files
    (and an embed run on such a machine embeds CRLF bytes). Normalizing before
    comparison keeps pure line-ending drift from being reported as staleness.
    #>
    param([Parameter(Mandatory = $true)][string]$Text)

    return $Text -replace "`r`n", "`n"
}

function Compare-WebSharedBinaryIdentity {
    <#
    .SYNOPSIS
    Decides whether a Web.Shared binary change between parent and HEAD is
    acceptable given the consumer cascade-bump state.

    .DESCRIPTION
    This function is intentionally environment-agnostic: it receives two
    hashes and a flag and returns a structured verdict. Tests drive it with
    injected hash pairs so the check is never coupled to a committed absolute
    baseline or to the reproducibility of a .NET build across machines.

    .OUTPUTS
    Hashtable with keys:
      Result  - 'Pass', 'Fail', or 'Skip'
      Message - human-readable explanation
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$ParentHash = '',

        [Parameter(Mandatory = $false)]
        [string]$HeadHash = '',

        [Parameter(Mandatory = $false)]
        [bool]$CascadeBumped = $false
    )

    if ([string]::IsNullOrWhiteSpace($ParentHash) -or [string]::IsNullOrWhiteSpace($HeadHash)) {
        return @{
            Result  = 'Skip'
            Message = 'Cannot compare Web.Shared binary identity because one or both hashes are missing.'
        }
    }

    if ([string]::Equals($ParentHash, $HeadHash, [StringComparison]::OrdinalIgnoreCase)) {
        return @{
            Result  = 'Pass'
            Message = "Web.Shared binary is unchanged between parent and HEAD ($HeadHash)."
        }
    }

    if (-not $CascadeBumped) {
        return @{
            Result  = 'Fail'
            Message = "Web.Shared binary changed between parent and HEAD ($ParentHash -> $HeadHash) but no consumer cascade-bump was detected. Run `.\scripts\omp\bump-version.ps1 -CascadeFrom 'OpenModulePlatform.Web.Shared/OpenModulePlatform.Web.Shared.csproj'`."
        }
    }

    return @{
        Result  = 'Pass'
        Message = "Web.Shared binary changed between parent and HEAD ($ParentHash -> $HeadHash) and consumers were cascade-bumped."
    }
}

function Invoke-ValidatorSelfTest {
    <#
    .SYNOPSIS
    Canonical self-test for the validator family (-SelfTest). Verifies the two
    PowerShell 5.1 pitfalls that have actually broken this gate: the BOM strip
    (Remove-Utf8Bom) and git change detection (Get-GitChangedFiles), using a
    throwaway git repository under $env:TEMP. Offline, no residue. Exits 0/1.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$CheckMark,
        [Parameter(Mandatory = $true)][string]$CrossMark
    )

    $selfTestErrors = [System.Collections.Generic.List[string]]::new()

    # Remove-Utf8Bom must strip the BOM but must not strip the first character
    # of a no-BOM string. Under PS5.1, StartsWith([char]0xFEFF) returns true for
    # any string because U+FEFF is an ignorable character in culture-sensitive
    # comparison.
    $bomInput = [char]0xFEFF + '{"a":1}'
    $noBomInput = '{"a":1}'
    $emptyInput = ''

    $bomOutput = Remove-Utf8Bom -Text $bomInput
    $noBomOutput = Remove-Utf8Bom -Text $noBomInput
    $emptyOutput = Remove-Utf8Bom -Text $emptyInput

    if ($bomOutput -ne '{"a":1}') {
        $selfTestErrors.Add("Remove-Utf8Bom failed to strip BOM: '$bomOutput'")
    }

    if ($noBomOutput -ne '{"a":1}') {
        $selfTestErrors.Add("Remove-Utf8Bom incorrectly stripped first character of no-BOM input: '$noBomOutput'")
    }

    if ($emptyOutput -ne '') {
        $selfTestErrors.Add("Remove-Utf8Bom failed on empty string: '$emptyOutput'")
    }

    # Get-GitChangedFiles must see a clean tree as clean, an uncommitted edit,
    # and an untracked file -- and must record an error (never a silent empty
    # answer) when git cannot answer at all.
    $tempRoot = Join-Path $env:TEMP ("vcv-selftest-" + [guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path (Join-Path $tempRoot 'src\SelfTestProbe') -Force | Out-Null
        git -C $tempRoot init -q
        Set-Content -LiteralPath (Join-Path $tempRoot 'src\SelfTestProbe\Foo.cs') -Value 'v1' -NoNewline
        git -C $tempRoot add .
        git -C $tempRoot -c user.email=selftest@localhost -c user.name=selftest -c commit.gpgsign=false commit -q -m baseline

        $stErrors = [System.Collections.Generic.List[string]]::new()

        $clean = Get-GitChangedFiles -RepositoryRoot $tempRoot -BaseRef 'HEAD' -Path 'src/SelfTestProbe' -Errors $stErrors -CheckDescription 'self-test'
        if (-not [string]::IsNullOrWhiteSpace($clean)) { throw 'FAIL: clean tree reported changes' }
        if ($stErrors.Count -ne 0) { throw "FAIL: clean tree recorded errors: $($stErrors -join '; ')" }

        Set-Content -LiteralPath (Join-Path $tempRoot 'src\SelfTestProbe\Foo.cs') -Value 'v2' -NoNewline
        $dirty = Get-GitChangedFiles -RepositoryRoot $tempRoot -BaseRef 'HEAD' -Path 'src/SelfTestProbe' -Errors $stErrors -CheckDescription 'self-test'
        if ($dirty -notmatch 'src/SelfTestProbe/Foo\.cs') { throw 'FAIL: uncommitted tracked change not detected' }

        Set-Content -LiteralPath (Join-Path $tempRoot 'src\SelfTestProbe\New.cs') -Value 'new' -NoNewline
        $withNew = Get-GitChangedFiles -RepositoryRoot $tempRoot -BaseRef 'HEAD' -Path 'src/SelfTestProbe' -Errors $stErrors -CheckDescription 'self-test'
        if ($withNew -notmatch 'src/SelfTestProbe/New\.cs') { throw 'FAIL: untracked file not detected' }

        $stErrorCountBefore = $stErrors.Count
        $unreadable = Get-GitChangedFiles -RepositoryRoot $tempRoot -BaseRef 'refs/heads/does-not-exist' -Path 'src/SelfTestProbe' -Errors $stErrors -CheckDescription 'self-test'
        if ($null -ne $unreadable) { throw 'FAIL: unreadable base ref returned an answer instead of null' }
        if ($stErrors.Count -le $stErrorCountBefore) { throw 'FAIL: unreadable base ref recorded no validation error' }
    }
    catch {
        $selfTestErrors.Add("Get-GitChangedFiles self-test failed: $($_.Exception.Message)")
    }
    finally {
        if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
    }

    if ($selfTestErrors.Count -gt 0) {
        Write-Host "$CrossMark Self-test failed:"
        foreach ($selfTestError in $selfTestErrors) {
            Write-Host " - $selfTestError"
        }
        exit 1
    }

    Write-Host "$CheckMark Self-test passed (Remove-Utf8Bom and Get-GitChangedFiles are PS5.1-safe and fail-loud)."
    exit 0
}
