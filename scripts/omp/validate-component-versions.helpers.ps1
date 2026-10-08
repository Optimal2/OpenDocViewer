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
# Finding the platform checkout for the cross-repository checks (14 and 15).
# ---------------------------------------------------------------------------
# A consumer validator calls Checks 14 and 15 from the OpenModulePlatform
# checkout. Each consumer used to locate that checkout with its own repo-local
# code, and when nothing was found it warned and exited 0 -- a green run for a
# check that never ran, unless -Strict happened to be passed. One resolver here,
# in the shared core, makes "not found" a validation error with the fix in the
# message. The only way to accept a missing checkout is the explicit, named
# exception OMP_ALLOW_MISSING_PLATFORM=1 (for example CI that checks out one
# repository), and even then the check is reported as NOT VERIFIED.
function Resolve-PlatformCheckScript {
    <#
    .SYNOPSIS
    Returns @{ ScriptPath; PlatformRoot } for a script in the OpenModulePlatform
    checkout, or $null after recording an error (or, under the explicit
    OMP_ALLOW_MISSING_PLATFORM=1 exception, a NOT VERIFIED warning).

    .DESCRIPTION
    Resolution order: -PlatformRepositoryRoot, then $env:OMP_PLATFORM_ROOT, then
    $env:OpenModulePlatformRoot, then the sibling directory ..\OpenModulePlatform.
    A relative root is anchored at RepositoryRoot, not the current directory.
    A root that was NAMED (parameter or environment) but does not hold the
    script is a configuration error even under the exception.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$ScriptRelativePath,
        [Parameter(Mandatory = $true)][string]$CheckLabel,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[string]]$Errors,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[string]]$Warnings,
        [Parameter(Mandatory = $false)][string]$PlatformRepositoryRoot = ''
    )

    $source = '-PlatformRepositoryRoot'
    $root = $PlatformRepositoryRoot
    if ([string]::IsNullOrWhiteSpace($root)) {
        $source = 'OMP_PLATFORM_ROOT'
        $root = $env:OMP_PLATFORM_ROOT
    }
    if ([string]::IsNullOrWhiteSpace($root)) {
        $source = 'OpenModulePlatformRoot'
        $root = $env:OpenModulePlatformRoot
    }
    if ([string]::IsNullOrWhiteSpace($root)) {
        $source = 'sibling of this repository'
        $root = '..\OpenModulePlatform'
    }

    $repositoryFullPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
    $root = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($repositoryFullPath, $root)).TrimEnd('\', '/')
    $scriptPath = Join-Path $root ($ScriptRelativePath -replace '/', '\')
    if (Test-Path -LiteralPath $scriptPath -PathType Leaf) {
        return [pscustomobject]@{ ScriptPath = $scriptPath; PlatformRoot = $root }
    }

    $howToFix = "Set OMP_PLATFORM_ROOT to the root of an OpenModulePlatform checkout (for example `$env:OMP_PLATFORM_ROOT = 'C:\src\OpenModulePlatform'), or clone it beside this repository as ..\OpenModulePlatform."
    if ($source -ne 'sibling of this repository') {
        Add-ValidationError -Errors $Errors -Message "$($CheckLabel): the platform root '$root' named by $source does not contain '$ScriptRelativePath', so the check could not run. $howToFix"
        return $null
    }

    $allowMissing = [string]$env:OMP_ALLOW_MISSING_PLATFORM
    if ($allowMissing -eq '1' -or $allowMissing -ieq 'true') {
        Add-ValidationWarning -Warnings $Warnings -Message "$($CheckLabel): NOT VERIFIED - no OpenModulePlatform checkout at '$root', accepted only because OMP_ALLOW_MISSING_PLATFORM is set. $howToFix"
        return $null
    }

    Add-ValidationError -Errors $Errors -Message "$($CheckLabel): no OpenModulePlatform checkout was found (tried -PlatformRepositoryRoot, OMP_PLATFORM_ROOT, OpenModulePlatformRoot and the sibling '$root'), so the check could not run. $howToFix Where no checkout can exist, such as CI that checks out one repository, set OMP_ALLOW_MISSING_PLATFORM=1 to accept the check as NOT VERIFIED."
    return $null
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

function Get-GitDeclaredLineEnding {
    <#
    .SYNOPSIS
    Returns the line-ending form .gitattributes declares for a repository path:
    'CRLF', 'LF', '' when git leaves the bytes alone (the text attribute is
    unset or no eol attribute applies), or $null when GIT COULD NOT ANSWER
    (git missing, non-zero exit, no output -- for example a repository root
    that is not a git work tree).

    .DESCRIPTION
    The embed tool (scripts/dev/embed-module-definition-sql.ps1) used to embed
    whichever line-ending form the SQL file happened to have on disk, so the
    same module definition held LF bytes on one machine and CRLF bytes on
    another, and a file rewritten by a Git Bash text tool (sed -i writes LF)
    produced an embedding that failed validation on every normal checkout.
    Reading the declared form from git check-attr makes the embedded bytes a
    function of the repository contract, not of the local working tree.

    '' and $null are different answers. '' is a declaration: git stores the
    bytes exactly, so embed and freshness logic must keep them exactly as they
    are -- never a license to normalize. $null is NO answer: every caller must
    treat it as an error (fail validation / abort the embed), because silently
    falling back to "bytes untouched" re-embeds the local accident the
    declared-form read exists to prevent.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$RelativePath
    )

    $gitPath = $RelativePath -replace '\\', '/'
    $output = $null
    $exitCode = 0
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & git -C $RepositoryRoot check-attr text eol -- $gitPath 2>$null
        $exitCode = $LASTEXITCODE
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($exitCode -ne 0 -or $null -eq $output) {
        return $null
    }

    $textAttribute = ''
    $eolAttribute = ''
    foreach ($attributeLine in @($output)) {
        if ($attributeLine -match ': text: (\S+)\s*$') {
            $textAttribute = $Matches[1]
        }
        elseif ($attributeLine -match ': eol: (\S+)\s*$') {
            $eolAttribute = $Matches[1]
        }
    }

    # -text (text: unset) means git stores the file byte for byte; no eol applies.
    if ($textAttribute -eq 'unset') {
        return ''
    }

    switch ($eolAttribute) {
        'crlf' { return 'CRLF' }
        'lf' { return 'LF' }
        default { return '' }
    }
}

function ConvertTo-DeclaredLineEndings {
    <#
    .SYNOPSIS
    Normalizes every line ending in $Text to the declared form ('CRLF' or
    'LF'). Any other declaration -- including '' for "git leaves the bytes
    alone" -- returns the text unchanged. $null is NOT a declaration (it is
    the unreadable-git-answer sentinel) and is rejected by [ValidateNotNull()].
    The parameter is deliberately UNTYPED: a [string]-typed parameter coerces
    $null to '' BEFORE the validation attributes run (measured on Windows
    PowerShell 5.1), which silently turned NO answer into "bytes untouched".
    #>
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text,
        [Parameter(Mandatory = $true)][AllowEmptyString()][ValidateNotNull()]$Declared
    )

    if ($Declared -eq 'CRLF') {
        return ($Text -replace "`r`n", "`n") -replace "`n", "`r`n"
    }

    if ($Declared -eq 'LF') {
        return $Text -replace "`r`n", "`n"
    }

    return $Text
}

# ---------------------------------------------------------------------------
# Check 21 support: finding direct TimeZoneInfo platform calls in C# source.
# ---------------------------------------------------------------------------

function Remove-CSharpCommentsAndStringLiterals {
    <#
    .SYNOPSIS
    Masks comments and string/char literals in C# source with spaces so pattern
    matching never fires on prose or literal text (validator Check 21). Code
    outside comments/literals is returned untouched and newlines are preserved,
    so the result has the same length and line layout as the input.

    Handles // and block comments, regular and interpolated "..." / $"...",
    verbatim @"..." / $@"..." / @$"..." (with the "" escape), '...' char
    literals, and C# 11 raw string literals (a quote run of three or more,
    with optional $ prefixes -- never with @, so a verbatim string holding a
    single quote, @"""", is never misread as a raw string). Verbatim and raw
    strings span line breaks; a regular string or char literal that reaches a
    line break unclosed stops masking there and scanning resumes after the
    break.

    Interpolation holes are scanned as CODE, not masked with their string: a
    platform call inside $"{...}" is just as direct as one outside a string.
    A hole is code until its matching closing brace run (a single '}' for a
    $-prefixed string, a run of N braces for a raw string carrying N '$'
    prefixes), and nested strings/comments inside the hole are masked by the
    same machinery -- string contexts form a stack for exactly this reason. A
    doubled brace in literal text is the escaped literal brace, never a hole.

    An unterminated literal masks to the end of the line (regular string or
    char literal) or the end of the file (block comment, verbatim and raw
    strings), which fails loud rather than blind.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Text
    )

    $chars = $Text.ToCharArray()
    $length = $chars.Length
    $apostrophe = [char]39
    $i = 0

    # String contexts form a stack because an interpolation hole is code that
    # can itself contain strings (with holes of their own); the base mode --
    # an empty stack -- is ordinary code. Context fields:
    #   Quote     closing quote character (" or ')
    #   Verbatim  true for @"..." (the "" escape, content may span lines)
    #   RawRun    opening quote-run length for a C# 11 raw string, 0 otherwise
    #   Dollars   number of $ prefixes: the brace run that opens and closes an
    #             interpolation hole (0 = not interpolated)
    #   HoleDepth brace depth inside a hole; 0 = scanning literal text
    $contexts = [System.Collections.Generic.Stack[hashtable]]::new()

    while ($i -lt $length) {
        $c = $chars[$i]
        $inHole = ($contexts.Count -gt 0 -and $contexts.Peek().HoleDepth -gt 0)

        if ($contexts.Count -eq 0 -or $inHole) {
            # ----- Code, either top level or inside an interpolation hole. -----

            # Line comment.
            if ($c -eq '/' -and $i + 1 -lt $length -and $chars[$i + 1] -eq '/') {
                $chars[$i] = ' '
                $chars[$i + 1] = ' '
                $i += 2
                while ($i -lt $length -and $chars[$i] -ne "`n") {
                    if ($chars[$i] -ne "`r") { $chars[$i] = ' ' }
                    $i++
                }
                continue
            }

            # Block comment.
            if ($c -eq '/' -and $i + 1 -lt $length -and $chars[$i + 1] -eq '*') {
                $chars[$i] = ' '
                $chars[$i + 1] = ' '
                $i += 2
                while ($i -lt $length) {
                    if ($chars[$i] -eq '*' -and $i + 1 -lt $length -and $chars[$i + 1] -eq '/') {
                        $chars[$i] = ' '
                        $chars[$i + 1] = ' '
                        $i += 2
                        break
                    }
                    if ($chars[$i] -ne "`n" -and $chars[$i] -ne "`r") { $chars[$i] = ' ' }
                    $i++
                }
                continue
            }

            # Literal start: zero or more '$', an optional '@' (either order),
            # then a quote. Anything else is ordinary code and left untouched.
            $j = $i
            $dollars = 0
            while ($j -lt $length -and $chars[$j] -eq '$') { $j++; $dollars++ }
            $verbatim = $false
            if ($j -lt $length -and $chars[$j] -eq '@') {
                $verbatim = $true
                $j++
                while ($j -lt $length -and $chars[$j] -eq '$') { $j++; $dollars++ }
            }

            if ($j -lt $length -and ($chars[$j] -eq '"' -or $chars[$j] -eq $apostrophe)) {
                $quote = $chars[$j]

                # C# 11 raw string literal: a run of at least three double
                # quotes. A verbatim string is never raw ('@' cannot combine
                # with a quote run of three or more), so @"""" is the verbatim
                # string holding one quote, never a raw string.
                $quoteRun = 0
                if ($quote -eq '"') {
                    while ($j + $quoteRun -lt $length -and $chars[$j + $quoteRun] -eq '"') { $quoteRun++ }
                }
                $rawRun = 0
                if (-not $verbatim -and $quoteRun -ge 3) {
                    $rawRun = $quoteRun
                }
                if ($quote -eq $apostrophe) {
                    # '$' and '@' carry no meaning on a char literal.
                    $verbatim = $false
                    $dollars = 0
                }

                for ($k = $i; $k -lt $j; $k++) { $chars[$k] = ' ' }
                $openRun = 1
                if ($rawRun -gt 0) { $openRun = $rawRun }
                for ($k = 0; $k -lt $openRun; $k++) { $chars[$j + $k] = ' ' }

                $contexts.Push(@{
                    Quote = $quote
                    Verbatim = $verbatim
                    RawRun = $rawRun
                    Dollars = $dollars
                    HoleDepth = 0
                })
                $i = $j + $openRun
                continue
            }

            if ($inHole -and ($c -eq '{' -or $c -eq '}')) {
                # Nested C# braces always count individually, even inside a
                # raw string. Only the outer hole delimiter consumes N braces
                # at once (N dollars for raw strings, one otherwise).
                $context = $contexts.Peek()
                if ($c -eq '{') {
                    $context.HoleDepth++
                    $i++
                }
                elseif ($context.HoleDepth -gt 1) {
                    $context.HoleDepth--
                    $i++
                }
                else {
                    $delimiterLength = 1
                    if ($context.RawRun -gt 0) { $delimiterLength = $context.Dollars }
                    $braceRun = 0
                    while ($i + $braceRun -lt $length -and $chars[$i + $braceRun] -eq '}') { $braceRun++ }
                    if ($braceRun -ge $delimiterLength) {
                        $context.HoleDepth = 0
                        $i += $delimiterLength
                    }
                    else { $i++ }
                }
                continue
            }

            $i++
            continue
        }

        # ----- Literal text of the innermost string. -----
        $context = $contexts.Peek()

        if ($context.RawRun -gt 0) {
            # Raw string: no escapes; it ends at a quote run of at least the
            # opening run. With N '$' prefixes a brace run of N opens a hole.
            if ($c -eq '"') {
                $quoteRun = 0
                while ($i + $quoteRun -lt $length -and $chars[$i + $quoteRun] -eq '"') { $quoteRun++ }
                for ($k = 0; $k -lt $quoteRun; $k++) { $chars[$i + $k] = ' ' }
                $i += $quoteRun
                if ($quoteRun -ge $context.RawRun) {
                    $null = $contexts.Pop()
                }
                continue
            }
            if ($context.Dollars -gt 0 -and ($c -eq '{' -or $c -eq '}')) {
                $braceRun = 0
                while ($i + $braceRun -lt $length -and $chars[$i + $braceRun] -eq $c) { $braceRun++ }
                for ($k = 0; $k -lt $braceRun; $k++) { $chars[$i + $k] = ' ' }
                $i += $braceRun
                if ($c -eq '{' -and $braceRun -ge $context.Dollars) {
                    $context.HoleDepth = 1
                }
                continue
            }
            if ($c -ne "`n" -and $c -ne "`r") { $chars[$i] = ' ' }
            $i++
            continue
        }

        if (-not $context.Verbatim -and $c -eq '\') {
            # Escape sequence: mask the backslash and the next character.
            $chars[$i] = ' '
            if ($i + 1 -lt $length) {
                if ($chars[$i + 1] -ne "`n" -and $chars[$i + 1] -ne "`r") { $chars[$i + 1] = ' ' }
                $i += 2
            }
            else {
                $i++
            }
            continue
        }

        if ($c -eq $context.Quote) {
            if ($context.Verbatim -and $i + 1 -lt $length -and $chars[$i + 1] -eq '"') {
                # Verbatim "" escape: mask both quotes and keep going.
                $chars[$i] = ' '
                $chars[$i + 1] = ' '
                $i += 2
                continue
            }
            $chars[$i] = ' '
            $i++
            $null = $contexts.Pop()
            continue
        }

        if ($context.Dollars -gt 0 -and ($c -eq '{' -or $c -eq '}')) {
            if ($i + 1 -lt $length -and $chars[$i + 1] -eq $c) {
                # A doubled brace in literal text is the escaped literal brace.
                $chars[$i] = ' '
                $chars[$i + 1] = ' '
                $i += 2
                continue
            }
            $chars[$i] = ' '
            $i++
            if ($c -eq '{') {
                # A single opening brace starts an interpolation hole, which
                # is scanned as code until its matching closing brace.
                $context.HoleDepth = 1
            }
            continue
        }

        if ($c -eq "`n" -or $c -eq "`r") {
            if ($context.Verbatim) {
                # Verbatim strings span line breaks: keep masking.
                $i++
                continue
            }
            # A regular string or char literal cannot span lines: the literal
            # was never closed (or was never a literal). Stop masking and
            # resume scanning after the line break.
            $null = $contexts.Pop()
            $i++
            continue
        }

        $chars[$i] = ' '
        $i++
    }

    return [string]::new($chars)
}

function Test-DirectTimeZonePlatformCall {
    <#
    .SYNOPSIS
    True when C# source already masked by Remove-CSharpCommentsAndStringLiterals
    uses TimeZoneInfo.FindSystemTimeZoneById, TryFindSystemTimeZoneById or
    TryConvertIanaIdToWindowsId directly (validator Check 21).

    Matching is case-sensitive, like the C# compiler. Method-group use without
    a call parenthesis counts: the call is just as direct when the method is
    passed as a delegate. Recognized forms: TimeZoneInfo.X, System.TimeZoneInfo.X
    and global::System.TimeZoneInfo.X with any whitespace/newlines around the
    dot; a using-alias qualifier (using X = [global::][System.]TimeZoneInfo;);
    and the bare method name when the file has using static System.TimeZoneInfo;
    (a member access like lookup.FindSystemTimeZoneById stays clean, as does
    OmpTimeZoneLookup's own member name, because the bare match requires that
    no '.' or identifier character precedes). 'global using' directives in the
    file count like plain ones, and the repo-wide ones come in through
    -GlobalUsingStatic/-GlobalAliases because a global using applies to every
    file in the compilation, wherever it is declared.

    nameof(...) never matches: nameof(TimeZoneInfo.FindSystemTimeZoneById) is
    a name lookup, not a call.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$MaskedText,

        # Repo-wide 'global using static [global::][System.]TimeZoneInfo;' seen
        # in any scanned file: the bare method name counts in every file.
        [Parameter(Mandatory = $false)]
        [switch]$GlobalUsingStatic,

        # Repo-wide 'global using X = [global::][System.]TimeZoneInfo;' aliases
        # seen in any scanned file.
        [Parameter(Mandatory = $false)]
        [string[]]$GlobalAliases = @()
    )

    $methods = '(?:FindSystemTimeZoneById|TryFindSystemTimeZoneById|TryConvertIanaIdToWindowsId)'
    # Only the keyword shields a name lookup; xnameof(...) is a real call.
    $nameofGuard = '(?<!(?<!\w)nameof\s*\(\s*)'

    $qualifiedPattern = $nameofGuard + '(?<![\w.:])(?:global::)?(?:System\.)?TimeZoneInfo\s*\.\s*' + $methods + '\b'
    if ([regex]::IsMatch($MaskedText, $qualifiedPattern)) {
        return $true
    }

    $fileHasUsingStatic = $GlobalUsingStatic -or
        [regex]::IsMatch($MaskedText, '(?m)^\s*(?:global\s+)?using\s+static\s+(?:global::)?(?:System\.)?TimeZoneInfo\s*;')
    if ($fileHasUsingStatic) {
        if ([regex]::IsMatch($MaskedText, $nameofGuard + '(?<![\w.])' + $methods + '\b')) {
            return $true
        }
    }

    $aliases = [System.Collections.Generic.List[string]]::new()
    foreach ($aliasMatch in [regex]::Matches($MaskedText, '(?m)^\s*(?:global\s+)?using\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:global::)?(?:System\.)?TimeZoneInfo\s*;')) {
        if (-not $aliases.Contains($aliasMatch.Groups[1].Value)) {
            $aliases.Add($aliasMatch.Groups[1].Value)
        }
    }
    foreach ($globalAlias in @($GlobalAliases)) {
        if (-not $aliases.Contains($globalAlias)) {
            $aliases.Add($globalAlias)
        }
    }
    foreach ($alias in $aliases) {
        $aliasPattern = $nameofGuard + '(?<![\w.])' + [regex]::Escape($alias) + '\s*\.\s*' + $methods + '\b'
        if ([regex]::IsMatch($MaskedText, $aliasPattern)) {
            return $true
        }
    }

    return $false
}

function Get-CSharpGlobalTimeZoneDirectives {
    <#
    .SYNOPSIS
    Returns the 'global using' directives that make direct TimeZoneInfo
    platform calls visible in every file of the compilation (validator
    Check 21): 'global using static [global::][System.]TimeZoneInfo;' and the
    aliases of 'global using X = [global::][System.]TimeZoneInfo;'. The caller
    aggregates the result across the repository's scanned files and passes it
    to Test-DirectTimeZonePlatformCall, because a global using applies
    wherever it is declared. Matching runs on text already masked by
    Remove-CSharpCommentsAndStringLiterals, so a directive mentioned in a
    comment or a string literal does not count.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$MaskedText
    )

    $usingStatic = [regex]::IsMatch($MaskedText, '(?m)^\s*global\s+using\s+static\s+(?:global::)?(?:System\.)?TimeZoneInfo\s*;')
    $aliases = [System.Collections.Generic.List[string]]::new()
    foreach ($aliasMatch in [regex]::Matches($MaskedText, '(?m)^\s*global\s+using\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:global::)?(?:System\.)?TimeZoneInfo\s*;')) {
        if (-not $aliases.Contains($aliasMatch.Groups[1].Value)) {
            $aliases.Add($aliasMatch.Groups[1].Value)
        }
    }

    return [pscustomobject]@{
        UsingStatic = $usingStatic
        Aliases = $aliases
    }
}

function Get-MSBuildGlobalTimeZoneDirectives {
    <#
    .SYNOPSIS
    Collects literal MSBuild Using items that generate global TimeZoneInfo
    static imports or aliases. Test-project trees and generated output are
    excluded. This is a conservative source scan, like the C# directive pass:
    conditional items count without evaluating MSBuild properties/imports.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [string[]]$TestProjectDirectories = @()
    )

    $usingStatic = $false
    $aliases = [System.Collections.Generic.List[string]]::new()
    $pending = [System.Collections.Generic.Stack[string]]::new()
    $pending.Push([IO.Path]::GetFullPath($RepositoryRoot))
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        if ($TestProjectDirectories -contains $directory) { continue }
        foreach ($file in [IO.Directory]::GetFiles($directory)) {
            if ([IO.Path]::GetExtension($file) -notin @('.csproj', '.props', '.targets')) { continue }
            $text = [IO.File]::ReadAllText($file)
            if ($text -notmatch 'TimeZoneInfo') { continue }
            $document = [xml]$text
            foreach ($item in $document.SelectNodes('//*[local-name()="ItemGroup"]/*[local-name()="Using"]')) {
                if ($item.GetAttribute('Include') -cnotmatch '^(?:global::)?System\.TimeZoneInfo$') { continue }
                $staticValue = $item.GetAttribute('Static')
                $aliasValue = $item.GetAttribute('Alias')
                foreach ($metadata in $item.ChildNodes) {
                    if ($metadata.LocalName -eq 'Static') { $staticValue = $metadata.InnerText }
                    if ($metadata.LocalName -eq 'Alias') { $aliasValue = $metadata.InnerText }
                }
                if ($staticValue -ieq 'true') { $usingStatic = $true }
                if ($aliasValue -cmatch '^[A-Za-z_][A-Za-z0-9_]*$' -and -not $aliases.Contains($aliasValue)) {
                    $aliases.Add($aliasValue)
                }
            }
        }
        foreach ($child in [IO.Directory]::GetDirectories($directory)) {
            $name = [IO.Path]::GetFileName($child)
            if ($name -match '^(?i:\.git|\.vs|bin|obj|node_modules|artifacts|TestResults|tests?)$' -or $name -match '(?i)\.tests?$') { continue }
            $pending.Push($child)
        }
    }
    return [pscustomobject]@{ UsingStatic = $usingStatic; Aliases = $aliases }
}

function Test-TimeZoneLookupSourceFile {
    <#
    .SYNOPSIS
    The Check 21 exemption: a file is the sanctioned home for direct platform
    time-zone calls only when its name ends in 'TimeZoneLookup.cs' AND the file
    declares a type named exactly like the file (OmpTimeZoneLookup.cs declares
    'class OmpTimeZoneLookup'). The declaration requirement closes the loophole
    where a file merely carrying the substring in its name
    (NotATimeZoneLookup.cs holding an unrelated class) was exempt without being
    a lookup at all. The declaration is matched case-sensitively against text
    masked by Remove-CSharpCommentsAndStringLiterals, so a comment or a string
    literal cannot satisfy it.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$FileName,

        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$MaskedText
    )

    if ($FileName -notmatch '^[A-Za-z0-9_]*TimeZoneLookup\.cs$') {
        return $false
    }

    $typeName = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $declarationPattern = '\b(?:class|record|struct|interface)\s+' + [regex]::Escape($typeName) + '\b'
    return [regex]::IsMatch($MaskedText, $declarationPattern)
}

function Get-CSharpTestProjectDirectory {
    <#
    .SYNOPSIS
    Absolute paths of directories whose .csproj is a test project, for the
    Check 21 exclusion: the project name ends in '.Test'/'.Tests', or the
    project references Microsoft.NET.Test.Sdk or sets
    <IsTestProject>true</IsTestProject>. Build output, dependency and VCS
    directories are not descended into. This replaces the old 'tests?$' segment
    rule, which also excluded production directories like 'Latest', 'Contest'
    and 'Greatest'.

    Unreadable input is an honest error, never a silent empty answer: a
    missing repository root, a directory that cannot be enumerated and a
    project file that cannot be read all throw, naming the path. An
    unreadable directory that read as "no test projects" would scan the test
    suite as production code -- or worse, skip it silently the other way.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    $fullRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
    if (-not [System.IO.Directory]::Exists($fullRoot)) {
        throw "Get-CSharpTestProjectDirectory: repository root '$RepositoryRoot' does not exist or is not a directory; the Check 21 test-project exclusion cannot be computed."
    }

    $skipDirectories = @('.git', '.vs', 'bin', 'obj', 'node_modules', 'artifacts', 'TestResults')
    $testProjectDirectories = [System.Collections.Generic.List[string]]::new()
    $pendingDirectories = [System.Collections.Generic.Stack[string]]::new()
    $pendingDirectories.Push($fullRoot)

    while ($pendingDirectories.Count -gt 0) {
        $directory = $pendingDirectories.Pop()
        try {
            $projectPaths = [System.IO.Directory]::GetFiles($directory, '*.csproj')
        }
        catch {
            throw "Get-CSharpTestProjectDirectory: cannot list project files in '$directory': $($_.Exception.Message)"
        }
        foreach ($projectPath in $projectPaths) {
            $projectName = [System.IO.Path]::GetFileNameWithoutExtension($projectPath)
            $isTestProject = $projectName -match '(?i)\.tests?$'
            if (-not $isTestProject) {
                try {
                    $projectContent = [System.IO.File]::ReadAllText($projectPath)
                }
                catch {
                    throw "Get-CSharpTestProjectDirectory: cannot read project file '$projectPath': $($_.Exception.Message)"
                }
                $isTestProject = ($projectContent -match 'Microsoft\.NET\.Test\.Sdk') -or
                    ($projectContent -match '(?i)<IsTestProject>\s*true\s*</IsTestProject>')
            }
            if ($isTestProject) {
                $testProjectDirectories.Add($directory)
            }
        }
        try {
            $childDirectories = [System.IO.Directory]::GetDirectories($directory)
        }
        catch {
            throw "Get-CSharpTestProjectDirectory: cannot list subdirectories of '$directory': $($_.Exception.Message)"
        }
        foreach ($childDirectory in $childDirectories) {
            if ($skipDirectories -notcontains [System.IO.Path]::GetFileName($childDirectory)) {
                $pendingDirectories.Push($childDirectory)
            }
        }
    }

    return $testProjectDirectories
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
