<#
.SYNOPSIS
  Install/Update a minimal IIS app that reverse-proxies ODV log endpoints.

.DESCRIPTION
  Creates (or updates) an IIS application (default name "ODVProxy") from the
  IIS-ODVProxyApp folder. Generates web.config from the template, toggling and
  pointing the two reverse-proxy rules.

  Runs in Windows PowerShell 5.1 (powershell.exe) as administrator. It uses the IIS: drive of
  the WebAdministration module, which PowerShell 7 does not provide, so the script refuses to
  start there instead of stopping halfway.

  The one change for the whole server: when a proxy rule is enabled, ARR proxying is turned on
  (system.webServer/proxy enabled). Everything else is scoped to the proxy application. No
  configuration section is unlocked, and ARR's server-wide preserveHostHeader is not changed.

  A request header that a proxy rule sets needs its server variable in allowedServerVariables.
  The script allows exactly the variables that the enabled rules set, for the application's
  location in applicationHost.config, and never in the application's own web.config. A
  variable that the server or the site already allows is left alone. Those entries stay after
  the application is removed; the script has no uninstall.

  -WhatIf shows what would be done and changes nothing. Every step that changes something,
  on disk or in IIS, sits behind its own ShouldProcess check in this script, so that does not
  depend on how the IIS cmdlets treat -WhatIf. The final check is skipped then.

  The script can be run any number of times: the same switches give the same web.config and the
  same allow list. It ends by reading the allow list back and fails if a variable that a rule
  sets is not allowed, since IIS would then answer every proxied request with 500.

  Run the script again after an upgrade: the user-log rule has to forward X-Forwarded-Host,
  otherwise the user log server answers browser posts with 403. The user-log upstream
  (-UserLogUrl) must be a loopback address (localhost, 127.0.0.1 or [::1]), because the user
  log server trusts X-Forwarded-Host from loopback only.

.PARAMETER SiteName
  IIS site to host the application. Default: "Default Web Site"

.PARAMETER AppPath
  Application path (virtual directory name). Default: "ODVProxy" (=> /ODVProxy)

.PARAMETER PhysicalPath
  Where to deploy files. Default: "C:\inetpub\ODVProxy"

.PARAMETER EnableSystemLog
  Enable /log proxy rule. Default: $true

.PARAMETER EnableUserLog
  Enable /userlog/record proxy rule. Default: $true

.PARAMETER SystemLogUrl
  Upstream URL for system log. Default: "http://localhost:3001/log"

.PARAMETER UserLogUrl
  Upstream URL for user log. Default: "http://localhost:3002/userlog/record"

.PARAMETER ForwardClientHeaders
  Optional. If set, both proxy rules also forward X-Forwarded-For and X-Forwarded-Proto, and
  the system-log rule X-Forwarded-Host. Default: off.
#>

#requires -PSEdition Desktop

[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$SiteName         = "Default Web Site",
  [string]$AppPath          = "ODVProxy",
  [string]$PhysicalPath     = "C:\inetpub\ODVProxy",
  [bool]  $EnableSystemLog  = $true,
  [bool]  $EnableUserLog    = $true,
  [string]$SystemLogUrl     = "http://localhost:3001/log",
  [string]$UserLogUrl       = "http://localhost:3002/userlog/record",
  [switch]$ForwardClientHeaders
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration -ErrorAction Stop

function Write-Info([string]$m){ Write-Host "[*] $m" -ForegroundColor Cyan }
function Write-Ok  ([string]$m){ Write-Host "[✓] $m" -ForegroundColor Green }
function Write-Warn([string]$m){ Write-Host "[!] $m" -ForegroundColor Yellow }
function Write-Err ([string]$m){ Write-Host "[×] $m" -ForegroundColor Red }

# Paths
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$SrcDir   = Join-Path $RepoRoot "IIS-ODVProxyApp"
$TplFile  = Join-Path $SrcDir   "web.config.template"
$IdxFile  = Join-Path $SrcDir   "index.html"

if (!(Test-Path $TplFile)) { throw "Template not found: $TplFile" }
if (!(Test-Path $IdxFile)) { throw "index.html not found: $IdxFile" }

# Ensure URL Rewrite + ARR proxy (best-effort checks)
try {
  Get-WebGlobalModule -Name "RewriteModule" -ErrorAction Stop | Out-Null
  Write-Ok "IIS URL Rewrite is installed."
} catch {
  Write-Err "IIS URL Rewrite is NOT installed. Install it and re-run."
  throw
}

if ($EnableSystemLog -or $EnableUserLog) {
  try {
    # Enabling proxy requires ARR; this will fail if ARR is missing
    if ($PSCmdlet.ShouldProcess('IIS server (system.webServer/proxy)', 'Turn ARR proxying on')) {
      Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
        -filter 'system.webServer/proxy' -name 'enabled' -value 'True' -ErrorAction Stop
      Write-Ok "ARR proxying is enabled at server level."
    }
  } catch {
    Write-Err "Failed to enable ARR proxy. Ensure 'Application Request Routing' is installed and proxying is enabled."
    throw
  }
}

# The user-log origin check compares Origin/Referer with the public host, while ARR replaces
# Host with the localhost upstream. The user-log rule therefore forwards the public host in
# X-Forwarded-Host, which the user-log server trusts only from loopback.
if ($EnableUserLog) {
  $userLogIsLoopback = $false
  try { $userLogIsLoopback = ([uri]$UserLogUrl).IsLoopback } catch { $userLogIsLoopback = $false }
  if (-not $userLogIsLoopback) {
    Write-Warn "-UserLogUrl '$UserLogUrl' is not a loopback address. The user log server trusts X-Forwarded-Host from loopback only, so browser posts through this proxy will be answered with 403."
  }
}

$AppLocation = "$SiteName/$($AppPath.Trim('/'))"
$allowFilter = 'system.webServer/rewrite/allowedServerVariables'

# Whether a server variable is in the effective allowedServerVariables of the application: what
# the server and the site allow, the entries for the application's location, and the
# application's own web.config.
function Test-ServerVariableAllowed([string]$Name) {
  $entry = Get-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -location $AppLocation `
    -filter "$allowFilter/add[@name='$Name']" -name 'name' -ErrorAction SilentlyContinue
  return [bool]$entry
}

# The server variables that the enabled rules of a web.config set.
function Get-RuleServerVariables([string]$WebConfigText) {
  $names = @()
  foreach ($node in ([xml]$WebConfigText).SelectNodes("//rule[not(@enabled='false')]/serverVariables/set/@name")) {
    if ($names -notcontains $node.Value) { $names += $node.Value }
  }
  return $names
}

# Prepare physical folder
if (!(Test-Path $PhysicalPath)) {
  if ($PSCmdlet.ShouldProcess($PhysicalPath, 'Create folder')) {
    New-Item -ItemType Directory -Path $PhysicalPath | Out-Null
    Write-Ok "Created folder: $PhysicalPath"
  }
}

# Generate web.config from template
$config = Get-Content $TplFile -Raw
$config = $config.Replace("__SYSTEM_LOG_URL__", $SystemLogUrl)
$config = $config.Replace("__USER_LOG_URL__",   $UserLogUrl)

# Use if/else (no C-style ternary in PowerShell)
$enableSystemStr = if ($EnableSystemLog) { "true" } else { "false" }
$enableUserStr   = if ($EnableUserLog)   { "true" } else { "false" }

$config = $config.Replace("__ENABLE_SYSTEM_LOG__", $enableSystemStr)
$config = $config.Replace("__ENABLE_USER_LOG__",   $enableUserStr)

# The request headers the rules set with -ForwardClientHeaders. The scheme has no server variable
# of its own, so it is looked up in a rewrite map from {HTTPS} (on/off).
$forwardFor   = '<set name="HTTP_X_FORWARDED_FOR" value="{REMOTE_ADDR}" />'
$forwardProto = '<set name="HTTP_X_FORWARDED_PROTO" value="{OdvProxyScheme:{HTTPS}}" />'
$forwardHost  = '<set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />'
$schemeMap = @"
<rewriteMaps>
  <rewriteMap name="OdvProxyScheme" defaultValue="http">
    <add key="on" value="https" />
    <add key="off" value="http" />
  </rewriteMap>
</rewriteMaps>
"@

# web.config never declares allowedServerVariables itself (see below), so that placeholder is
# always replaced by the rewrite map or by nothing.
if ($ForwardClientHeaders) {
  $config = $config.Replace("<!--__ALLOWED_SERVER_VARIABLES__-->", $schemeMap.Trim())
  # The user-log rule always sets X-Forwarded-Host in the template; the others are added to it.
  $config = $config.Replace("<!--__USER_LOG_CLIENT_HEADERS__-->", ($forwardFor + "`r`n" + $forwardProto))
  $config = $config.Replace("<!--__SYSTEM_LOG_CLIENT_HEADERS__-->",
    ("<serverVariables>`r`n" + $forwardFor + "`r`n" + $forwardProto + "`r`n" + $forwardHost + "`r`n</serverVariables>"))
} else {
  $config = $config.Replace("<!--__ALLOWED_SERVER_VARIABLES__-->", "")
  $config = $config.Replace("<!--__USER_LOG_CLIENT_HEADERS__-->", "")
  $config = $config.Replace("<!--__SYSTEM_LOG_CLIENT_HEADERS__-->", "")
}
if ($config -cmatch '__[A-Z][A-Z_]*__') {
  throw "web.config.template has a placeholder that this script does not replace: $($Matches[0])"
}
$neededVariables = @(Get-RuleServerVariables $config)

$configPath = Join-Path $PhysicalPath "web.config"
if ($PSCmdlet.ShouldProcess($configPath, 'Write web.config')) {
  Set-Content -Path $configPath -Value $config -Encoding UTF8
  Write-Ok "Wrote $(Split-Path -Leaf $configPath)"
}
$indexPath = Join-Path $PhysicalPath "index.html"
if ($PSCmdlet.ShouldProcess($indexPath, 'Write index.html')) {
  Copy-Item -Path $IdxFile -Destination $indexPath -Force
  Write-Ok "Wrote index.html"
}

# Allow the server variables that the enabled rules set, for this application's location only.
# This comes AFTER web.config is written, and web.config never declares the section itself. The
# effective list read here therefore holds nothing that this script is about to overwrite: an
# earlier version read it first, counted the entries of the previous web.config as already
# allowed, and then wrote the file without them, so every second run left the proxy answering
# 500. A variable that the server or the site already allows is not added again, because a
# second entry for the same name is a configuration error.
foreach ($variable in $neededVariables) {
  try {
    if (Test-ServerVariableAllowed $variable) {
      Write-Ok "$variable is already allowed for '$AppLocation'."
    } elseif ($PSCmdlet.ShouldProcess("allowedServerVariables for '$AppLocation'", "Allow $variable")) {
      Add-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -location $AppLocation `
        -filter $allowFilter -name '.' -value @{ name = $variable } -ErrorAction Stop
      Write-Ok "Allowed $variable for '$AppLocation' only."
    }
  } catch {
    Write-Err "Failed to allow $variable for '$AppLocation'. A proxy rule sets it; without it IIS answers 500."
    throw
  }
}

# Create app pool (No Managed Code)
$appPoolName = "ODVProxyAppPool"
if (-not (Test-Path IIS:\AppPools\$appPoolName)) {
  if ($PSCmdlet.ShouldProcess("application pool '$appPoolName'", 'Create (No Managed Code)')) {
    New-WebAppPool -Name $appPoolName | Out-Null
    Set-ItemProperty IIS:\AppPools\$appPoolName -Name managedRuntimeVersion -Value ""
    Write-Ok "Created app pool: $appPoolName (No Managed Code)"
  }
}

# Create/Update IIS application
$AppVDir = $AppPath.Trim('/')

if (Test-Path ("IIS:\Sites\$SiteName\$AppVDir")) {
  if ($PSCmdlet.ShouldProcess("IIS application '$AppLocation'", 'Set physical path and application pool')) {
    Write-Info "Application exists; updating physical path and app pool."
    Set-ItemProperty ("IIS:\Sites\$SiteName\$AppVDir") -Name physicalPath -Value $PhysicalPath
    Set-ItemProperty ("IIS:\Sites\$SiteName\$AppVDir") -Name applicationPool -Value $appPoolName
  }
} elseif ($PSCmdlet.ShouldProcess("IIS application '$AppLocation'", 'Create')) {
  New-WebApplication -Site $SiteName -Name $AppVDir -PhysicalPath $PhysicalPath -ApplicationPool $appPoolName | Out-Null
  Write-Ok "Created IIS application: /$AppVDir under site '$SiteName'"
}

# Recycle pool to pick up changes
if ($PSCmdlet.ShouldProcess("application pool '$appPoolName'", 'Recycle')) {
  Restart-WebAppPool $appPoolName
}

# Final check: every server variable that an enabled rule sets must be allowed for the
# application now. If one is missing IIS answers every request to that rule with 500, so the
# script must not end as if all were well.
$notAllowed = @()
if ($WhatIfPreference) {
  # Under -WhatIf nothing above was written, so there is nothing to read back.
  Write-Info "WhatIf: nothing was changed, so the final check of the allow list was skipped."
} else {
  foreach ($variable in $neededVariables) {
    $allowedNow = $false
    try { $allowedNow = Test-ServerVariableAllowed $variable } catch { $allowedNow = $false }
    if (-not $allowedNow) { $notAllowed += $variable }
  }
}
if ($notAllowed.Count -gt 0) {
  $list = $notAllowed -join ', '
  Write-Err "Setup check failed: not allowed for '$AppLocation': $list"
  throw "Setup check failed. The proxy rules set server variables that are not allowed for '$AppLocation': $list. IIS answers every proxied request with 500 until they are in system.webServer/rewrite/allowedServerVariables for that application. web.config has been written; nothing was rolled back."
}
if (-not $WhatIfPreference) {
  Write-Ok "Checked: every server variable the proxy rules set is allowed for '$AppLocation'."
}

if ($WhatIfPreference) {
  Write-Info "WhatIf: nothing was changed. The steps above marked 'What if' are what a run without -WhatIf would do."
  return
}

Write-Ok "Deployment complete. Proxy base URL: /$AppVDir/"
Write-Host ""
Write-Host "Next steps:"

Write-Host "  - SystemLog proxy: " -NoNewline
if ($EnableSystemLog) { Write-Host "ENABLED" -ForegroundColor Green } else { Write-Host "disabled" -ForegroundColor Yellow }

Write-Host "  - UserLog  proxy: " -NoNewline
if ($EnableUserLog)   { Write-Host "ENABLED" -ForegroundColor Green } else { Write-Host "disabled" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Test with: scripts\\Test-ODV-IISProxy.ps1 -BaseUrl https://your-host/$AppVDir/"
