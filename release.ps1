# File: release.ps1
# Interactive release helper for OpenDocViewer
# - Prompts for commit message and release type (patch/minor/major)
# - Validates environment (git/npm), repo root, branch, remote
# - Adds all changes, commits (if there are changes), bumps version, pushes branch + tags
# - Captures stdout/stderr reliably and does not abort on harmless warnings
# - Rolls back version/tag if push fails

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'

function Join-Args {
  param([string[]]$Parts)
  if (-not $Parts) { return '' }
  return ($Parts | ForEach-Object {
    if ($_ -match '[\s"|\\]') { '"' + ($_ -replace '(["\\])','\\$1') + '"' } else { $_ }
  }) -join ' '
}

function Exec {
  param(
    [Parameter(Mandatory)] [string]$Command,
    [Parameter()] [string[]]$CommandArgs = @(),
    [Parameter()] [string]$WorkingDirectory = $null,
    [switch]$AllowNonZero,
    [switch]$Quiet
  )
  $argString = Join-Args $CommandArgs
  if (-not $Quiet) {
    if ($WorkingDirectory) { Write-Host "==> ($WorkingDirectory) $Command $argString" -ForegroundColor Cyan }
    else { Write-Host "==> $Command $argString" -ForegroundColor Cyan }
  }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Command
  $psi.Arguments = $argString
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $null = $p.Start()
  $stdOut = $p.StandardOutput.ReadToEnd()
  $stdErr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()

  if ($stdOut) { Write-Host $stdOut.TrimEnd() }
  if ($stdErr) {
    if ($p.ExitCode -eq 0) { Write-Warning $stdErr.TrimEnd() } else { Write-Error $stdErr.TrimEnd() }
  }

  if ($p.ExitCode -ne 0 -and -not $AllowNonZero) {
    throw "Command failed ($Command $argString) with exit code $($p.ExitCode)."
  }
  return @{ ExitCode=$p.ExitCode; StdOut=$stdOut; StdErr=$stdErr }
}

function Require-Cmd {
  param([Parameter(Mandatory)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name (is it installed and on PATH?)"
  }
}

function Read-NonEmpty {
  param([Parameter(Mandatory)][string]$Prompt)
  $v = Read-Host $Prompt
  if ([string]::IsNullOrWhiteSpace($v)) {
    throw "Input cannot be empty."
  }
  return $v
}

Write-Host "=== OpenDocViewer Release Helper ===`n"

# Preflight: tools
Require-Cmd 'git'
Require-Cmd 'npm'

# Determine repo root based on the script's directory (robust when invoked via full path)
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not (Test-Path $ScriptDir)) { throw "Script directory not found: $ScriptDir" }

# Try to resolve Git toplevel using the script directory (works even if current location is elsewhere)
$repoRoot = $null
try {
  $top = (Exec 'git' @('rev-parse','--show-toplevel') -WorkingDirectory $ScriptDir -Quiet).StdOut.Trim()
  if ($top) { $repoRoot = $top }
} catch {
  # Fallback: if a .git folder is present in the script directory, assume repo root there
  if (Test-Path (Join-Path $ScriptDir '.git')) { $repoRoot = $ScriptDir }
}

if (-not $repoRoot) {
  throw "Not inside a Git working tree. Ensure the script resides in (or under) a Git repository."
}
if (-not (Test-Path (Join-Path $repoRoot '.git'))) {
  throw "Resolved repo root has no .git directory: $repoRoot"
}

# Preflight: repo status
$inside = (Exec 'git' @('rev-parse','--is-inside-work-tree') -WorkingDirectory $repoRoot -Quiet).StdOut.Trim()
if ($inside -ne 'true') { throw "Git reports this is not a working tree: $repoRoot" }

$branch = (Exec 'git' @('rev-parse','--abbrev-ref','HEAD') -WorkingDirectory $repoRoot -Quiet).StdOut.Trim()
if ([string]::IsNullOrWhiteSpace($branch)) { $branch = 'main' }

# Optional: check remote & divergence (best-effort)
$hasRemote = $true
try { $null = Exec 'git' @('remote','get-url','origin') -WorkingDirectory $repoRoot -Quiet } catch { $hasRemote = $false }
if ($hasRemote) {
  Exec 'git' @('fetch','--tags','--prune') -WorkingDirectory $repoRoot | Out-Null
  $div = Exec 'git' @('rev-list','--left-right','--count',"origin/$branch...$branch") -WorkingDirectory $repoRoot -AllowNonZero -Quiet
  if ($div.ExitCode -eq 0) {
    $counts = ($div.StdOut.Trim() -split '\s+')
    if ($counts.Count -ge 2) {
      $behind = [int]$counts[0]
      $ahead  = [int]$counts[1]
      if ($behind -gt 0) {
        Write-Warning "Your branch is behind origin/$branch by $behind commits."
        $pull = Read-Host "Pull latest from origin/$branch now? (Y/N)"
        if ($pull.ToUpper() -eq 'Y') { Exec 'git' @('pull','--rebase','origin',$branch) -WorkingDirectory $repoRoot }
      }
      if ($ahead -gt 0) {
        Write-Host "Note: You are ahead of origin/$branch by $ahead commits." -ForegroundColor Yellow
      }
    }
  }
}

# 1) Commit message
$commitMsg = Read-NonEmpty "Commit message (e.g. chore(deps): bump axios to 1.12.1)"

# 2) Release type
$releaseType = Read-NonEmpty "Release type (patch | minor | major)"
$valid = @('patch','minor','major')
if (-not $valid.Contains($releaseType.ToLower())) {
  throw "Invalid release type. Use: patch, minor, or major."
}

# 3) Summary
Write-Host "`nSummary:"
Write-Host "  Repo root:     $repoRoot"
Write-Host "  Branch:        $branch"
Write-Host "  Commit:        $commitMsg"
Write-Host "  Release type:  $releaseType"
Write-Host ""

$confirm = Read-NonEmpty "Proceed? (Y/N)"
if ($confirm.ToUpper() -ne 'Y') {
  Write-Host "Aborted."
  exit 0
}

# 4) Add & commit (skip if nothing changed)
Write-Host "`n==> Staging changes"
Exec 'git' @('add','-A') -WorkingDirectory $repoRoot

Write-Host "==> Committing (will skip if nothing to commit)"
$commitResult = Exec 'git' @('commit','-m', $commitMsg) -WorkingDirectory $repoRoot -AllowNonZero
if ($commitResult.ExitCode -ne 0) {
  Write-Host "No changes to commit (or commit failed without exit code 0). Continuing..."
}

# Save state for potential rollback
$prevRef = (Exec 'git' @('rev-parse','HEAD') -WorkingDirectory $repoRoot -Quiet).StdOut.Trim()

# 5) Version bump (creates commit + tag)
Write-Host "==> Bumping version with npm version $releaseType"
Exec 'npm' @('version', $releaseType, '-m', 'chore(release): %s') -WorkingDirectory $repoRoot

# Resolve version & tag name
$newVersion = $null
try {
  $pkgPath = Join-Path $repoRoot 'package.json'
  $pkg = Get-Content -Raw -Path $pkgPath | ConvertFrom-Json
  $newVersion = $pkg.version
} catch {
  Write-Warning "Could not read package.json for version; falling back to latest tag."
}
$tagName = if ($newVersion) { "v$($newVersion)" } else { (Exec 'git' @('describe','--tags','--abbrev=0') -WorkingDirectory $repoRoot -Quiet).StdOut.Trim() }

# 6) Push branch + tags (with rollback if push fails)
Write-Host "==> Pushing $branch and tags"
try {
  if ($hasRemote) {
    Exec 'git' @('push','origin',$branch,'--follow-tags') -WorkingDirectory $repoRoot
  } else {
    Write-Warning "No 'origin' remote found; skipping push."
  }
} catch {
  Write-Warning "Push failed. Attempting rollback to previous commit $prevRef ..."
  if ($tagName) {
    Exec 'git' @('tag','-d', $tagName) -WorkingDirectory $repoRoot -AllowNonZero | Out-Null
  }
  Exec 'git' @('reset','--hard', $prevRef) -WorkingDirectory $repoRoot -AllowNonZero | Out-Null
  throw
}

Write-Host "`nDone. CI should build and publish artifacts for $tagName."
