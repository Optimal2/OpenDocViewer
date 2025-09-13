# File: release.ps1
# OpenDocViewer release helper (compact, robust, Windows-friendly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function J($a){ if(-not $a){''}else{ ($a|%{ if($_ -match '[\s"|\\]'){'"'+($_ -replace '(["\\])','\\$1')+'"' }else{$_}}) -join ' ' } }
function Exec {
  param([Parameter(Mandatory)][string]$File,[string[]]$Args=@(),[string]$Cwd=$null,[switch]$AllowNonZero,[switch]$Quiet)
  $as = J $Args
  if(-not $Quiet){
    if($Cwd){Write-Host "==> ($Cwd) $File $as" -ForegroundColor Cyan}
    else    {Write-Host "==> $File $as" -ForegroundColor Cyan}
  }
  $psi=[System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$File; $psi.Arguments=$as
  if($Cwd){$psi.WorkingDirectory=$Cwd}
  $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
  $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
  $p=[System.Diagnostics.Process]::new(); $p.StartInfo=$psi
  $null=$p.Start()
  $o=$p.StandardOutput.ReadToEnd(); $e=$p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if($o){Write-Host $o.TrimEnd()}
  if($e){ if($p.ExitCode -eq 0){Write-Warning $e.TrimEnd()}else{Write-Error $e.TrimEnd()} }
  if($p.ExitCode -ne 0 -and -not $AllowNonZero){ throw "Command failed ($File $as) with exit code $($p.ExitCode)." }
  @{Code=$p.ExitCode;Out=$o;Err=$e}
}

function ExecNpm {  # run npm reliably on Windows via cmd.exe
  param([string[]]$NpmArgs,[string]$Cwd)
  $cmd = $env:ComSpec; if(-not $cmd){ $cmd='cmd.exe' }
  $allArgs = @('/d','/c','npm') + $NpmArgs
  Exec -File $cmd -Args $allArgs -Cwd $Cwd
}

function ReadNonEmpty([string]$p){ $v=Read-Host $p; if([string]::IsNullOrWhiteSpace($v)){throw "Input cannot be empty."}; $v }

# Resolve repo root from script path; work there regardless of current location
$scriptDir = if($PSScriptRoot){$PSScriptRoot}else{ Split-Path -Parent $MyInvocation.MyCommand.Path }
try{ $repoRoot=(Exec 'git' @('rev-parse','--show-toplevel') -Cwd $scriptDir -Quiet).Out.Trim() }catch{}
if(-not $repoRoot){ if(Test-Path (Join-Path $scriptDir '.git')){$repoRoot=$scriptDir}else{ throw "Not inside a Git working tree." } }

$inside=(Exec 'git' @('rev-parse','--is-inside-work-tree') -Cwd $repoRoot -Quiet).Out.Trim()
if($inside -ne 'true'){ throw "Git says this is not a working tree: $repoRoot" }
$branch=(Exec 'git' @('rev-parse','--abbrev-ref','HEAD') -Cwd $repoRoot -Quiet).Out.Trim(); if([string]::IsNullOrWhiteSpace($branch)){$branch='main'}

$hasRemote=$true; try{$null=Exec 'git' @('remote','get-url','origin') -Cwd $repoRoot -Quiet}catch{$hasRemote=$false}
if($hasRemote){ Exec 'git' @('fetch','--tags','--prune') -Cwd $repoRoot -Quiet | Out-Null }

Write-Host "=== OpenDocViewer Release Helper ===`n"
$commitMsg   = ReadNonEmpty 'Commit message (e.g. chore(deps): bump axios to 1.12.1)'
$releaseType = ReadNonEmpty 'Release type (patch | minor | major)'
if(@('patch','minor','major') -notcontains $releaseType.ToLower()){ throw "Invalid release type. Use: patch, minor, or major." }

Write-Host "`nSummary:`n  Repo root:     $repoRoot`n  Branch:        $branch`n  Commit:        $commitMsg`n  Release type:  $releaseType`n"
if((Read-Host 'Proceed? (Y/N)').ToUpper() -ne 'Y'){ Write-Host 'Aborted.'; exit 0 }

# Stage + commit (skip if empty)
Exec 'git' @('add','-A') -Cwd $repoRoot -Quiet | Out-Null
$commitRes=Exec 'git' @('commit','-m',$commitMsg) -Cwd $repoRoot -AllowNonZero -Quiet
if($commitRes.Code -ne 0){ Write-Host 'No changes to commit. Continuing...' }

# Ensure clean working tree for npm version (untracked included)
$porcelain=(Exec 'git' @('status','--porcelain') -Cwd $repoRoot -Quiet).Out
if(-not [string]::IsNullOrWhiteSpace($porcelain)){
  Write-Warning "Working tree not clean:`n$porcelain"
  $ch=Read-Host "Fix automatically? [A]dd&commit / [S]tash -u / [Q]uit (A/S/Q)"
  switch($ch.ToUpper()){
    'A'{ Exec 'git' @('add','-A') -Cwd $repoRoot -Quiet | Out-Null; Exec 'git' @('commit','-m','chore(release): pre-release housekeeping') -Cwd $repoRoot -AllowNonZero -Quiet | Out-Null }
    'S'{ $global:__REL_STASH__=(Exec 'git' @('stash','push','-u','-m','release: pre-version stash') -Cwd $repoRoot -Quiet).Out.Trim() }
    Default{ throw "Aborted due to dirty working tree." }
  }
  $again=(Exec 'git' @('status','--porcelain') -Cwd $repoRoot -Quiet).Out
  if(-not [string]::IsNullOrWhiteSpace($again)){ throw "Working tree still not clean. Resolve manually and rerun." }
}

$prevHead=(Exec 'git' @('rev-parse','HEAD') -Cwd $repoRoot -Quiet).Out.Trim()

# Version bump via package.json scripts
ExecNpm -NpmArgs @('run','--silent',"release:$releaseType") -Cwd $repoRoot

# Resolve tag/version
$newVersion=$null; try{ $pkg=Get-Content -Raw -Path (Join-Path $repoRoot 'package.json') | ConvertFrom-Json; $newVersion=$pkg.version }catch{}
$tagName= if($newVersion){"v$($newVersion)"}else{ (Exec 'git' @('describe','--tags','--abbrev=0') -Cwd $repoRoot -Quiet).Out.Trim() }

# Push (rollback on failure)
try{
  if($hasRemote){ Exec 'git' @('push','origin',$branch,'--follow-tags') -Cwd $repoRoot | Out-Null }
  else{ Write-Warning "No 'origin' remote; skipping push." }
}catch{
  Write-Warning "Push failed. Rolling back to $prevHead ..."
  if($tagName){ Exec 'git' @('tag','-d',$tagName) -Cwd $repoRoot -AllowNonZero | Out-Null }
  Exec 'git' @('reset','--hard',$prevHead) -Cwd $repoRoot -AllowNonZero | Out-Null
  throw
}finally{
  if($global:__REL_STASH__){ Write-Host "Restoring stashed changes..."; Exec 'git' @('stash','pop') -Cwd $repoRoot -AllowNonZero | Out-Null; Remove-Variable __REL_STASH__ -Scope Global -ErrorAction SilentlyContinue }
}

# Post-push verification: confirm head & tag on origin
if($hasRemote){
  Exec 'git' @('fetch','--tags') -Cwd $repoRoot -Quiet | Out-Null
  $local=(Exec 'git' @('rev-parse','HEAD') -Cwd $repoRoot -Quiet).Out.Trim()
  $remote=(Exec 'git' @('rev-parse',"origin/$branch") -Cwd $repoRoot -Quiet).Out.Trim()
  $tagRemote=(Exec 'git' @('ls-remote','--tags','origin',$tagName) -Cwd $repoRoot -AllowNonZero -Quiet).Out.Trim()
  if($local -ne $remote){ Write-Warning "Push verification: local HEAD != origin/$branch. Try: git pull --rebase origin $branch; git push origin $branch --follow-tags" }
  if(-not $tagRemote){ Write-Warning "Push verification: tag $tagName not visible on origin yet." }
}

Write-Host "`nDone. CI should build & publish artifacts for $tagName."
