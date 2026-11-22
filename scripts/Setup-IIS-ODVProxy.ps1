<#
.SYNOPSIS
  Install/Update a minimal IIS app that reverse-proxies ODV log endpoints.

.DESCRIPTION
  Creates (or updates) an IIS application (default name "ODVProxy") from the
  IIS-ODVProxyApp folder. Generates web.config from the template, toggling and
  pointing the two reverse-proxy rules.

  Changes for the whole server:
    - Always (when a proxy rule is enabled): turns ARR proxying on
      (system.webServer/proxy enabled).
    - Only with -ForwardClientHeaders: unlocks the configuration section
      system.webServer/rewrite/allowedServerVariables (appcmd unlock config), which lets every
      site and application on the server define that section in its own web.config.
  Everything else is scoped to the proxy application, including the allowedServerVariables
  entry for HTTP_X_FORWARDED_HOST that the user-log rule needs. That entry is written for the
  application's location in applicationHost.config and stays there; the script has no
  uninstall. ARR's server-wide preserveHostHeader is not changed.

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
  Optional. If set, both proxy rules also forward X-Forwarded-For and X-Forwarded-Proto (and the
  system-log rule X-Forwarded-Host), and <allowedServerVariables> is injected into web.config.
  That requires the section to be unlocked, which the script does for the whole server.
  Default: off (prevents IIS 500.52 when section is locked).

.PARAMETER AppCmdPath
  Path to appcmd.exe, used only with -ForwardClientHeaders.
  Default: "%windir%\system32\inetsrv\appcmd.exe"
#>

[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$SiteName         = "Default Web Site",
  [string]$AppPath          = "ODVProxy",
  [string]$PhysicalPath     = "C:\inetpub\ODVProxy",
  [bool]  $EnableSystemLog  = $true,
  [bool]  $EnableUserLog    = $true,
  [string]$SystemLogUrl     = "http://localhost:3001/log",
  [string]$UserLogUrl       = "http://localhost:3002/userlog/record",
  [switch]$ForwardClientHeaders,
  [string]$AppCmdPath       = "$env:windir\system32\inetsrv\appcmd.exe"
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
    Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
      -filter 'system.webServer/proxy' -name 'enabled' -value 'True' -ErrorAction Stop
    Write-Ok "ARR proxying is enabled at server level."
  } catch {
    Write-Err "Failed to enable ARR proxy. Ensure 'Application Request Routing' is installed and proxying is enabled."
    throw
  }
}

# The user-log origin check compares Origin/Referer with the public host, while ARR replaces
# Host with the localhost upstream. The user-log rule therefore forwards the public host in
# X-Forwarded-Host, which the user-log server trusts only from loopback. URL Rewrite sets a
# request header only when its server variable is in allowedServerVariables. The entry is added
# for this application's location only: no other site or application on the server is affected,
# and ARR's server-wide preserveHostHeader is deliberately left as it is.
if ($EnableUserLog) {
  $userLogHost = try { ([uri]$UserLogUrl).Host.Trim('[', ']') } catch { '' }
  if (@('localhost', '127.0.0.1', '::1') -notcontains $userLogHost) {
    Write-Warn "-UserLogUrl '$UserLogUrl' is not a loopback address. The user log server trusts X-Forwarded-Host from loopback only, so browser posts through this proxy will be answered with 403."
  }
  $AppLocation = "$SiteName/$($AppPath.Trim('/'))"
  $allowFilter = 'system.webServer/rewrite/allowedServerVariables'
  try {
    # Reads the effective list at the location, so an entry inherited from the server counts.
    $allowedEntry = Get-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -location $AppLocation `
      -filter "$allowFilter/add[@name='HTTP_X_FORWARDED_HOST']" -name 'name' -ErrorAction SilentlyContinue
    if ($allowedEntry) {
      Write-Ok "HTTP_X_FORWARDED_HOST is already allowed for '$AppLocation'."
    } else {
      Add-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -location $AppLocation `
        -filter $allowFilter -name '.' -value @{ name = 'HTTP_X_FORWARDED_HOST' } -ErrorAction Stop
      Write-Ok "Allowed HTTP_X_FORWARDED_HOST for '$AppLocation' only."
    }
  } catch {
    Write-Err "Failed to allow HTTP_X_FORWARDED_HOST for '$AppLocation'. The user-log rule needs it; without it IIS answers 500.50."
    throw
  }
}

# Prepare physical folder
if (!(Test-Path $PhysicalPath)) {
  New-Item -ItemType Directory -Path $PhysicalPath | Out-Null
  Write-Ok "Created folder: $PhysicalPath"
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

# Only inject allowedServerVariables if explicitly requested
$allowed = @"
<allowedServerVariables>
  <add name="HTTP_X_FORWARDED_FOR" />
  <add name="HTTP_X_FORWARDED_PROTO" />
  <add name="HTTP_X_FORWARDED_HOST" />
</allowedServerVariables>
"@

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

if ($ForwardClientHeaders) {
  # Best-effort unlock to avoid 500.52 if locked. This changes the section's lock for the
  # whole server.
  try {
    & $AppCmdPath unlock config /section:system.webServer/rewrite/allowedServerVariables | Out-Null
  } catch {
    Write-Warn "Could not unlock 'rewrite/allowedServerVariables'. If browsing fails with 500.52, re-run WITHOUT -ForwardClientHeaders."
  }
  if ($EnableUserLog) {
    # Already allowed for this application above; a second entry here would be a duplicate.
    $allowed = $allowed.Replace('  <add name="HTTP_X_FORWARDED_HOST" />', '')
  }
  $config = $config.Replace("<!--__ALLOWED_SERVER_VARIABLES__-->", ($allowed.Trim() + "`r`n" + $schemeMap.Trim()))
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

$configPath = Join-Path $PhysicalPath "web.config"
Set-Content -Path $configPath -Value $config -Encoding UTF8
Copy-Item -Path $IdxFile -Destination (Join-Path $PhysicalPath "index.html") -Force

Write-Ok "Wrote $(Split-Path -Leaf $configPath) and index.html"

# Create app pool (No Managed Code)
$appPoolName = "ODVProxyAppPool"
if (-not (Test-Path IIS:\AppPools\$appPoolName)) {
  New-WebAppPool -Name $appPoolName | Out-Null
  Set-ItemProperty IIS:\AppPools\$appPoolName -Name managedRuntimeVersion -Value ""
  Write-Ok "Created app pool: $appPoolName (No Managed Code)"
}

# Create/Update IIS application
$AppVDir = $AppPath.Trim('/')

if (Test-Path ("IIS:\Sites\$SiteName\$AppVDir")) {
  Write-Info "Application exists; updating physical path and app pool."
  Set-ItemProperty ("IIS:\Sites\$SiteName\$AppVDir") -Name physicalPath -Value $PhysicalPath
  Set-ItemProperty ("IIS:\Sites\$SiteName\$AppVDir") -Name applicationPool -Value $appPoolName
} else {
  New-WebApplication -Site $SiteName -Name $AppVDir -PhysicalPath $PhysicalPath -ApplicationPool $appPoolName | Out-Null
  Write-Ok "Created IIS application: /$AppVDir under site '$SiteName'"
}

# Recycle pool to pick up changes
Restart-WebAppPool $appPoolName
Write-Ok "Deployment complete. Proxy base URL: /$AppVDir/"
Write-Host ""
Write-Host "Next steps:"

Write-Host "  - SystemLog proxy: " -NoNewline
if ($EnableSystemLog) { Write-Host "ENABLED" -ForegroundColor Green } else { Write-Host "disabled" -ForegroundColor Yellow }

Write-Host "  - UserLog  proxy: " -NoNewline
if ($EnableUserLog)   { Write-Host "ENABLED" -ForegroundColor Green } else { Write-Host "disabled" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Test with: scripts\\Test-ODV-IISProxy.ps1 -BaseUrl https://your-host/$AppVDir/"
