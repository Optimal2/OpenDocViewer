# File: release.ps1
<#
.SYNOPSIS
Validates OpenDocViewer and creates the npm version commit/tag locally.

.DESCRIPTION
The helper can run interactively, but every prompt can also be answered through parameters.
Use -ReleaseType to provide the version bump type and -Yes to skip the confirmation prompt.

By default this script prepares a release locally: it validates, bumps the package version,
and creates the release commit and Git tag, but it does NOT push to origin. Pushing the release
requires the explicit -Publish switch, which is the release approval gate for official releases.

The script intentionally does not stage or commit normal application changes. Commit and push
those changes first, then run this helper from a clean working tree.

.PARAMETER ReleaseType
Version bump type passed to `npm version`: patch, minor, or major. When -Publish finds a release
that an earlier run already prepared, no new version is created; -ReleaseType may then be
omitted, and if it is given it must match the prepared version or the script stops without
pushing.

.PARAMETER Yes
Confirms the release summary without prompting. This also applies to the summary shown before
-Publish pushes a release that an earlier run already prepared; without -Yes the script asks
before that push too.

.PARAMETER Publish
Pushes the release commit and tag to origin. This is required to publish an official release.
Without -Publish the release is prepared locally only. If the push fails, a release commit and
tag created by the same run are rolled back; a release prepared by an earlier run is left
untouched.

.PARAMETER SkipValidation
Skips lint/build/JSDoc/agent-doc validation. Use only when those checks have already been run
for the exact commit being released. It has no effect when -Publish pushes a release that an
earlier run already prepared, because no validation runs in that step; the script says so in
the summary.

.EXAMPLE
.\release.ps1 -ReleaseType minor -Yes

Runs a non-interactive minor release locally (no push).

.EXAMPLE
.\release.ps1 -ReleaseType minor -Yes -Publish

Runs a non-interactive minor release and publishes the commit/tag to origin.

.EXAMPLE
.\release.ps1 -ReleaseType patch -Yes -SkipValidation -Publish

Publishes a patch release without repeating validation. Use this only after lint/build/doc/doc:agent
have already passed on the exact commit being released; otherwise prefer running without
-SkipValidation first.
#>
# OpenDocViewer release helper (release-only workflow, Windows-friendly)
#
# Expected workflow:
#   1. Make code/documentation changes.
#   2. Commit and push those changes manually, for example with GitHub Desktop.
#   3. Run this script to validate, bump package version, and create the release commit/tag.
#      By default the release is prepared locally and NOT pushed.
#   4. If this is an approved official release, rerun with -Publish to push the commit/tag.
#      Pushing the vX.Y.Z tag AUTO-triggers .github/workflows/release.yml, which builds and
#      publishes the GitHub release. The single approval gate is running this with -Publish; do
#      NOT re-add a second workflow_dispatch / approve_release gate (an AI change on 2026-06-28,
#      commit 964fa3f, did that and broke the flow; reverted 2026-07-24). See AGENTS.md +
#      docs-src/CODEX_DEVELOPMENT.md ("Release workflow").
#
# This script intentionally does NOT commit application changes and does NOT stash changes.
# It stages the generated release outputs with `git add --all` only after validating that the
# working tree is clean and the current branch already matches origin/<branch>.

param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$ReleaseType = '',

  [switch]$Yes,

  [switch]$Publish,

  [switch]$SkipValidation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Format-CommandLineArgs($a) {
  if (-not $a) { return '' }
  # Display-only formatter for log output. Process execution uses ArgumentList below so
  # PowerShell/.NET perform native argument quoting instead of relying on this summary string.
  return ($a | ForEach-Object {
    if ($_ -match '[\s"|\\]') { '"' + ($_ -replace '(["\\])', '\\$1') + '"' } else { $_ }
  }) -join ' '
}

function Exec {
  param(
    [Parameter(Mandatory)][string]$File,
    [string[]]$Args = @(),
    [string]$Cwd = $null,
    [switch]$AllowNonZero,
    [switch]$Quiet,
    [int]$TimeoutSeconds = 1800
  )

  $as = Format-CommandLineArgs $Args
  if (-not $Quiet) {
    if ($Cwd) { Write-Host "==> ($Cwd) $File $as" -ForegroundColor Cyan }
    else      { Write-Host "==> $File $as" -ForegroundColor Cyan }
  }

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $File
  foreach ($arg in $Args) {
    [void]$psi.ArgumentList.Add($arg)
  }
  if ($Cwd) { $psi.WorkingDirectory = $Cwd }
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $p = [System.Diagnostics.Process]::new()
  $p.StartInfo = $psi
  $null = $p.Start()

  # Read asynchronously to avoid stdout/stderr pipe deadlocks on verbose commands.
  $stdoutTask = $p.StandardOutput.ReadToEndAsync()
  $stderrTask = $p.StandardError.ReadToEndAsync()
  $timeoutMs = [Math]::Max(1, $TimeoutSeconds) * 1000
  if (-not $p.WaitForExit($timeoutMs)) {
    try { $p.Kill($true) } catch {}
    throw "Command timed out after $TimeoutSeconds second(s): $File $as"
  }

  $o = $stdoutTask.GetAwaiter().GetResult()
  $e = $stderrTask.GetAwaiter().GetResult()

  if (-not $Quiet -and $o) { Write-Host $o.TrimEnd() }
  # With -AllowNonZero the caller reads Code/Err and words its own message. Writing stderr to the
  # error stream here would end the script (ErrorActionPreference is Stop) with the command's
  # raw text instead of that message.
  if ($p.ExitCode -ne 0 -and -not $AllowNonZero) {
    $detail = if ($e) { "`n" + $e.TrimEnd() } else { '' }
    throw "Command failed ($File $as) with exit code $($p.ExitCode).$detail"
  }

  return @{ Code = $p.ExitCode; Out = $o; Err = $e }
}

function ExecNpm {
  param(
    [string[]]$NpmArgs,
    [string]$Cwd,
    [switch]$Quiet
  )

  $cmd = $env:ComSpec
  if (-not $cmd) { $cmd = 'cmd.exe' }
  $allArgs = @('/d', '/c', 'npm') + $NpmArgs
  return Exec -File $cmd -Args $allArgs -Cwd $Cwd -Quiet:$Quiet
}

function ReadNonEmpty([string]$Prompt) {
  $v = Read-Host $Prompt
  if ([string]::IsNullOrWhiteSpace($v)) { throw 'Input cannot be empty.' }
  return $v.Trim()
}

function Assert-CleanWorkingTree([string]$RepoRoot, [string]$Context) {
  # Content-based, not stat-based: core.autocrlf=true checks files out with CRLF while the
  # docs-agent generator (run by the pre-push gate and by the validation ladder) writes LF, so
  # the worktree file is smaller than the size git cached at checkout. git status reports such
  # a file as modified without comparing content, although `git diff` is empty. The tree is
  # dirty only when content differs from HEAD (unstaged or staged) or untracked files exist.
  $unstaged  = (Exec 'git' @('diff', '--name-only') -Cwd $RepoRoot -Quiet).Out
  $staged    = (Exec 'git' @('diff', '--cached', '--name-only') -Cwd $RepoRoot -Quiet).Out
  $untracked = (Exec 'git' @('ls-files', '--others', '--exclude-standard') -Cwd $RepoRoot -Quiet).Out
  $dirty = -not ([string]::IsNullOrWhiteSpace($unstaged) -and [string]::IsNullOrWhiteSpace($staged) -and [string]::IsNullOrWhiteSpace($untracked))
  if ($dirty) {
    $porcelain = (Exec 'git' @('status', '--porcelain') -Cwd $RepoRoot -Quiet).Out
    throw @"
Working tree is not clean $Context.

This release script no longer stages, commits, or stashes application changes.
Commit and push all intended changes first, or discard unintended local changes, then rerun.

Current status:
$porcelain
"@
  }
}

function Get-PackageVersion([string]$RepoRoot) {
  $pkgPath = Join-Path $RepoRoot 'package.json'
  $pkg = Get-Content -Raw -Path $pkgPath | ConvertFrom-Json
  if (-not $pkg.version) { throw 'Missing version field in package.json.' }
  return [string]$pkg.version
}

function Wait-ForRemoteTag([string]$RepoRoot, [string]$TagName) {
  for ($i = 1; $i -le 5; $i++) {
    $result = (Exec 'git' @('ls-remote', '--tags', 'origin', $TagName) -Cwd $RepoRoot -AllowNonZero -Quiet).Out.Trim()
    if ($result) { return $result }
    Start-Sleep -Seconds 2
  }

  return ''
}

# --- Decisions for publishing a release that an earlier run prepared -----------------------
# These functions decide and format only; they run no command and change nothing, so
# scripts/release.Tests.ps1 can test them without running this script.

function Get-ReleaseTypeBetween([string]$BaseVersion, [string]$NewVersion) {
  # The `npm version` step that turns BaseVersion into NewVersion: patch, minor or major.
  # Empty when the two are not exactly one such step apart or are not plain X.Y.Z versions.
  $pattern = '^(\d+)\.(\d+)\.(\d+)$'
  $base = [regex]::Match("$BaseVersion".Trim(), $pattern)
  $new = [regex]::Match("$NewVersion".Trim(), $pattern)
  if (-not $base.Success -or -not $new.Success) { return '' }
  $b = @(1, 2, 3 | ForEach-Object { [long]$base.Groups[$_].Value })
  $n = @(1, 2, 3 | ForEach-Object { [long]$new.Groups[$_].Value })
  if ($n[0] -eq $b[0] + 1 -and $n[1] -eq 0 -and $n[2] -eq 0) { return 'major' }
  if ($n[0] -eq $b[0] -and $n[1] -eq $b[1] + 1 -and $n[2] -eq 0) { return 'minor' }
  if ($n[0] -eq $b[0] -and $n[1] -eq $b[1] -and $n[2] -eq $b[2] + 1) { return 'patch' }
  return ''
}

function Test-PreparedRelease {
  # True only for exactly one release commit on top of origin, carrying its own tag. Pass an
  # empty string for a value that could not be read.
  param(
    [string]$LocalHead,
    [string]$RemoteHead,
    [string]$ParentHead,
    [string]$TagCommit,
    [string]$Subject,
    [string]$Version
  )

  if ([string]::IsNullOrWhiteSpace($LocalHead) -or [string]::IsNullOrWhiteSpace($RemoteHead)) { return $false }
  if ([string]::IsNullOrWhiteSpace($Version)) { return $false }
  return ($ParentHead -eq $RemoteHead) -and ($TagCommit -eq $LocalHead) -and ($Subject -eq "chore(release): $Version")
}

function Get-PreparedReleaseArgumentProblem {
  # Empty when -ReleaseType is omitted or names the step the prepared release actually is.
  # Otherwise the message to stop with: the prepared version is what would be published, so a
  # different -ReleaseType must not be ignored silently.
  param(
    [string]$ReleaseType,
    [string]$BaseVersion,
    [string]$PreparedVersion
  )

  if ([string]::IsNullOrWhiteSpace($ReleaseType)) { return '' }
  $requested = $ReleaseType.Trim().ToLowerInvariant()
  $actual = Get-ReleaseTypeBetween $BaseVersion $PreparedVersion
  if ($actual -eq $requested) { return '' }

  $what = if ($actual) { "a $actual release" } else { 'not a single patch, minor or major step, or could not be read' }
  return @"
-ReleaseType $ReleaseType does not match the prepared release.

The release commit prepared by an earlier run goes from $BaseVersion -> $PreparedVersion, which is $what.
Nothing was pushed, and the prepared release commit and tag are unchanged.

To publish the prepared release as it is, rerun with -Publish and without -ReleaseType (or with the
matching type). To release a different version, remove the prepared commit and tag yourself first.
"@
}

function Get-PreparedReleaseNotices {
  # Arguments that have no effect on a prepared release are reported, never ignored silently.
  param([bool]$SkipValidation)

  $notices = @()
  if ($SkipValidation) {
    $notices += '-SkipValidation has no effect here: a prepared release is pushed exactly as it was prepared, and no validation runs in this step. Validation ran, or was skipped, when the release commit was created.'
  }
  return $notices
}

function Format-PreparedReleaseSummary {
  param(
    [string]$RepoRoot,
    [string]$Branch,
    [string]$BaseVersion,
    [string]$Version,
    [string]$TagName,
    [string]$ReleaseCommit,
    [string]$BaseCommit,
    [string[]]$Notices = @()
  )

  $step = Get-ReleaseTypeBetween $BaseVersion $Version
  $stepText = if ($step) { " ($step)" } else { '' }
  $lines = @(
    ''
    'A release prepared by an earlier run was found. Nothing is bumped or validated again.'
    ''
    'Summary:'
    "  Repo root:        $RepoRoot"
    "  Branch:           $Branch"
    "  Version:          $BaseVersion -> $Version$stepText"
    "  Tag:              $TagName"
    "  Release commit:   $ReleaseCommit"
    "  Base commit:      $BaseCommit (origin/$Branch)"
    "  Will push:        git push origin $Branch --follow-tags"
    "                    = the release commit to origin/$Branch, and the tag $TagName"
    "  Effect:           the tag push starts the Release workflow, which publishes the GitHub release."
  )
  foreach ($notice in @($Notices)) {
    if ($notice) { $lines += "  Note:             $notice" }
  }
  $lines += ''
  return ($lines -join "`n")
}

function Confirm-PreparedReleasePublish {
  # Shows the summary and returns whether the prepared release may be pushed: always with -Yes,
  # otherwise only when the answer is Y.
  param(
    [string]$Summary,
    [bool]$Yes,
    [scriptblock]$Prompt = { Read-Host 'Publish this prepared release? (Y/N)' }
  )

  Write-Host $Summary
  if ($Yes) { return $true }
  $answer = & $Prompt
  return ("$answer".Trim().ToUpperInvariant() -eq 'Y')
}

function Get-PushFailureRollback {
  # The git commands that undo a failed publish. Only a release commit and tag created by the
  # same run are removed. A release prepared by an earlier run is left exactly as it is: this
  # run did not create it, and deleting the tag or resetting the branch would leave the
  # prepared release reachable through the reflog only.
  param(
    [bool]$CreatedInThisRun,
    [string]$TagName,
    [string]$PrevHead
  )

  $steps = @()
  if (-not $CreatedInThisRun -or [string]::IsNullOrWhiteSpace($PrevHead)) { return $steps }
  if ($TagName) { $steps += [pscustomobject]@{ GitArgs = @('tag', '-d', $TagName) } }
  $steps += [pscustomobject]@{ GitArgs = @('reset', '--hard', $PrevHead) }
  return $steps
}

# Resolve repo root from script path; work there regardless of current shell location.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
try {
  $repoRoot = (Exec 'git' @('rev-parse', '--show-toplevel') -Cwd $scriptDir -Quiet).Out.Trim()
} catch {
  $repoRoot = $null
}
if (-not $repoRoot) {
  if (Test-Path (Join-Path $scriptDir '.git')) { $repoRoot = $scriptDir }
  else { throw 'Not inside a Git working tree.' }
}

$inside = (Exec 'git' @('rev-parse', '--is-inside-work-tree') -Cwd $repoRoot -Quiet).Out.Trim()
if ($inside -ne 'true') { throw "Git says this is not a working tree: $repoRoot" }

$branch = (Exec 'git' @('rev-parse', '--abbrev-ref', 'HEAD') -Cwd $repoRoot -Quiet).Out.Trim()
if ([string]::IsNullOrWhiteSpace($branch) -or $branch -eq 'HEAD') {
  throw 'Detached HEAD is not supported. Check out the release branch first.'
}

$hasRemote = $true
try { $null = Exec 'git' @('remote', 'get-url', 'origin') -Cwd $repoRoot -Quiet }
catch { $hasRemote = $false }
if (-not $hasRemote) { throw "Missing 'origin' remote. Release publishing requires origin." }

$null = Exec 'git' @('fetch', 'origin', '--tags', '--prune') -Cwd $repoRoot -Quiet

$remoteRefCheck = Exec 'git' @('rev-parse', '--verify', "origin/$branch") -Cwd $repoRoot -AllowNonZero -Quiet
if ($remoteRefCheck.Code -ne 0) { throw "Remote branch origin/$branch does not exist or has not been fetched." }

Assert-CleanWorkingTree $repoRoot 'before release validation'

$localHead = (Exec 'git' @('rev-parse', 'HEAD') -Cwd $repoRoot -Quiet).Out.Trim()
$remoteHead = (Exec 'git' @('rev-parse', "origin/$branch") -Cwd $repoRoot -Quiet).Out.Trim()
$preparedRelease = $false
if ($Publish -and $localHead -ne $remoteHead) {
  # A previous non-publish run may already have created exactly one release commit/tag.
  # Recognize that state so -Publish publishes it instead of demanding equality or bumping again.
  $preparedVersion = Get-PackageVersion $repoRoot
  $preparedTag = "v$preparedVersion"
  $parentCheck = Exec 'git' @('rev-parse', 'HEAD^') -Cwd $repoRoot -AllowNonZero -Quiet
  $tagCheck = Exec 'git' @('rev-parse', "$preparedTag^{commit}") -Cwd $repoRoot -AllowNonZero -Quiet
  $subjectCheck = Exec 'git' @('log', '-1', '--format=%s') -Cwd $repoRoot -AllowNonZero -Quiet
  $readOut = { param($check) if ($check.Code -eq 0) { "$($check.Out)".Trim() } else { '' } }
  $preparedRelease = Test-PreparedRelease -LocalHead $localHead -RemoteHead $remoteHead `
    -ParentHead (& $readOut $parentCheck) -TagCommit (& $readOut $tagCheck) `
    -Subject (& $readOut $subjectCheck) -Version $preparedVersion
}
if ($localHead -ne $remoteHead -and -not $preparedRelease) {
  throw @"
Local branch does not match origin/$branch.

This script expects application changes to already be committed and pushed before release.
Resolve the difference first, then rerun.

Local HEAD:  $localHead
Remote HEAD: $remoteHead
"@
}

if (-not $preparedRelease) {
Write-Host "=== OpenDocViewer Release Helper ===`n"
Write-Host 'Release-only mode: application code must already be committed and pushed.' -ForegroundColor Yellow
Write-Host 'This script will not run git add, will not commit application changes, and will not stash.' -ForegroundColor Yellow
if ($Publish) {
  Write-Host 'It will validate, run npm version, create the release commit/tag, and push to origin.' -ForegroundColor Yellow
} else {
  Write-Host 'It will validate, run npm version, and create the release commit/tag locally (no push).' -ForegroundColor Yellow
}
Write-Host 'Official release publishing requires the -Publish switch.' -ForegroundColor Yellow
Write-Host 'Note: SECURITY.md is not updated automatically by this script.' -ForegroundColor Yellow
Write-Host 'Before release, make sure SECURITY.md already matches the version you are about to publish:' -ForegroundColor Yellow
Write-Host '  - Supported Versions' -ForegroundColor Yellow
Write-Host "  - Recent release context`n" -ForegroundColor Yellow

if ([string]::IsNullOrWhiteSpace($ReleaseType)) {
  $ReleaseType = ReadNonEmpty 'Release type (patch | minor | major)'
}
$ReleaseType = $ReleaseType.ToLowerInvariant()
if (@('patch', 'minor', 'major') -notcontains $ReleaseType) {
  throw 'Invalid release type. Use: patch, minor, or major.'
}

$currentVersion = Get-PackageVersion $repoRoot
$publishFlag = if ($Publish) { 'YES' } else { 'NO (local only)' }
Write-Host "`nSummary:`n  Repo root:        $repoRoot`n  Branch:           $branch`n  Current version:  $currentVersion`n  Release type:     $ReleaseType`n  Publish:          $publishFlag`n  Base commit:      $localHead`n"

if (-not $Yes) {
  if ((Read-Host 'Proceed? (Y/N)').ToUpperInvariant() -ne 'Y') {
    Write-Host 'Aborted.'
    exit 0
  }
}

if (-not $SkipValidation) {
  Write-Host "`nRunning pre-release validation (lint, build, doc, agent docs)..." -ForegroundColor Yellow
  $null = ExecNpm -NpmArgs @('run', 'lint')  -Cwd $repoRoot
  $null = ExecNpm -NpmArgs @('run', 'build') -Cwd $repoRoot
  $null = ExecNpm -NpmArgs @('run', 'doc')   -Cwd $repoRoot
  # doc:agent regenerates the committed docs-agent packet; the clean-tree
  # assertion below intentionally fails if release prep forgot to commit it.
  $null = ExecNpm -NpmArgs @('run', 'doc:agent') -Cwd $repoRoot
  Write-Host 'Validation passed.' -ForegroundColor Green
  Assert-CleanWorkingTree $repoRoot 'after validation'
} else {
  Write-Warning 'Skipping validation by request.'
}

$prevHead = (Exec 'git' @('rev-parse', 'HEAD') -Cwd $repoRoot -Quiet).Out.Trim()

# Version bump without commit/tag, then everything the pre-push gate expects to travel WITH a
# package.json change lands in the same release commit:
#   - docs-agent regenerated for the NEW version (the agent-documentation freshness check
#     rejects a packet generated before the bump),
#   - the OMP component bump (the canonical LOCKSTEP check rejects a change under a component's
#     project files without a bump of omp-components.json + repositoryVersion + module definition).
# A single `npm version` commit could satisfy neither, which blocked the push in practice.
Write-Host "`nBumping the package version ($ReleaseType) without a commit..." -ForegroundColor Yellow
$null = ExecNpm -NpmArgs @('version', $ReleaseType, '--no-git-tag-version') -Cwd $repoRoot

$newVersion = Get-PackageVersion $repoRoot
$tagName = "v$newVersion"

Write-Host "Regenerating the agent documentation packet for $newVersion..." -ForegroundColor Yellow
$null = ExecNpm -NpmArgs @('run', 'doc:agent') -Cwd $repoRoot

Write-Host 'Bumping the OMP component version so the release commit passes the lockstep gate...' -ForegroundColor Yellow
# A PowerShell script invoked with & sets $LASTEXITCODE only when it calls exit, so under
# Set-StrictMode the variable may not exist after a successful run. Seed it first and also
# honour $? (false after a terminating error inside the script).
$global:LASTEXITCODE = 0
& (Join-Path $repoRoot 'scripts/omp/bump-version.ps1') -ComponentKey 'opendocviewer-web'
if (-not $? -or $LASTEXITCODE -ne 0) { throw "scripts/omp/bump-version.ps1 failed (exit code $LASTEXITCODE)" }

Write-Host "Creating release commit and tag $tagName..." -ForegroundColor Yellow
$null = Exec 'git' @('add', '--all') -Cwd $repoRoot
$null = Exec 'git' @('commit', '-m', "chore(release): $newVersion") -Cwd $repoRoot
$null = Exec 'git' @('tag', '-a', $tagName, '-m', "chore(release): $newVersion") -Cwd $repoRoot

if (-not $Publish) {
  Write-Host "`nDone. Local release commit/tag created for $tagName." -ForegroundColor Green
  Write-Host 'The release was NOT pushed. To publish this official release, run:' -ForegroundColor Yellow
  Write-Host "  .\release.ps1 -ReleaseType $ReleaseType -Yes -Publish" -ForegroundColor Yellow
  Write-Host 'The second run recognizes the prepared release and publishes it without another version bump.' -ForegroundColor Yellow
  exit 0
}
} else {
  $newVersion = Get-PackageVersion $repoRoot
  $tagName = "v$newVersion"
  # This run created neither the commit nor the tag, so it has nothing of its own to roll back.
  $prevHead = ''

  # The version the prepared release started from: package.json in the commit origin is at.
  $baseVersion = ''
  $basePackage = Exec 'git' @('show', "${remoteHead}:package.json") -Cwd $repoRoot -AllowNonZero -Quiet
  if ($basePackage.Code -eq 0) {
    try { $baseVersion = [string]($basePackage.Out | ConvertFrom-Json).version } catch { $baseVersion = '' }
  }

  # A prepared release is published as it is. Arguments that would ask for something else
  # stop the run or are reported in the summary; none is ignored silently.
  $preparedProblem = Get-PreparedReleaseArgumentProblem -ReleaseType $ReleaseType -BaseVersion $baseVersion -PreparedVersion $newVersion
  if ($preparedProblem) { throw $preparedProblem }

  $preparedSummary = Format-PreparedReleaseSummary -RepoRoot $repoRoot -Branch $branch `
    -BaseVersion $baseVersion -Version $newVersion -TagName $tagName `
    -ReleaseCommit $localHead -BaseCommit $remoteHead `
    -Notices (Get-PreparedReleaseNotices -SkipValidation $SkipValidation.IsPresent)
  if (-not (Confirm-PreparedReleasePublish -Summary $preparedSummary -Yes $Yes.IsPresent)) {
    Write-Host 'Aborted. Nothing was pushed; the prepared release commit and tag are unchanged.'
    exit 0
  }
  Write-Host "Publishing the release commit/tag already prepared for $tagName (no second version bump)." -ForegroundColor Yellow
}

try {
  Write-Host "`nPushing release commit and tag..." -ForegroundColor Yellow
  $null = Exec 'git' @('push', 'origin', $branch, '--follow-tags') -Cwd $repoRoot
} catch {
  $pushError = $_
  $rollback = @(Get-PushFailureRollback -CreatedInThisRun (-not $preparedRelease) -TagName $tagName -PrevHead $prevHead)
  if ($rollback.Count -eq 0) {
    Write-Warning "Push failed. The release commit and tag $tagName were not created by this run and are left untouched. Fix the cause of the failure and rerun with -Publish."
    throw $pushError
  }

  Write-Warning "Push failed. Rolling local release commit/tag back to $prevHead."
  try {
    foreach ($step in $rollback) { $null = Exec 'git' $step.GitArgs -Cwd $repoRoot }
  } catch {
    throw "Push failed and automatic rollback also failed. Original push error: $($pushError.Exception.Message) Rollback error: $($_.Exception.Message)"
  }

  throw $pushError
}

# Post-push verification.
$null = Exec 'git' @('fetch', 'origin', '--tags') -Cwd $repoRoot -Quiet
$localAfter = (Exec 'git' @('rev-parse', 'HEAD') -Cwd $repoRoot -Quiet).Out.Trim()
$remoteAfter = (Exec 'git' @('rev-parse', "origin/$branch") -Cwd $repoRoot -Quiet).Out.Trim()
$tagRemote = Wait-ForRemoteTag $repoRoot $tagName

if ($localAfter -ne $remoteAfter) {
  Write-Warning "Push verification: local HEAD != origin/$branch. Review with: git log HEAD...origin/$branch --oneline"
}
if (-not $tagRemote) {
  Write-Warning "Push verification: tag $tagName is not visible on origin yet."
}

Write-Host "`nDone. Published release commit/tag for $tagName." -ForegroundColor Green
Write-Host 'CI should now build and publish release artifacts.'
