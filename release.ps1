# File: release.ps1
# OpenDocViewer release helper (release-only workflow, Windows-friendly)
#
# Expected workflow:
#   1. Make code/documentation changes.
#   2. Commit and push those changes manually, for example with GitHub Desktop.
#   3. Run this script to validate, bump package version, create the release commit/tag,
#      and push the release commit/tag.
#
# This script intentionally does NOT run `git add`, does NOT commit application changes,
# and does NOT stash changes. The working tree must be clean and the current branch must
# already match origin/<branch> before the release version bump is created.

param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$ReleaseType = '',

  [switch]$Yes,

  [switch]$SkipValidation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Format-CommandLineArgs($a) {
  if (-not $a) { return '' }
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
    [switch]$Quiet
  )

  $as = Format-CommandLineArgs $Args
  if (-not $Quiet) {
    if ($Cwd) { Write-Host "==> ($Cwd) $File $as" -ForegroundColor Cyan }
    else      { Write-Host "==> $File $as" -ForegroundColor Cyan }
  }

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $File
  $psi.Arguments = $as
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
  $p.WaitForExit()
  $o = $stdoutTask.GetAwaiter().GetResult()
  $e = $stderrTask.GetAwaiter().GetResult()

  if (-not $Quiet -and $o) { Write-Host $o.TrimEnd() }
  if ($p.ExitCode -ne 0 -and $e) { Write-Error $e.TrimEnd() }
  if ($p.ExitCode -ne 0 -and -not $AllowNonZero) {
    throw "Command failed ($File $as) with exit code $($p.ExitCode)."
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
  $porcelain = (Exec 'git' @('status', '--porcelain') -Cwd $RepoRoot -Quiet).Out
  if (-not [string]::IsNullOrWhiteSpace($porcelain)) {
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
if ($localHead -ne $remoteHead) {
  throw @"
Local branch does not match origin/$branch.

This script expects application changes to already be committed and pushed before release.
Resolve the difference first, then rerun.

Local HEAD:  $localHead
Remote HEAD: $remoteHead
"@
}

Write-Host "=== OpenDocViewer Release Helper ===`n"
Write-Host 'Release-only mode: application code must already be committed and pushed.' -ForegroundColor Yellow
Write-Host 'This script will not run git add, will not commit application changes, and will not stash.' -ForegroundColor Yellow
Write-Host "It will only validate, run npm version, create the release commit/tag, and push that release commit/tag.`n" -ForegroundColor Yellow
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
Write-Host "`nSummary:`n  Repo root:        $repoRoot`n  Branch:           $branch`n  Current version:  $currentVersion`n  Release type:     $ReleaseType`n  Base commit:      $localHead`n"

if (-not $Yes) {
  if ((Read-Host 'Proceed? (Y/N)').ToUpperInvariant() -ne 'Y') {
    Write-Host 'Aborted.'
    exit 0
  }
}

if (-not $SkipValidation) {
  Write-Host "`nRunning pre-release validation (lint, build, doc)..." -ForegroundColor Yellow
  $null = ExecNpm -NpmArgs @('run', 'lint')  -Cwd $repoRoot
  $null = ExecNpm -NpmArgs @('run', 'build') -Cwd $repoRoot
  $null = ExecNpm -NpmArgs @('run', 'doc')   -Cwd $repoRoot
  Write-Host 'Validation passed.' -ForegroundColor Green
  Assert-CleanWorkingTree $repoRoot 'after validation'
} else {
  Write-Warning 'Skipping validation by request.'
}

$prevHead = (Exec 'git' @('rev-parse', 'HEAD') -Cwd $repoRoot -Quiet).Out.Trim()

# Version bump via package.json scripts. This creates the release commit and tag through npm version.
Write-Host "`nCreating release commit and tag via npm run release:$ReleaseType..." -ForegroundColor Yellow
$null = ExecNpm -NpmArgs @('run', '--silent', "release:$ReleaseType") -Cwd $repoRoot

$newVersion = Get-PackageVersion $repoRoot
$tagName = "v$newVersion"

try {
  Write-Host "`nPushing release commit and tag..." -ForegroundColor Yellow
  $null = Exec 'git' @('push', 'origin', $branch, '--follow-tags') -Cwd $repoRoot
} catch {
  Write-Warning "Push failed. Rolling local release commit/tag back to $prevHead."
  if ($tagName) { $null = Exec 'git' @('tag', '-d', $tagName) -Cwd $repoRoot -AllowNonZero }
  $null = Exec 'git' @('reset', '--hard', $prevHead) -Cwd $repoRoot -AllowNonZero
  throw
}

# Post-push verification.
$null = Exec 'git' @('fetch', 'origin', '--tags') -Cwd $repoRoot -Quiet
$localAfter = (Exec 'git' @('rev-parse', 'HEAD') -Cwd $repoRoot -Quiet).Out.Trim()
$remoteAfter = (Exec 'git' @('rev-parse', "origin/$branch") -Cwd $repoRoot -Quiet).Out.Trim()
$tagRemote = (Exec 'git' @('ls-remote', '--tags', 'origin', $tagName) -Cwd $repoRoot -AllowNonZero -Quiet).Out.Trim()

if ($localAfter -ne $remoteAfter) {
  Write-Warning "Push verification: local HEAD != origin/$branch. Review with: git log HEAD...origin/$branch --oneline"
}
if (-not $tagRemote) {
  Write-Warning "Push verification: tag $tagName is not visible on origin yet."
}

Write-Host "`nDone. Published release commit/tag for $tagName." -ForegroundColor Green
Write-Host 'CI should now build and publish release artifacts.'
