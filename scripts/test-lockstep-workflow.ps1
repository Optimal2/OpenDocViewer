# Seed the caller before the runner dot-sources its extracted step at top level.
[CmdletBinding()]
param(
    [ValidateSet('undefined', 'zero')][string]$InitialExit = 'undefined'
)

if ($InitialExit -eq 'zero') {
    $global:LASTEXITCODE = 0
} else {
    Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
}
