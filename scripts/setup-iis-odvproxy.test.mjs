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
param([string]$ScriptPath, [string]$ParamsPath, [string]$LogPath, [string]$AppCmdStub)
$ErrorActionPreference = 'Stop'

function global:Write-IisCall([string]$Command, $Bound) {
  $record = [ordered]@{ command = $Command }
  foreach ($key in $Bound.Keys) { $record[$key.ToLowerInvariant()] = $Bound[$key] }
  ($record | ConvertTo-Json -Compress -Depth 5) | Add-Content -LiteralPath $env:ODV_IIS_CALL_LOG -Encoding utf8
}
function global:Import-Module { param($Name, $ErrorAction) }
function global:Get-WebGlobalModule { param($Name, $ErrorAction) [pscustomobject]@{ Name = $Name } }
function global:Get-WebConfigurationProperty {
  param($PSPath, $Location, $Filter, $Name, $ErrorAction)
  Write-IisCall 'Get-WebConfigurationProperty' $PSBoundParameters
  # ODV_IIS_ALLOWED names the server variables the stand-in reports as already allowed.
  foreach ($allowedName in @("$env:ODV_IIS_ALLOWED" -split ',' | Where-Object { $_ })) {
    if ("$Filter".EndsWith("add[@name='$allowedName']")) { return [pscustomobject]@{ Value = $allowedName } }
  }
}
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
# A program started through & or . (appcmd.exe) must be started through $AppCmdPath and nothing
# else, and no command may name appcmd directly. $AppCmdPath is forced to the recording stand-in
# below, so the real appcmd.exe can never run from a test.
$invocations = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) |
  Where-Object { $_.InvocationOperator -ne 'Unknown' -or $_.Extent.Text -match 'appcmd' -or -not $_.GetCommandName() }
foreach ($invocation in $invocations) {
  $first = $invocation.CommandElements[0]
  $viaParameter = $first -is [System.Management.Automation.Language.VariableExpressionAst] -and $first.VariablePath.UserPath -eq 'AppCmdPath'
  if (-not $viaParameter) { throw "Refusing to run: '$($invocation.Extent.Text)' starts a program that is not the recording stand-in." }
}
$assignments = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true) |
  Where-Object { $_.Left.Extent.Text -match '^\$(script:|global:)?AppCmdPath$' }
if ($assignments) { throw 'Refusing to run: the setup script reassigns $AppCmdPath.' }
if (-not (Microsoft.PowerShell.Management\Test-Path -LiteralPath $AppCmdStub -PathType Leaf)) { throw 'Refusing to run: the appcmd stand-in is missing.' }

$params = @{}
(Get-Content -LiteralPath $ParamsPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $params[$_.Name] = $_.Value }
$params['AppCmdPath'] = $AppCmdStub
& $ScriptPath @params
`;

// Recording stand-in for appcmd.exe: logs its arguments and changes nothing.
const appCmdStub = String.raw`
([ordered]@{ command = 'appcmd'; arguments = @($args | ForEach-Object { "$_" }) } | ConvertTo-Json -Compress) |
  Add-Content -LiteralPath $env:ODV_IIS_CALL_LOG -Encoding utf8
`;

function runSetup(params, { alreadyAllowed = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-iis-setup-'));
  const harnessPath = path.join(dir, 'harness.ps1');
  const paramsPath = path.join(dir, 'params.json');
  const logPath = path.join(dir, 'calls.jsonl');
  const physicalPath = path.join(dir, 'site');
  const appCmdStubPath = path.join(dir, 'appcmd-stand-in.ps1');
  fs.writeFileSync(harnessPath, harness, 'utf8');
  fs.writeFileSync(appCmdStubPath, appCmdStub, 'utf8');
  fs.writeFileSync(paramsPath, JSON.stringify({ SiteName: 'Test Site', AppPath: 'ODVProxy', PhysicalPath: physicalPath, ...params }), 'utf8');
  fs.writeFileSync(logPath, '', 'utf8');
  return new Promise((resolve) => {
    execFile(
      'pwsh',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', harnessPath, '-ScriptPath', script, '-ParamsPath', paramsPath, '-LogPath', logPath, '-AppCmdStub', appCmdStubPath],
      { encoding: 'utf8', timeout: 90_000, windowsHide: true, env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', ODV_IIS_ALLOWED: alreadyAllowed.join(',') } },
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

  test('replaces every template placeholder and forwards no client headers by default', async () => {
    const result = await runSetup({});
    assert.equal(result.code, 0, result.output);
    assert.doesNotMatch(result.webConfig, /__[A-Z][A-Z_]*__/);
    assert.doesNotMatch(result.webConfig, /X_FORWARDED_(FOR|PROTO)|rewriteMaps|<allowedServerVariables>/);
    assert.deepEqual(result.calls.filter((call) => call.command === 'appcmd'), []);
  }, 120_000);

  test('with -ForwardClientHeaders both rules forward the client headers and only the stand-in appcmd runs', async () => {
    const result = await runSetup({ ForwardClientHeaders: true });
    assert.equal(result.code, 0, result.output);
    assert.doesNotMatch(result.webConfig, /__[A-Z][A-Z_]*__/);

    assert.deepEqual(
      result.calls.filter((call) => call.command === 'appcmd').map((call) => call.arguments),
      [['unlock', 'config', '/section:system.webServer/rewrite/allowedServerVariables']],
    );
    // Still the only server-wide configuration write.
    assert.deepEqual(
      writes(result.calls).filter((call) => !call.location).map((call) => [call.filter, call.name]),
      [['system.webServer/proxy', 'enabled']],
    );

    const sets = (rule) => [...rule.matchAll(/<set name="(\w+)" value="([^"]*)" \/>/g)].map((match) => `${match[1]}=${match[2]}`);
    const systemRule = ruleBlock(result.webConfig, 'Proxy_SystemLog');
    const userRule = ruleBlock(result.webConfig, 'Proxy_UserLog');
    for (const rule of [systemRule, userRule]) {
      assert.equal(rule.match(/<serverVariables>/g)?.length, 1, rule);
      assert.deepEqual(sets(rule).sort(), [
        'HTTP_X_FORWARDED_FOR={REMOTE_ADDR}',
        'HTTP_X_FORWARDED_HOST={HTTP_HOST}',
        'HTTP_X_FORWARDED_PROTO={OdvProxyScheme:{HTTPS}}',
      ]);
    }

    const allowed = /<allowedServerVariables>([\s\S]*?)<\/allowedServerVariables>/.exec(result.webConfig);
    assert.ok(allowed, result.webConfig);
    // HTTP_X_FORWARDED_HOST is allowed for the application's location instead; twice is an IIS error.
    assert.deepEqual([...allowed[1].matchAll(/<add name="(\w+)" \/>/g)].map((match) => match[1]),
      ['HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED_PROTO']);
    assert.match(result.webConfig, /<rewriteMap name="OdvProxyScheme" defaultValue="http">/);
  }, 120_000);

  test('puts the server variables before the action in both rules', async () => {
    const result = await runSetup({ ForwardClientHeaders: true });
    assert.equal(result.code, 0, result.output);
    for (const name of ['Proxy_SystemLog', 'Proxy_UserLog']) {
      const rule = ruleBlock(result.webConfig, name);
      assert.ok(rule.indexOf('<serverVariables>') > 0, rule);
      assert.ok(rule.indexOf('</serverVariables>') < rule.indexOf('<action '), rule);
    }
  }, 120_000);

  test('never repeats a server variable that is already allowed for the application', async () => {
    const allowedNames = (webConfig) => {
      const block = /<allowedServerVariables>([\s\S]*?)<\/allowedServerVariables>/.exec(webConfig);
      return block ? [...block[1].matchAll(/<add name="(\w+)" \/>/g)].map((match) => match[1]) : null;
    };
    const appcmd = (calls) => calls.filter((call) => call.command === 'appcmd').length;

    const one = await runSetup({ ForwardClientHeaders: true }, { alreadyAllowed: ['HTTP_X_FORWARDED_FOR'] });
    assert.equal(one.code, 0, one.output);
    assert.deepEqual(allowedNames(one.webConfig), ['HTTP_X_FORWARDED_PROTO']);
    assert.equal(appcmd(one.calls), 1);

    // Everything allowed already: no section in web.config, nothing to unlock, rules unchanged.
    const all = await runSetup({ ForwardClientHeaders: true },
      { alreadyAllowed: ['HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED_PROTO', 'HTTP_X_FORWARDED_HOST'] });
    assert.equal(all.code, 0, all.output);
    assert.equal(allowedNames(all.webConfig), null);
    assert.equal(appcmd(all.calls), 0);
    assert.deepEqual(writes(all.calls).filter((call) => call.location), []);
    assert.match(ruleBlock(all.webConfig, 'Proxy_SystemLog'), /HTTP_X_FORWARDED_PROTO/);
    assert.match(all.webConfig, /<rewriteMap name="OdvProxyScheme"/);

    // Without the user-log rule the host variable is not added for the location, so web.config carries it.
    const systemOnly = await runSetup({ ForwardClientHeaders: true, EnableUserLog: false });
    assert.equal(systemOnly.code, 0, systemOnly.output);
    assert.deepEqual(allowedNames(systemOnly.webConfig),
      ['HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED_PROTO', 'HTTP_X_FORWARDED_HOST']);
  }, 240_000);

  test('warns when the user-log upstream is not a loopback address', async () => {
    const remote = await runSetup({ UserLogUrl: 'http://logs.example:3002/userlog/record' });
    assert.equal(remote.code, 0, remote.output);
    assert.match(remote.output, /is not a loopback address/);
    for (const url of ['http://localhost:3002/userlog/record', 'http://127.0.0.1:3002/userlog/record', 'http://[::1]:3002/userlog/record']) {
      const local = await runSetup({ UserLogUrl: url });
      assert.equal(local.code, 0, local.output);
      assert.doesNotMatch(local.output, /is not a loopback address/);
    }
  }, 240_000);

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
  // Every placeholder is a comment or an attribute value, so none can end up as raw text.
  assert.doesNotMatch(text.replace(/<!--[\s\S]*?-->/g, '').replace(/"[^"]*"/g, '""'), /__[A-Z][A-Z_]*__/);
});
