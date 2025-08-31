# File: scripts/Manage-ODV-LogServers.ps1
<#
  OpenDocViewer — Manage-ODV-LogServers.ps1

  Key updates:
    - Robust npm resolution: use (Get-Command npm).Path with fallbacks; never pass a bogus "npmCmd".
    - Clear echo of the npm path before running commands.
    - Auto-fix lockfile drift: try `npm ci`, then fall back to `npm install`.
    - Secure token auto-generation (Base64URL) when left blank; copy to clipboard; save to token file.
    - On service start failure, show tail of service logs.

  Run as Administrator.
#>

function Ensure-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Warning "This script requires Administrator privileges. Relaunching elevated..."
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @(
      "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`""
    )
    exit
  }
}

# --------------------------- PATHS & CONSTANTS ----------------------------
$Script:REPO_ROOT   = Split-Path -Path $PSScriptRoot -Parent
$Script:SERVER_DIR  = Join-Path $REPO_ROOT 'server'
$Script:SYSTEM_JS   = Join-Path $SERVER_DIR 'system-log-server.js'
$Script:USER_JS     = Join-Path $SERVER_DIR 'user-log-server.js'
$Script:LOG_DIR     = Join-Path $SERVER_DIR 'logs'
$Script:SVC_LOG_DIR = Join-Path $LOG_DIR 'service'
$Script:SERVICE_SYS = 'ODV-SystemLog'
$Script:SERVICE_USR = 'ODV-UserLog'

$Script:DEF_PORT_SYS   = 3001
$Script:DEF_PORT_USR   = 3002
$Script:RETENTION_DAYS = 30
$Script:NODE_ENV       = 'production'
$Script:TRUST_PROXY    = 1

$Script:DefaultNssmDir = 'C:\Program Files\nssm'
$Script:NssmExe64      = Join-Path $DefaultNssmDir 'win64\nssm.exe'
$Script:NssmExe32      = Join-Path $DefaultNssmDir 'win32\nssm.exe'

function Write-Header([string]$Title) {
  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
}
function Require-File([string]$Path,[string]$Hint) {
  if (-not (Test-Path $Path)) { throw "Required file not found: `"$Path`". $Hint" }
}
function Resolve-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Path) { return $cmd.Path }
  return $null
}

# --------- Token generator (Base64URL, cryptographically strong) ----------
function New-RandomToken([int]$ByteLength = 32) {
  $bytes = New-Object byte[] $ByteLength
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $b64 = [Convert]::ToBase64String($bytes)
  return $b64.TrimEnd('=') -replace '\+','-' -replace '/','_'
}

# --------------------------- NSSM RESOLUTION -------------------------------
function Find-NssmCandidate {
  $onPath = (Get-Command nssm -ErrorAction SilentlyContinue)
  if ($onPath -and $onPath.Path) { return $onPath.Path }
  if (Test-Path $NssmExe64) { return $NssmExe64 }
  if (Test-Path $NssmExe32) { return $NssmExe32 }
  $candidates = @('C:\Program Files\nssm','C:\Program Files (x86)\nssm','C:\ProgramData\nssm') | Where-Object { Test-Path $_ }
  foreach ($root in $candidates) {
    $found = Get-ChildItem -Path $root -Recurse -Filter 'nssm.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

function Try-Download-And-Install-Nssm {
  try {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
    $url = 'https://nssm.cc/release/nssm-2.24.zip'
    $tmp = Join-Path $env:TEMP ("nssm-" + [Guid]::NewGuid().ToString() + ".zip")
    $dst = Join-Path $env:TEMP ("nssm-" + [Guid]::NewGuid().ToString())
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
    Expand-Archive -Path $tmp -DestinationPath $dst -Force
    $exe64 = Get-ChildItem -Path $dst -Recurse -Filter 'nssm.exe' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\win64\\' } | Select-Object -First 1
    $exe32 = Get-ChildItem -Path $dst -Recurse -Filter 'nssm.exe' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\win32\\' } | Select-Object -First 1
    if (-not $exe64 -and -not $exe32) { throw "nssm.exe not found inside downloaded archive." }
    New-Item -ItemType Directory -Force -Path (Split-Path $NssmExe64 -Parent) | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path $NssmExe32 -Parent) | Out-Null
    if ($exe64) { Copy-Item $exe64.FullName -Destination $NssmExe64 -Force }
    if ($exe32) { Copy-Item $exe32.FullName -Destination $NssmExe32 -Force }
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $NssmExe64) { return $NssmExe64 }
    if (Test-Path $NssmExe32) { return $NssmExe32 }
    return $null
  } catch {
    Write-Warning ("Auto-install failed: " + $_.Exception.Message)
    return $null
  }
}

function Show-NssmManualInstructions {
  Write-Host ""
  Write-Host "=== Manual NSSM Install Instructions ===" -ForegroundColor Yellow
  Write-Host "1) Download: https://nssm.cc/release/nssm-2.24.zip"
  Write-Host "2) Unzip somewhere (e.g., C:\Temp\nssm-2.24\)."
  Write-Host "3) Create: 'C:\Program Files\nssm\win64' and '...\win32'."
  Write-Host "4) Copy 'win64\nssm.exe' -> 'C:\Program Files\nssm\win64\nssm.exe'."
  Write-Host "   (On 32-bit systems, use win32 version.)"
  Write-Host "5) Return and choose: R) Re-check or P) Enter full path."
  Write-Host ""
}

function Ensure-Nssm([switch]$Interactive) {
  $candidate = Find-NssmCandidate
  if ($candidate) { return $candidate }
  if (-not $Interactive) { return $null }
  Write-Warning "NSSM not found. It is the simplest way to run Node as a Windows service."
  while ($true) {
    Write-Host ""
    Write-Host "NSSM Helper — choose an option:" -ForegroundColor Cyan
    Write-Host "  A) Auto-download & install NSSM (recommended)"
    Write-Host "  P) Enter full path to nssm.exe"
    Write-Host "  I) Show manual install instructions"
    Write-Host "  R) Re-check / Try again"
    Write-Host "  B) Back to main menu"
    $choice = Read-Host "Select A/P/I/R/B"
    switch ($choice.ToUpperInvariant()) {
      'A' { $p = Try-Download-And-Install-Nssm; if ($p) { Write-Host "NSSM installed at: $p" -ForegroundColor Green; return $p } else { Write-Warning "Auto-install did not complete." } }
      'P' { $p = Read-Host "Enter full path to nssm.exe"; if ($p -and (Test-Path $p)) { return $p } else { Write-Warning "File not found: $p" } }
      'I' { Show-NssmManualInstructions }
      'R' { $p = Find-NssmCandidate; if ($p) { Write-Host "Found NSSM at: $p" -ForegroundColor Green; return $p } else { Write-Warning "Still not found." } }
      'B' { return $null }
      default { Write-Host "Invalid selection." -ForegroundColor Yellow }
    }
  }
}

# --------------------------- PREREQS (npm deps) ----------------------------
function Resolve-NpmPath {
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Path) {
    $p = $cmd.Path
    # If PowerShell shim (npm.ps1) is returned, prefer the .cmd/.exe next to it
    if ($p -like '*.ps1') {
      $dir = Split-Path $p -Parent
      foreach ($name in @('npm.cmd','npm.exe')) {
        $candidate = Join-Path $dir $name
        if (Test-Path $candidate) { return $candidate }
      }
    }
    return $p
  }
  # Fallback to common locations
  $candidates = @(
    "$env:ProgramFiles\nodejs\npm.cmd",
    "$env:ProgramFiles\nodejs\npm.exe",
    "$env:ProgramFiles(x86)\nodejs\npm.cmd",
    "$env:ProgramFiles(x86)\nodejs\npm.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  # Last resort: rely on PATH
  return "npm"
}

function Ensure-NodeDeps {
  param([string]$RepoRoot)

  $npmPath = Resolve-NpmPath
  Write-Host "Using npm at: $npmPath" -ForegroundColor DarkCyan

  $old = Get-Location
  try {
    Set-Location $RepoRoot

    # 1) Try reproducible install
    $ciOutput = & "$npmPath" ci 2>&1
    $ciCode   = $LASTEXITCODE
    if ($ciCode -eq 0) {
      Write-Host "npm ci succeeded." -ForegroundColor Green
      return $true
    }

    # 2) If lock is missing/out of sync, fall back to npm install to regenerate
    $ciText = ($ciOutput | Out-String)
    $lockMissing    = -not (Test-Path (Join-Path $RepoRoot 'package-lock.json'))
    $looksOutOfSync = ($ciText -match 'EUSAGE' -or $ciText -match 'ELOCKVERIFY' -or $ciText -match 'in sync')

    if ($lockMissing -or $looksOutOfSync) {
      Write-Host "Lock file out of sync or missing. Running 'npm install' to regenerate..." -ForegroundColor Yellow
      $installOutput = & "$npmPath" install 2>&1
      $installCode   = $LASTEXITCODE
      if ($installCode -eq 0) {
        Write-Host "npm install succeeded." -ForegroundColor Green
        return $true
      } else {
        Write-Error ("npm install failed with exit code {0}.`n{1}" -f $installCode, ($installOutput | Out-String))
        return $false
      }
    }

    # 3) Other failure: show the ci output for clarity
    Write-Error ("npm ci failed with exit code {0}.`n{1}" -f $ciCode, $ciText)
    return $false
  }
  finally {
    Set-Location $old
  }
}
# --------------------------- SERVICE HELPERS -------------------------------
function Set-ServiceEnv([string]$Nssm,[string]$Service,[hashtable]$EnvVars) {
  # NSSM expects REG_MULTI_SZ; pass newline-separated pairs.
  $pairs = @()
  foreach ($k in $EnvVars.Keys) {
    $v = $EnvVars[$k]
    if ($null -ne $v -and "$v".Length -gt 0) { $pairs += "$k=$v" }
  }
  if ($pairs.Count -gt 0) {
    $envLine = [string]::Join("`r`n", $pairs)
    & $Nssm set $Service AppEnvironmentExtra $envLine | Out-Null
  }
}

function Install-ServiceNodeApp {
  param(
    [Parameter(Mandatory)][string]$ServiceName,
    [Parameter(Mandatory)][string]$NodeExe,
    [Parameter(Mandatory)][string]$ScriptPath,
    [Parameter(Mandatory)][string]$AppDir,
    [Parameter(Mandatory)][hashtable]$EnvVars,
    [Parameter(Mandatory)][string]$NssmExe
  )
  Write-Header "Installing service: $ServiceName"

  # Install node.exe as the application
  & $NssmExe install $ServiceName $NodeExe | Out-Null

  # Work from the server folder, and pass a *relative* script to avoid spaces/quoting issues
  $scriptLeaf = Split-Path $ScriptPath -Leaf
  & $NssmExe set $ServiceName AppDirectory $AppDir | Out-Null
  & $NssmExe set $ServiceName AppParameters ".\$scriptLeaf" | Out-Null

  # Service behavior
  & $NssmExe set $ServiceName Start SERVICE_AUTO_START | Out-Null
  & $NssmExe set $ServiceName AppThrottle 1500 | Out-Null
  & $NssmExe set $ServiceName AppNoConsole 1 | Out-Null

  # Stdout/stderr capture
  New-Item -ItemType Directory -Force -Path $SVC_LOG_DIR | Out-Null
  & $NssmExe set $ServiceName AppStdout (Join-Path $SVC_LOG_DIR "$ServiceName.out.log") | Out-Null
  & $NssmExe set $ServiceName AppStderr (Join-Path $SVC_LOG_DIR "$ServiceName.err.log") | Out-Null
  & $NssmExe set $ServiceName AppRotateFiles 1 | Out-Null
  & $NssmExe set $ServiceName AppRotateOnline 1 | Out-Null
  & $NssmExe set $ServiceName AppRotateBytes 10485760 | Out-Null  # 10 MB

  # Environment (REG_MULTI_SZ via AppEnvironmentExtra)
  Set-ServiceEnv -Nssm $NssmExe -Service $ServiceName -EnvVars $EnvVars

  Write-Host "Service '$ServiceName' installed." -ForegroundColor Green

  # Print key NSSM settings for quick verification
  Write-Host "  Application   : $((& $NssmExe get $ServiceName Application))" -ForegroundColor DarkCyan
  Write-Host "  AppParameters : $((& $NssmExe get $ServiceName AppParameters))" -ForegroundColor DarkCyan
  Write-Host "  AppDirectory  : $((& $NssmExe get $ServiceName AppDirectory))" -ForegroundColor DarkCyan
}

function Remove-ServiceSafe([string]$Nssm,[string]$ServiceName) {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $svc) {
    Write-Host "Service '$ServiceName' not installed." -ForegroundColor DarkYellow
    return
  }

  # Only try to stop if not already stopped; suppress NSSM stderr noise.
  if ($svc.Status -ne 'Stopped' -and $svc.Status -ne 'StopPending') {
    try { & $Nssm stop $ServiceName 2>$null | Out-Null } catch {}
    Start-Sleep -Milliseconds 300
    try { $svc.Refresh() } catch {}
  }

  # Remove the service; also suppress stderr to avoid "service not started" chatter.
  try { & $Nssm remove $ServiceName confirm 2>$null | Out-Null } catch {}
  Write-Host "Service '$ServiceName' removed." -ForegroundColor Yellow
}

function Show-ServiceLastLogs([string]$ServiceName, [int]$Lines=100) {
  $out = Join-Path $SVC_LOG_DIR "$ServiceName.out.log"
  $err = Join-Path $SVC_LOG_DIR "$ServiceName.err.log"
  Write-Host "---- $ServiceName last logs ----" -ForegroundColor DarkCyan

  $hadContent = $false
  if (Test-Path $out) {
    $o = Get-Content $out -Tail $Lines
    if ($o) { Write-Host "`n[out]" -ForegroundColor DarkGray; $o; $hadContent = $true }
  }
  if (Test-Path $err) {
    $e = Get-Content $err -Tail $Lines
    if ($e) { Write-Host "`n[err]" -ForegroundColor DarkGray; $e; $hadContent = $true }
  }

  if (-not $hadContent) {
    Write-Host "(service produced no stdout/stderr yet)" -ForegroundColor DarkYellow
    try {
      Write-Host "`n[events]" -ForegroundColor DarkGray
      Get-WinEvent -FilterHashtable @{
        LogName='Application'; ProviderName='nssm'; StartTime=(Get-Date).AddMinutes(-30)
      } | Where-Object { $_.Message -like "*$ServiceName*" } |
          Select-Object -First 10 |
          ForEach-Object { $_.TimeCreated.ToString('s') + '  ' + $_.Message }
    } catch {}
  }
  Write-Host "--------------------------------" -ForegroundColor DarkCyan
}

function Start-ServiceSafe([string]$ServiceName) {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $svc) {
    Write-Host "Service '$ServiceName' not installed." -ForegroundColor DarkYellow
    return
  }
  try {
    if ($svc.Status -ne 'Running') { Start-Service $ServiceName }
    Start-Sleep -Milliseconds 1200
  } catch {
    Write-Warning "Failed to start service '$ServiceName'."
  }
  $status = (Get-Service $ServiceName).Status
  Write-Host "Service '$ServiceName' status: $status" -ForegroundColor Green
  if ($status -ne 'Running') { Show-ServiceLastLogs -ServiceName $ServiceName -Lines 120 }
}

function Stop-ServiceSafe([string]$ServiceName) {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $svc) { Write-Host "Service '$ServiceName' not installed." -ForegroundColor DarkYellow; return }
  if ($svc.Status -ne 'Stopped') { Stop-Service $ServiceName }
  Write-Host "Service '$ServiceName' status: $((Get-Service $ServiceName).Status)" -ForegroundColor Green
}

function Set-ServiceLogOnUser([string]$Nssm,[string]$ServiceName,[string]$Account,[securestring]$SecurePassword) {
  # NSSM usage: nssm set <service> ObjectName <user> <password>
  $plain = (New-Object System.Management.Automation.PSCredential 'u', $SecurePassword).GetNetworkCredential().Password
  try {
    & $Nssm set $ServiceName ObjectName $Account $plain | Out-Null
    Write-Host "Configured '$ServiceName' to run as $Account" -ForegroundColor Cyan
  } finally {
    # minimal cleanup
    $plain = $null
    [System.GC]::Collect() | Out-Null
  }
}

function Restart-ServiceSafe([string]$ServiceName) {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $svc) { Write-Host "Service '$ServiceName' not installed." -ForegroundColor DarkYellow; return }
  try {
    Restart-Service $ServiceName
  } catch {
    Write-Warning "Failed to restart service '$ServiceName'."
  }
  Write-Host "Service '$ServiceName' status: $((Get-Service $ServiceName).Status)" -ForegroundColor Green
  Show-ServiceLastLogs -ServiceName $ServiceName
}

function Show-Status {
  $names = @($SERVICE_SYS,$SERVICE_USR)
  foreach ($n in $names) {
    $svc = Get-Service -Name $n -ErrorAction SilentlyContinue
    if ($svc) { Write-Host ("{0,-18} {1}" -f $n, $svc.Status) } else { Write-Host ("{0,-18} {1}" -f $n, 'Not installed') }
  }
}

# --------------------------- INSTALL FLOW ----------------------------------
function Install-Flow {
  Write-Header "Install Services"
  try {
    Require-File $SYSTEM_JS "Expected at: $SYSTEM_JS"
    Require-File $USER_JS   "Expected at: $USER_JS"
  } catch { Write-Error $_; return }

  New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
  New-Item -ItemType Directory -Force -Path $SVC_LOG_DIR | Out-Null

  $node = Resolve-Node
  if (-not $node) {
    Write-Warning "Node.js (node.exe) not found on PATH."
    Write-Host "Install from https://nodejs.org/ (LTS recommended), then re-run." -ForegroundColor Yellow
    $retry = Read-Host "Press Enter after installing Node.js to re-check, or type Q to cancel"
    if ($retry -match '^(q|quit)$') { return }
    $node = Resolve-Node
    if (-not $node) { Write-Error "Still no node.exe on PATH. Aborting install flow."; return }
  }

  # Optional: ensure deps
  $depsOk = Ensure-NodeDeps -RepoRoot $REPO_ROOT
  if (-not $depsOk) {
    $cont = Read-Host "Node dependencies are not installed correctly. Continue anyway? [y/N]"
    if ($cont -notmatch '^(y|yes)$') { return }
  }

  $nssm = Ensure-Nssm -Interactive
  if (-not $nssm) {
    Write-Warning "NSSM not available. Returning to main menu without installing services."
    return
  }

  $portSys = Read-Host "System Log port [default: $DEF_PORT_SYS]"
  if ([string]::IsNullOrWhiteSpace($portSys)) { $portSys = $DEF_PORT_SYS }
  $portUsr = Read-Host "User Log port [default: $DEF_PORT_USR]"
  if ([string]::IsNullOrWhiteSpace($portUsr)) { $portUsr = $DEF_PORT_USR }

  $token = Read-Host "System Log token (x-log-token) [leave blank to auto-generate]"
  if ([string]::IsNullOrWhiteSpace($token)) {
    $token = New-RandomToken 32
    Write-Host "Generated System Log token (copied to clipboard):" -ForegroundColor Green
    Write-Host "  $token" -ForegroundColor Yellow
    try { Set-Clipboard -Value $token } catch {}
    $tokenFile = Join-Path $SVC_LOG_DIR 'ODV-SystemLog.token.txt'
    try { $token | Out-File -FilePath $tokenFile -Encoding UTF8 -Force } catch {}
  }

  $envSys = @{
    NODE_ENV           = $NODE_ENV
    PORT               = $portSys
    LOG_TOKEN          = $token
    TRUST_PROXY        = $TRUST_PROXY
    LOG_RETENTION_DAYS = $RETENTION_DAYS
  }
  $envUsr = @{
    NODE_ENV           = $NODE_ENV
    PORT               = $portUsr
    TRUST_PROXY        = $TRUST_PROXY
    LOG_RETENTION_DAYS = $RETENTION_DAYS
  }

  Install-ServiceNodeApp -ServiceName $SERVICE_SYS -NodeExe $node -ScriptPath $SYSTEM_JS -AppDir $SERVER_DIR -EnvVars $envSys -NssmExe $nssm
  Install-ServiceNodeApp -ServiceName $SERVICE_USR -NodeExe $node -ScriptPath $USER_JS   -AppDir $SERVER_DIR -EnvVars $envUsr -NssmExe $nssm

  # Offer to run under the current user account (helps with E:\... ACLs and user profile paths)
  $useCurrent = Read-Host "Run services under the current user account ($env:UserDomain\$env:UserName)? [Y/n]"
  if ($useCurrent -notmatch '^(n|no)$') {
    $pw1 = Read-Host "Enter password for $env:UserDomain\$env:UserName" -AsSecureString
    $pw2 = Read-Host "Confirm password" -AsSecureString
    $pwd1Plain = (New-Object System.Management.Automation.PSCredential 'u', $pw1).GetNetworkCredential().Password
    $pwd2Plain = (New-Object System.Management.Automation.PSCredential 'u', $pw2).GetNetworkCredential().Password
    if ($pwd1Plain -ne $pwd2Plain) {
      Write-Warning "Passwords did not match. Skipping account change."
    } else {
      $acct = "$env:UserDomain\$env:UserName"
      Set-ServiceLogOnUser -Nssm $nssm -ServiceName $SERVICE_SYS -Account $acct -SecurePassword $pw1
      Set-ServiceLogOnUser -Nssm $nssm -ServiceName $SERVICE_USR -Account $acct -SecurePassword $pw1
    }
  }

  Write-Host "Starting services..." -ForegroundColor Cyan
  Start-ServiceSafe $SERVICE_SYS
  Start-ServiceSafe $SERVICE_USR

  Write-Host "`nDONE. Proxy your IIS endpoints to:" -ForegroundColor Green
  Write-Host "  System Log : http://localhost:$portSys/log"
  Write-Host "  User Log   : http://localhost:$portUsr/userlog/record"
}

# --------------------------- UNINSTALL FLOW --------------------------------
function Uninstall-Flow {
  Write-Header "Uninstall Services"
  $nssm = Ensure-Nssm -Interactive
  if (-not $nssm) {
    Write-Host "NSSM is required to remove services cleanly. Manual removal tips:" -ForegroundColor Yellow
    Write-Host "  sc stop $SERVICE_SYS ; sc delete $SERVICE_SYS"
    Write-Host "  sc stop $SERVICE_USR ; sc delete $SERVICE_USR"
    return
  }
  Remove-ServiceSafe -Nssm $nssm -ServiceName $SERVICE_SYS
  Remove-ServiceSafe -Nssm $nssm -ServiceName $SERVICE_USR
}

# --------------------------- LOG ACTIONS -----------------------------------
function Open-LogFolder {
  if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null }
  Invoke-Item $LOG_DIR
}
function Tail-Logs {
  Write-Header "Tail today's logs"
  $today = (Get-Date).ToString('yyyy-MM-dd')
  Write-Host "Choose which server logs to follow:" -ForegroundColor Cyan
  Write-Host "  1) System Log (ingestion/access/error)"
  Write-Host "  2) User   Log (print/access/error)"
  $sel = Read-Host "Enter 1 or 2"
  switch ($sel) {
    '1' { $files = @("ingestion-$today.log","access-$today.log","error-$today.log") | ForEach-Object { Join-Path $LOG_DIR $_ } }
    '2' { $files = @("print-$today.log","access-$today.log","error-$today.log")     | ForEach-Object { Join-Path $LOG_DIR $_ } }
    default { Write-Host "Invalid choice." -ForegroundColor Yellow; return }
  }
  foreach ($f in $files) { if (-not (Test-Path $f)) { New-Item -ItemType File -Path $f -Force | Out-Null } }
  Write-Host "Press Ctrl+C to stop tailing." -ForegroundColor DarkCyan
  Get-Content -Path $files -Tail 10 -Wait
}

# --------------------------- SERVICE CONTROL -------------------------------
function Control-Flow {
  Write-Header "Service Control"
  Write-Host "  1) Start both"
  Write-Host "  2) Stop both"
  Write-Host "  3) Restart both"
  Write-Host "  4) Start System only"
  Write-Host "  5) Stop System only"
  Write-Host "  6) Restart System only"
  Write-Host "  7) Start User only"
  Write-Host "  8) Stop User only"
  Write-Host "  9) Restart User only"
  $c = Read-Host "Select option"
  switch ($c) {
    '1' { Start-ServiceSafe   $SERVICE_SYS; Start-ServiceSafe   $SERVICE_USR }
    '2' { Stop-ServiceSafe    $SERVICE_SYS; Stop-ServiceSafe    $SERVICE_USR }
    '3' { Restart-ServiceSafe $SERVICE_SYS; Restart-ServiceSafe $SERVICE_USR }
    '4' { Start-ServiceSafe   $SERVICE_SYS }
    '5' { Stop-ServiceSafe    $SERVICE_SYS }
    '6' { Restart-ServiceSafe $SERVICE_SYS }
    '7' { Start-ServiceSafe   $SERVICE_USR }
    '8' { Stop-ServiceSafe    $SERVICE_USR }
    '9' { Restart-ServiceSafe $SERVICE_USR }
    default { Write-Host "Invalid option." -ForegroundColor Yellow }
  }
}

function Main-Menu {
  Ensure-Admin
  Write-Header "OpenDocViewer — Log Servers Manager"
  Write-Host "Repo Root : $REPO_ROOT"
  Write-Host "Server Dir: $SERVER_DIR"
  Show-Status
  Write-Host ""
  Write-Host "Choose an action:" -ForegroundColor Cyan
  Write-Host "  1) Install services"
  Write-Host "  2) Service control (start/stop/restart)"
  Write-Host "  3) Uninstall services"
  Write-Host "  4) Show status"
  Write-Host "  5) Open logs folder"
  Write-Host "  6) Tail today's logs"
  Write-Host "  7) Exit"
  $sel = Read-Host "Enter number"
  switch ($sel) {
    '1' { Install-Flow }
    '2' { Control-Flow }
    '3' { Uninstall-Flow }
    '4' { Show-Status }
    '5' { Open-LogFolder }
    '6' { Tail-Logs }
    '7' { return }
    default { Write-Host "Invalid selection." -ForegroundColor Yellow }
  }
  Main-Menu
}

Main-Menu
