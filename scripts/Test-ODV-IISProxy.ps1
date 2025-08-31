<#
.SYNOPSIS
  Smoke-test the ODV IIS proxy app endpoints.

.DESCRIPTION
  Sends two POST requests through the proxy:
    1) {BaseUrl}/log              (JSON + x-log-token)
    2) {BaseUrl}/userlog/record   (form-encoded: reason, forWhom)

.PARAMETER BaseUrl
  Base URL of the IIS proxy app (e.g., http://localhost:8080/ODVProxy or with trailing slash).

.PARAMETER Token
  Optional system-log token to send as x-log-token. If not provided, the script
  tries to read it from -TokenFile (defaults to ..\server\logs\service\ODV-SystemLog.token.txt).

.PARAMETER TokenFile
  Optional path to a text file containing the token (one line). Defaults to:
    ..\server\logs\service\ODV-SystemLog.token.txt
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [string]$BaseUrl,

  [string]$Token,

  [string]$TokenFile
)

$ErrorActionPreference = 'Stop'

function Write-Ok  ($m){ Write-Host "[✓] $m" -ForegroundColor Green }
function Write-Err ($m){ Write-Host "[×] $m" -ForegroundColor Red }
function Write-Info($m){ Write-Host "[*] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[!] $m" -ForegroundColor Yellow }

# Normalize base URL to have exactly one trailing slash
if (-not $BaseUrl.EndsWith('/')) { $BaseUrl = "$BaseUrl/" }

# Default token file path (repo-relative: scripts -> ../server/logs/service/ODV-SystemLog.token.txt)
if (-not $TokenFile -or $TokenFile.Trim() -eq '') {
  $scriptDir = Split-Path -Parent $PSCommandPath
  $TokenFile = Join-Path $scriptDir "..\server\logs\service\ODV-SystemLog.token.txt"
}

# If no token provided, try to read it
if (-not $Token -and (Test-Path -Path $TokenFile)) {
  try {
    $Token = (Get-Content -Path $TokenFile -Raw).Trim()
    if (-not $Token) { Write-Warn "Token file exists but is empty: $TokenFile" }
  } catch {
    Write-Warn "Could not read token file: $TokenFile"
  }
}

Write-Info "Base URL : $BaseUrl"
Write-Info "Token    : " -NoNewline
if ($Token) { Write-Host "(provided or read from file)" -ForegroundColor Gray } else { Write-Host "(none)" -ForegroundColor Yellow }

# Helper: perform POST and show result
function Invoke-Probe {
  param(
    [Parameter(Mandatory=$true)] [string]$Url,
    [Parameter(Mandatory=$true)] [hashtable]$Options, # method, headers, contentType, body
    [string]$Label = ""
  )

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $resp = Invoke-WebRequest -Uri $Url `
                              -Method ($Options.method) `
                              -Headers ($Options.headers) `
                              -ContentType ($Options.contentType) `
                              -Body ($Options.body) `
                              -TimeoutSec 30 `
                              -ErrorAction Stop
    $sw.Stop()
    $code = [int]$resp.StatusCode
    if ($code -ge 200 -and $code -lt 300) {
      Write-Ok "$Url -> HTTP $code ($($sw.ElapsedMilliseconds) ms)"
    } else {
      Write-Err "$Url -> HTTP $code ($($sw.ElapsedMilliseconds) ms)"
    }
  } catch {
    $sw.Stop()
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $code = [int]$_.Exception.Response.StatusCode
      Write-Err "$Url -> HTTP $code ($($sw.ElapsedMilliseconds) ms)"
    } else {
      Write-Err "$Url -> request failed ($($sw.ElapsedMilliseconds) ms): $($_.Exception.Message)"
    }
  }
}

# 1) /log  (requires x-log-token; otherwise 401)
$logUrl = "${BaseUrl}log"
$logHeaders = @{}
if ($Token) { $logHeaders['x-log-token'] = $Token }

$logBodyObj = @{
  level   = 'info'
  message = 'ODVProxy smoke test'
  context = @{
    source = 'Test-ODV-IISProxy.ps1'
    ts     = (Get-Date).ToUniversalTime().ToString('o')
  }
}
$logBodyJson = $logBodyObj | ConvertTo-Json -Depth 4

Invoke-Probe -Url $logUrl -Options @{
  method      = 'POST'
  headers     = $logHeaders
  contentType = 'application/json'
  body        = $logBodyJson
} -Label 'system-log'

# 2) /userlog/record  (form-encoded)
$userUrl = "${BaseUrl}userlog/record"
$userForm = @{
  reason  = 'proxy-selftest'
  forWhom = 'ODVProxy test'
}

# Build x-www-form-urlencoded safely (avoid `-join` parsing issues)
$kvPairs = New-Object System.Collections.Generic.List[string]
foreach ($k in $userForm.Keys) {
  $encoded = "{0}={1}" -f [Uri]::EscapeDataString([string]$k), [Uri]::EscapeDataString([string]$userForm[$k])
  [void]$kvPairs.Add($encoded)
}
$userBody = [string]::Join('&', $kvPairs)

Invoke-Probe -Url $userUrl -Options @{
  method      = 'POST'
  headers     = @{}
  contentType = 'application/x-www-form-urlencoded'
  body        = $userBody
} -Label 'user-log'

Write-Host ""
Write-Info "Done."
