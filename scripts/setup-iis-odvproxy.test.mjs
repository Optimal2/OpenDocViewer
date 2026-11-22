// File: scripts/setup-iis-odvproxy.test.mjs
/**
 * Setup-IIS-ODVProxy.ps1 must not change IIS settings for the whole server beyond turning the
 * ARR proxy on. The script runs here against recording stand-ins for the IIS cmdlets: nothing
 * touches a real IIS, and the run aborts before the script starts if any IIS command the script
 * uses would resolve to something other than a stand-in.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'Setup-IIS-ODVProxy.ps1');
const template = path.join(here, '..', 'IIS-ODVProxyApp', 'web.config.template');

// Stand-ins for everything the setup script asks of IIS. Each call is appended to the log as one
// JSON line. Import-Module is replaced too, so the real WebAdministration module is never loaded.
const harness = String.raw`
param([string]$ScriptPath, [string]$ParamsPath, [string]$LogPath)
$ErrorActionPreference = 'Stop'

function global:Write-IisCall([string]$Command, $Bound) {
  $record = [ordered]@{ command = $Command }
  foreach ($key in $Bound.Keys) { $record[$key.ToLowerInvariant()] = $Bound[$key] }
  ($record | ConvertTo-Json -Compress -Depth 5) | Add-Content -LiteralPath $env:ODV_IIS_CALL_LOG -Encoding utf8
}
function global:Import-Module { param($Name, $ErrorAction) }
function global:Get-WebGlobalModule { param($Name, $ErrorAction) [pscustomobject]@{ Name = $Name } }
function global:Get-WebConfigurationProperty { param($PSPath, $Location, $Filter, $Name, $ErrorAction) Write-IisCall 'Get-WebConfigurationProperty' $PSBoundParameters }
function global:Set-WebConfigurationProperty { param($PSPath, $Location, $Filter, $Name, $Value, $ErrorAction) Write-IisCall 'Set-WebConfigurationProperty' $PSBoundParameters }
function global:Add-WebConfigurationProperty { param($PSPath, $Location, $Filter, $Name, $Value, $ErrorAction) Write-IisCall 'Add-WebConfigurationProperty' $PSBoundParameters }
function global:New-WebAppPool { param($Name) Write-IisCall 'New-WebAppPool' $PSBoundParameters }
function global:New-WebApplication { param($Site, $Name, $PhysicalPath, $ApplicationPool) Write-IisCall 'New-WebApplication' $PSBoundParameters }
function global:Restart-WebAppPool { param($Name) Write-IisCall 'Restart-WebAppPool' $PSBoundParameters }
function global:Set-ItemProperty { param($Path, $Name, $Value) Write-IisCall 'Set-ItemProperty' $PSBoundParameters }
function global:Test-Path {
  param($Path)
  if ("$Path" -like 'IIS:*') { return $false }
  Microsoft.PowerShell.Management\Test-Path -LiteralPath $Path
}

$env:ODV_IIS_CALL_LOG = $LogPath
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Setup script does not parse: $($errors[0].Message)" }
$commands = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) |
  ForEach-Object { $_.GetCommandName() } | Where-Object { $_ -match 'Web|AppPool|^Import-Module$' } | Sort-Object -Unique
foreach ($command in $commands) {
  $resolved = Get-Command -Name $command -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $resolved -or $resolved.CommandType -ne 'Function') {
    throw "Refusing to run: '$command' is not a recording stand-in."
  }
}

$params = @{}
(Get-Content -LiteralPath $ParamsPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $params[$_.Name] = $_.Value }
& $ScriptPath @params
`;

function runSetup(params) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-iis-setup-'));
  const harnessPath = path.join(dir, 'harness.ps1');
  const paramsPath = path.join(dir, 'params.json');
  const logPath = path.join(dir, 'calls.jsonl');
  const physicalPath = path.join(dir, 'site');
  fs.writeFileSync(harnessPath, harness, 'utf8');
  fs.writeFileSync(paramsPath, JSON.stringify({ SiteName: 'Test Site', AppPath: 'ODVProxy', PhysicalPath: physicalPath, ...params }), 'utf8');
  fs.writeFileSync(logPath, '', 'utf8');
  return new Promise((resolve) => {
    execFile(
      'pwsh',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', harnessPath, '-ScriptPath', script, '-ParamsPath', paramsPath, '-LogPath', logPath],
      { encoding: 'utf8', timeout: 90_000, windowsHide: true, env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' } },
      (error, stdout, stderr) => {
        const calls = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
        const configPath = path.join(physicalPath, 'web.config');
        const webConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
        fs.rmSync(dir, { recursive: true, force: true });
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, output: stdout + stderr, calls, webConfig });
      },
    );
  });
}

const writes = (calls) => calls.filter((call) => /^(Set|Add)-WebConfigurationProperty$/.test(call.command));
const ruleBlock = (webConfig, name) => {
  const match = new RegExp(`<rule name="${name}"[\\s\\S]*?</rule>`).exec(webConfig);
  return match ? match[0] : '';
};

// The setup script is for IIS, which exists on Windows only.
describe.skipIf(process.platform !== 'win32')('Setup-IIS-ODVProxy.ps1', () => {
  test('changes nothing for the whole server except turning the ARR proxy on', async () => {
    const result = await runSetup({});
    assert.equal(result.code, 0, result.output);

    const serverWide = writes(result.calls).filter((call) => !call.location);
    assert.deepEqual(
      serverWide.map((call) => [call.pspath, call.filter, call.name, call.value]),
      [['MACHINE/WEBROOT/APPHOST', 'system.webServer/proxy', 'enabled', 'True']],
      result.output,
    );
    assert.equal(writes(result.calls).some((call) => /preserveHostHeader/i.test(String(call.name))), false);
  }, 120_000);

  test('allows the forwarded-host variable for the proxy application only and sets it on the user-log rule', async () => {
    const result = await runSetup({});
    assert.equal(result.code, 0, result.output);

    const scoped = writes(result.calls).filter((call) => call.location);
    assert.deepEqual(
      scoped.map((call) => [call.command, call.pspath, call.location, call.filter, call.value?.name]),
      [['Add-WebConfigurationProperty', 'MACHINE/WEBROOT/APPHOST', 'Test Site/ODVProxy',
        'system.webServer/rewrite/allowedServerVariables', 'HTTP_X_FORWARDED_HOST']],
      result.output,
    );

    const userRule = ruleBlock(result.webConfig, 'Proxy_UserLog');
    assert.match(userRule, /<serverVariables>\s*<set name="HTTP_X_FORWARDED_HOST" value="\{HTTP_HOST\}" \/>\s*<\/serverVariables>/);
    assert.match(userRule, /enabled="true"/);
    assert.doesNotMatch(ruleBlock(result.webConfig, 'Proxy_SystemLog'), /serverVariables/);
  }, 120_000);

  test('does not touch the allow list when the user-log proxy is off', async () => {
    const result = await runSetup({ EnableUserLog: false });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(writes(result.calls).filter((call) => call.location), []);
    assert.match(ruleBlock(result.webConfig, 'Proxy_UserLog'), /enabled="false"/);
  }, 120_000);
});

test('the proxy template forwards the public host on the user-log rule only', () => {
  const text = fs.readFileSync(template, 'utf8');
  assert.match(ruleBlock(text, 'Proxy_UserLog'), /<set name="HTTP_X_FORWARDED_HOST" value="\{HTTP_HOST\}" \/>/);
  assert.doesNotMatch(ruleBlock(text, 'Proxy_SystemLog'), /HTTP_X_FORWARDED_HOST/);
});
