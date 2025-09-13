# File: release.ps1
# OpenDocViewer release helper (robust, Windows-friendly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-Cmd {
  param([Parameter(Mandatory)][string]$Name, [string[]]$Preferred = @())
  foreach ($p in $Preferred) {
    $cmd = Get-Command $p -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Required command not found on PATH: $Name" }
  return $cmd.Source
}

function Join-Args([string[]]$a) {
  if (-not $a) { return '' }
  ($a | ForEach-Object {
    if ($_ -match '[\s"|\\]') { '"' + ($_ -replace '(["\\])','\\$1') + '"' } else { $_ }
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
  $argString = Join-Args $Args
  if (-not $Quiet) {
    if ($Cwd) { Write-Host "==> ($Cwd) $File $argString" -ForegroundColor Cyan }
    else      { Write-Host "==> $File $argString" -ForegroundColor Cyan }
  }

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $File
  $psi.Arguments = $argString
  if ($Cwd) { $psi.WorkingDirectory = $Cwd }
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $p = [System.Diagnostics.Process]::new()
  $p.StartInfo = $psi
  $null = $p.Start()
  $out = $p.StandardOutput.ReadToEnd()
  $err = $p.StandardError.ReadToEnd()
  $p.WaitForExit()

  if ($out) { Write-Host $out.TrimEnd() }
  if ($err) { if ($p.ExitCode -eq 0) { Write-Warning $err.TrimEnd() } else { Write-Error $err.TrimEnd() } }
  if ($p.ExitCode -ne 0 -and -not $AllowNonZero) { throw "Command failed ($File $argString) with exit code $($p.ExitCode)." }
  @{ Code=$p.ExitCode; Out=$out; Err=$err }
}

function Read-NonEmpty([string]$Prompt) {
  $v = Read-Host $Prompt
  if ([string]::IsNullOrWhiteSpace($v)) { throw "Input cannot be empty." }
  $v
}

# --- Preflight: resolve tools & repo root ---
$Git = Resolve-Cmd 'git'
# Prefer npm.cmd on Windows; fall back to npm / npm.ps1
$Npm = Resolve-Cmd 'npm' @('npm.cmd','npm')

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$RepoRoot  = $null
try {
  $top = (Exec $Git @('rev-parse','--show-toplevel') -Cwd $ScriptDir -Quiet).Out.Trim()
  if ($top) { $RepoRoot = $top }
} catch {}
if (-not $RepoRoot) {
  if (Test-Path (Join-Path $ScriptDir '.git')) { $RepoRoot = $ScriptDir }
  else { throw "Not inside a Git working tree. Move script into the repo or run from the repo." }
}

$inside = (Exec $Git @('rev-parse','--is-inside-work-tree') -Cwd $RepoRoot -Quiet).Out.Trim()
if ($inside -ne 'true') { throw "Git says this is not a working tree: $RepoRoot" }

$branch = (Exec $Git @('rev-parse','--abbrev-ref','HEAD') -Cwd $RepoRoot -Quiet).Out.Trim()
if ([string]::IsNullOrWhiteSpace($branch)) { $branch = 'main' }

$hasRemote = $true
try { $null = Exec $Git @('remote','get-url','origin') -Cwd $RepoRoot -Quiet } catch { $hasRemote = $false }
if ($hasRemote) { Exec $Git @('fetch','--tags','--prune') -Cwd $RepoRoot | Out-Null }

Write-Host "=== OpenDocViewer Release Helper ===`n"

# --- Input ---
$commitMsg   = Read-NonEmpty 'Commit message (e.g. chore(deps): bump axios to 1.12.1)'
$releaseType = Read-NonEmpty 'Release type (patch | minor | major)'
if (@('patch','minor','major') -notcontains $releaseType.ToLower()) {
  throw "Invalid release type. Use: patch, minor, or major."
}

Write-Host "`nSummary:"
Write-Host "  Repo root:     $RepoRoot"
Write-Host "  Branch:        $branch"
Write-Host "  Commit:        $commitMsg"
Write-Host "  Release type:  $releaseType`n"
if ((Read-Host 'Proceed? (Y/N)').ToUpper() -ne 'Y') { Write-Host 'Aborted.'; exit 0 }

# --- Stage & Commit ---
Write-Host "`n==> Staging changes"
Exec $Git @('add','-A') -Cwd $RepoRoot | Out-Null

Write-Host "==> Committing (will skip if nothing to commit)"
$commitRes = Exec $Git @('commit','-m', $commitMsg) -Cwd $RepoRoot -AllowNonZero
if ($commitRes.Code -ne 0) { Write-Host 'No changes to commit. Continuing...' }

# Ensure working tree is *clean* for `npm version` (untracked files also fail)
function Ensure-Clean {
  param([string]$Root)
  $porcelain = (Exec $Git @('status','--porcelain') -Cwd $Root -Quiet).Out
  if (-not [string]::IsNullOrWhiteSpace($porcelain)) {
    Write-Warning "Working tree not clean. Summary:`n$porcelain"
    $choice = Read-Host "Fix automatically? [A]dd & commit all / [S]tash (incl. untracked) / [Q]uit (A/S/Q)"
    switch ($choice.ToUpper()) {
      'A' {
        Exec $Git @('add','-A') -Cwd $Root | Out-Null
        Exec $Git @('commit','-m','chore(release): pre-release housekeeping') -Cwd $Root -AllowNonZero | Out-Null
      }
      'S' {
        $global:__REL_STASH__ = (Exec $Git @('stash','push','-u','-m','release: tmp stash before npm version') -Cwd $Root).Out.Trim()
      }
      Default { throw "Aborted due to dirty working tree." }
    }
    # Re-check
    $again = (Exec $Git @('status','--porcelain') -Cwd $Root -Quiet).Out
    if (-not [string]::IsNullOrWhiteSpace($again)) {
      throw "Working tree still not clean. Resolve manually and rerun."
    }
  }
}
Ensure-Clean -Root $RepoRoot

$prevRef = (Exec $Git @('rev-parse','HEAD') -Cwd $RepoRoot -Quiet).Out.Trim()

# --- Version bump via your package scripts (release:* in package.json) ---
Write-Host "==> npm run release:$releaseType"
Exec $Npm @('run', '--silent', "release:$releaseType") -Cwd $RepoRoot

# Determine tag/version
$newVersion = $null
try {
  $pkg = Get-Content -Raw -Path (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json
  $newVersion = $pkg.version
} catch {}
$tagName = if ($newVersion) { "v$($newVersion)" } else { (Exec $Git @('describe','--tags','--abbrev=0') -Cwd $RepoRoot -Quiet).Out.Trim() }

# --- Push (rollback + stash restore on failure) ---
Write-Host "==> Pushing $branch and tags"
try {
  if ($hasRemote) {
    Exec $Git @('push','origin',$branch,'--follow-tags') -Cwd $RepoRoot | Out-Null
  } else {
    Write-Warning "No 'origin' remote found; skipping push."
  }
} catch {
  Write-Warning "Push failed. Rolling back to $prevRef ..."
  if ($tagName) { Exec $Git @('tag','-d',$tagName) -Cwd $RepoRoot -AllowNonZero | Out-Null }
  Exec $Git @('reset','--hard',$prevRef) -Cwd $RepoRoot -AllowNonZero | Out-Null
  throw
} finally {
  if ($global:__REL_STASH__) {
    Write-Host "Restoring stashed changes..."
    Exec $Git @('stash','pop') -Cwd $RepoRoot -AllowNonZero | Out-Null
    Remove-Variable __REL_STASH__ -Scope Global -ErrorAction SilentlyContinue
  }
}

Write-Host "`nDone. CI should build & publish artifacts for $tagName."
