<#
.SYNOPSIS
  Install/Update a minimal IIS app that reverse-proxies ODV log endpoints.

.DESCRIPTION
  Creates (or updates) an IIS application (default name "ODVProxy") from the
  IIS-ODVProxyApp folder. Generates web.config from the template, toggling and
  pointing the two reverse-proxy rules.

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
  Optional. If set, injects <allowedServerVariables> (requires section unlocked at server level).
  Default: off (prevents IIS 500.52 when section is locked).
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
    Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
      -filter 'system.webServer/proxy' -name 'enabled' -value 'True' -ErrorAction Stop
    Write-Ok "ARR proxying is enabled at server level."
  } catch {
    Write-Err "Failed to enable ARR proxy. Ensure 'Application Request Routing' is installed and proxying is enabled."
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

if ($ForwardClientHeaders) {
  # Best-effort unlock to avoid 500.52 if locked
  try {
    & "$env:windir\system32\inetsrv\appcmd.exe" unlock config /section:system.webServer/rewrite/allowedServerVariables | Out-Null
  } catch {
    Write-Warn "Could not unlock 'rewrite/allowedServerVariables'. If browsing fails with 500.52, re-run WITHOUT -ForwardClientHeaders."
  }
  $config = $config.Replace("<!--__ALLOWED_SERVER_VARIABLES__-->", $allowed.Trim())
} else {
  $config = $config.Replace("<!--__ALLOWED_SERVER_VARIABLES__-->", "")
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
