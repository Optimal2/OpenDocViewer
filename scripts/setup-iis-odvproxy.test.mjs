// File: scripts/setup-iis-odvproxy.test.mjs
/**
 * Setup-IIS-ODVProxy.ps1 runs here against stand-ins for the IIS cmdlets. Nothing touches a
 * real IIS, and the run aborts before the script starts if any IIS command the script uses
 * would resolve to something other than a stand-in, or if it starts any program.
 *
 * The stand-ins keep state between runs and answer like IIS does: the allowed server variables
 * of the application are the merged list of what the server and the site allow, what
 * applicationHost.config holds for the application's location, and what the application's own
 * web.config from the previous run declares. A name declared twice is a configuration error.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'Setup-IIS-ODVProxy.ps1');
const template = path.join(here, '..', 'IIS-ODVProxyApp', 'web.config.template');

const SITE = 'Test Site';
const APP = 'ODVProxy';
const LOCATION = `${SITE}/${APP}`;
const SECTION = 'system.webServer/rewrite/allowedServerVariables';
const FOR = 'HTTP_X_FORWARDED_FOR';
const PROTO = 'HTTP_X_FORWARDED_PROTO';
const HOST = 'HTTP_X_FORWARDED_HOST';

// Stand-ins for everything the setup script asks of IIS. Each call is appended to the log as one
// JSON line. Import-Module is replaced too, so the real WebAdministration module is never loaded.
// The state file holds one "kind<TAB>key<TAB>value" line per stored fact.
const harness = String.raw`
param([string]$ScriptPath, [string]$ParamsPath, [string]$LogPath, [string]$AppCmdStub)
$ErrorActionPreference = 'Stop'

function global:Write-IisCall([string]$Command, $Bound) {
  $record = [ordered]@{ command = $Command }
  foreach ($key in $Bound.Keys) { $record[$key.ToLowerInvariant()] = $Bound[$key] }
  ($record | ConvertTo-Json -Compress -Depth 5) | Add-Content -LiteralPath $env:ODV_IIS_CALL_LOG -Encoding Ascii
}
function global:Get-IisFacts([string]$Kind, [string]$Key) {
  $facts = @()
  if (Microsoft.PowerShell.Management\Test-Path -LiteralPath $env:ODV_IIS_STATE) {
    foreach ($line in @(Get-Content -LiteralPath $env:ODV_IIS_STATE)) {
      $parts = "$line".Split([char]9)
      if ($parts.Count -eq 3 -and $parts[0] -eq $Kind -and $parts[1] -eq $Key) { $facts += $parts[2] }
    }
  }
  return $facts
}
function global:Add-IisFact([string]$Kind, [string]$Key, [string]$Value) {
  ($Kind, $Key, $Value -join [char]9) | Add-Content -LiteralPath $env:ODV_IIS_STATE -Encoding Ascii
}
# The layers that make up the allowed server variables of a location, outermost first.
function global:Get-IisAllowedLayers([string]$Location) {
  $layers = @()
  $layers += ,@("$env:ODV_IIS_SERVER_ALLOWED" -split ',' | Where-Object { $_ })
  $layers += ,@(Get-IisFacts 'allowed' $Location)
  if ($Location -eq $env:ODV_IIS_APP_LOCATION) {
    $layers += ,@("$env:ODV_IIS_SITE_WEBCONFIG_ALLOWED" -split ',' | Where-Object { $_ })
    $own = @()
    if (Microsoft.PowerShell.Management\Test-Path -LiteralPath $env:ODV_IIS_APP_WEBCONFIG) {
      $text = Get-Content -LiteralPath $env:ODV_IIS_APP_WEBCONFIG -Raw
      $block = [regex]::Match($text, '(?s)<allowedServerVariables>(.*?)</allowedServerVariables>')
      if ($block.Success) {
        foreach ($entry in [regex]::Matches($block.Groups[1].Value, '<add name="(\w+)"')) { $own += $entry.Groups[1].Value }
      }
    }
    $layers += ,$own
  }
  return ,$layers
}
function global:Get-IisAllowed([string]$Location) {
  $names = @()
  foreach ($layer in (Get-IisAllowedLayers $Location)) {
    foreach ($name in $layer) {
      if ($names -contains $name) { throw "Stand-in IIS: cannot add duplicate collection entry '$name' (configuration error)." }
      $names += $name
    }
  }
  return $names
}
function global:Import-Module { param($Name, $ErrorAction) }
function global:Get-WebGlobalModule { param($Name, $ErrorAction) [pscustomobject]@{ Name = $Name } }
function global:Get-WebConfigurationProperty {
  param($PSPath, $Location, $Filter, $Name, $ErrorAction)
  Write-IisCall 'Get-WebConfigurationProperty' $PSBoundParameters
  if ($PSPath -ne 'MACHINE/WEBROOT/APPHOST') { throw "Stand-in IIS: unexpected -pspath '$PSPath'." }
  $wanted = [regex]::Match("$Filter", "^system\.webServer/rewrite/allowedServerVariables/add\[@name='(\w+)'\]$")
  if (-not $wanted.Success) { throw "Stand-in IIS: unexpected -filter '$Filter'." }
  try {
    $names = Get-IisAllowed "$Location"
  } catch {
    if ("$ErrorAction" -eq 'SilentlyContinue') { return }
    throw
  }
  if ($names -contains $wanted.Groups[1].Value) { return [pscustomobject]@{ Value = $wanted.Groups[1].Value } }
}
function global:Set-WebConfigurationProperty { param($PSPath, $Location, $Filter, $Name, $Value, $ErrorAction) Write-IisCall 'Set-WebConfigurationProperty' $PSBoundParameters }
function global:Add-WebConfigurationProperty {
  param($PSPath, $Location, $Filter, $Name, $Value, $ErrorAction)
  Write-IisCall 'Add-WebConfigurationProperty' $PSBoundParameters
  if ($env:ODV_IIS_DROP_ADDS -eq '1') { return }
  if ($PSPath -ne 'MACHINE/WEBROOT/APPHOST' -or -not $Location -or $Filter -ne 'system.webServer/rewrite/allowedServerVariables') {
    throw "Stand-in IIS: unexpected Add-WebConfigurationProperty target."
  }
  if ((Get-IisAllowed "$Location") -contains $Value.name) { throw "Stand-in IIS: cannot add duplicate collection entry '$($Value.name)'." }
  Add-IisFact 'allowed' "$Location" $Value.name
}
function global:New-WebAppPool { param($Name) Write-IisCall 'New-WebAppPool' $PSBoundParameters; Add-IisFact 'path' 'IIS' ('IIS:\AppPools\' + $Name) }
function global:New-WebApplication {
  param($Site, $Name, $PhysicalPath, $ApplicationPool)
  Write-IisCall 'New-WebApplication' $PSBoundParameters
  Add-IisFact 'path' 'IIS' ('IIS:\Sites\' + $Site + '\' + $Name)
}
function global:Restart-WebAppPool { param($Name) Write-IisCall 'Restart-WebAppPool' $PSBoundParameters }
function global:Set-ItemProperty { param($Path, $Name, $Value) Write-IisCall 'Set-ItemProperty' $PSBoundParameters }
function global:Test-Path {
  param($Path)
  if ("$Path" -like 'IIS:*') { return ((Get-IisFacts 'path' 'IIS') -contains "$Path") }
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
# A program started through & or . must be started through $AppCmdPath and nothing else, and no
# command may name appcmd directly. $AppCmdPath is forced to the recording stand-in below, so
# the real appcmd.exe can never run from a test.
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

$params = @{}
(Get-Content -LiteralPath $ParamsPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $params[$_.Name] = $_.Value }
if ($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'AppCmdPath' }) { $params['AppCmdPath'] = $AppCmdStub }
& $ScriptPath @params
`;

// Recording stand-in for appcmd.exe: logs its arguments and changes nothing.
const appCmdStub = String.raw`
([ordered]@{ command = 'appcmd'; arguments = @($args | ForEach-Object { "$_" }) } | ConvertTo-Json -Compress) |
  Add-Content -LiteralPath $env:ODV_IIS_CALL_LOG -Encoding Ascii
`;

/**
 * Environment for a PowerShell child. PSModulePath is left out: when the suite itself is started
 * from PowerShell 7 (the local gate), the inherited value makes Windows PowerShell load
 * PowerShell 7's modules and fail. Each edition then builds its own default.
 */
function shellEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
}

/**
 * One stand-in IIS that lives across several runs of the setup script.
 * serverAllowed / siteWebConfigAllowed: variables already allowed above the application.
 */
function createIis({ serverAllowed = [], siteWebConfigAllowed = [], dropAdds = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-iis-setup-'));
  const harnessPath = path.join(dir, 'harness.ps1');
  const appCmdStubPath = path.join(dir, 'appcmd-stand-in.ps1');
  const paramsPath = path.join(dir, 'params.json');
  const logPath = path.join(dir, 'calls.jsonl');
  const statePath = path.join(dir, 'state.tsv');
  const physicalPath = path.join(dir, 'site');
  const configPath = path.join(physicalPath, 'web.config');
  fs.writeFileSync(harnessPath, harness, 'ascii');
  fs.writeFileSync(appCmdStubPath, appCmdStub, 'ascii');
  fs.writeFileSync(statePath, '', 'ascii');

  const stored = () => fs.readFileSync(statePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'));
  const webConfig = () => (fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '');
  const ownAllowed = () => {
    const block = /<allowedServerVariables>([\s\S]*?)<\/allowedServerVariables>/.exec(webConfig());
    return block ? [...block[1].matchAll(/<add name="(\w+)"/g)].map((match) => match[1]) : [];
  };

  return {
    /** Run the setup script once. shell: 'powershell.exe' (Windows PowerShell 5.1) or 'pwsh'. */
    run(params = {}, { shell = 'powershell.exe' } = {}) {
      fs.writeFileSync(paramsPath, JSON.stringify({ SiteName: SITE, AppPath: APP, PhysicalPath: physicalPath, ...params }), 'ascii');
      fs.writeFileSync(logPath, '', 'ascii');
      return new Promise((resolve) => {
        execFile(
          shell,
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', harnessPath, '-ScriptPath', script, '-ParamsPath', paramsPath,
            '-LogPath', logPath, '-AppCmdStub', appCmdStubPath],
          {
            encoding: 'utf8',
            timeout: 90_000,
            windowsHide: true,
            env: {
              ...shellEnvironment(),
              NO_COLOR: '1',
              TERM: 'dumb',
              ODV_IIS_STATE: statePath,
              ODV_IIS_APP_LOCATION: LOCATION,
              ODV_IIS_APP_WEBCONFIG: configPath,
              ODV_IIS_SERVER_ALLOWED: serverAllowed.join(','),
              ODV_IIS_SITE_WEBCONFIG_ALLOWED: siteWebConfigAllowed.join(','),
              ODV_IIS_DROP_ADDS: dropAdds ? '1' : '',
            },
          },
          (error, stdout, stderr) => {
            const calls = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
            resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, output: stdout + stderr, calls, webConfig: webConfig() });
          },
        );
      });
    },
    webConfig,
    physicalPathExists: () => fs.existsSync(physicalPath),
    /** Variables stored for the application's location in the stand-in applicationHost.config. */
    locationAllowed: () => stored().filter(([kind, key]) => kind === 'allowed' && key === LOCATION).map((fact) => fact[2]),
    /** The merged list IIS would use for the application, and the names declared more than once. */
    effective() {
      const all = [...serverAllowed, ...this.locationAllowed(), ...siteWebConfigAllowed, ...ownAllowed()];
      return { names: [...new Set(all)].sort(), duplicates: all.filter((name, index) => all.indexOf(name) !== index) };
    },
    /** Put the stand-in in the state an earlier version of the script left behind. */
    seed({ webConfigText, location = [] }) {
      fs.mkdirSync(physicalPath, { recursive: true });
      fs.writeFileSync(configPath, webConfigText, 'utf8');
      for (const name of location) fs.appendFileSync(statePath, `allowed\t${LOCATION}\t${name}\r\n`, 'ascii');
    },
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

async function withIis(options, body) {
  const iis = createIis(options);
  try {
    return await body(iis);
  } finally {
    iis.dispose();
  }
}

const writes = (calls) => calls.filter((call) => /^(Set|Add)-WebConfigurationProperty$/.test(call.command));
const ruleBlock = (webConfig, name) => {
  const match = new RegExp(`<rule name="${name}"[\\s\\S]*?</rule>`).exec(webConfig);
  return match ? match[0] : '';
};
const rewriteMaps = (webConfig) => /<rewriteMaps>[\s\S]*?<\/rewriteMaps>/.exec(webConfig)?.[0] ?? '';
const sets = (rule) => [...rule.matchAll(/<set name="(\w+)" value="([^"]*)" \/>/g)].map((match) => `${match[1]}=${match[2]}`);
/** Server variables that the enabled rules of a web.config set. */
const variablesSet = (webConfig) => [...new Set(['Proxy_SystemLog', 'Proxy_UserLog']
  .map((name) => ruleBlock(webConfig, name))
  .filter((rule) => /enabled="true"/.test(rule))
  .flatMap((rule) => sets(rule).map((entry) => entry.split('=')[0])))].sort();

/** What a working proxy needs after a run: exit 0, every set variable allowed, nothing declared twice. */
function assertWorkingProxy(iis, result) {
  assert.equal(result.code, 0, result.output);
  const { names, duplicates } = iis.effective();
  assert.deepEqual(duplicates, [], `declared twice (IIS answers 500.19):\n${result.webConfig}`);
  for (const variable of variablesSet(result.webConfig)) {
    assert.ok(names.includes(variable), `${variable} is set by a rule but not allowed (IIS answers 500):\n${result.webConfig}`);
  }
}

// The setup script is for IIS and Windows PowerShell 5.1, which exist on Windows only. A machine
// whose execution policy does not let Windows PowerShell run local scripts cannot run it either.
const windowsPowerShellPolicy = (() => {
  if (process.platform !== 'win32') return 'not Windows';
  try {
    return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Get-ExecutionPolicy'],
      { encoding: 'utf8', windowsHide: true, timeout: 60_000, env: shellEnvironment() }).trim();
  } catch {
    return 'unavailable';
  }
})();
const canRunSetup = ['RemoteSigned', 'Unrestricted', 'Bypass'].includes(windowsPowerShellPolicy);
if (!canRunSetup) console.warn(`[setup-iis-odvproxy] setup runs skipped: Windows PowerShell policy is "${windowsPowerShellPolicy}".`);

describe.skipIf(!canRunSetup)('Setup-IIS-ODVProxy.ps1', () => {
  test('changes nothing for the whole server except turning the ARR proxy on, with and without -ForwardClientHeaders', async () => {
    for (const params of [{}, { ForwardClientHeaders: true }]) {
      await withIis({}, async (iis) => {
        const result = await iis.run(params);
        assertWorkingProxy(iis, result);
        assert.deepEqual(
          writes(result.calls).filter((call) => !call.location).map((call) => [call.pspath, call.filter, call.name, call.value]),
          [['MACHINE/WEBROOT/APPHOST', 'system.webServer/proxy', 'enabled', 'True']],
          result.output,
        );
        assert.equal(writes(result.calls).some((call) => /preserveHostHeader/i.test(String(call.name))), false);
        // No program is started: the allowedServerVariables section is never unlocked.
        assert.deepEqual(result.calls.filter((call) => call.command === 'appcmd'), []);
      });
    }
  }, 240_000);

  test('by default forwards only the public host on the user-log rule and allows it for the application only', async () => {
    await withIis({}, async (iis) => {
      const result = await iis.run({});
      assertWorkingProxy(iis, result);
      assert.deepEqual(
        writes(result.calls).filter((call) => call.location).map((call) => [call.command, call.pspath, call.location, call.filter, call.value?.name]),
        [['Add-WebConfigurationProperty', 'MACHINE/WEBROOT/APPHOST', LOCATION, SECTION, HOST]],
        result.output,
      );
      assert.deepEqual(sets(ruleBlock(result.webConfig, 'Proxy_UserLog')), [`${HOST}={HTTP_HOST}`]);
      assert.doesNotMatch(ruleBlock(result.webConfig, 'Proxy_SystemLog'), /serverVariables/);
      assert.doesNotMatch(result.webConfig, /__[A-Z][A-Z_]*__/);
      assert.doesNotMatch(result.webConfig, /X_FORWARDED_(FOR|PROTO)|rewriteMaps|<allowedServerVariables>/);
    });
  }, 120_000);

  test('with -ForwardClientHeaders both rules forward the client headers, before the action', async () => {
    await withIis({}, async (iis) => {
      const result = await iis.run({ ForwardClientHeaders: true });
      assertWorkingProxy(iis, result);
      assert.doesNotMatch(result.webConfig, /__[A-Z][A-Z_]*__/);
      for (const name of ['Proxy_SystemLog', 'Proxy_UserLog']) {
        const rule = ruleBlock(result.webConfig, name);
        assert.equal(rule.match(/<serverVariables>/g)?.length, 1, rule);
        assert.ok(rule.indexOf('</serverVariables>') < rule.indexOf('<action '), rule);
        assert.deepEqual(sets(rule).sort(), [`${FOR}={REMOTE_ADDR}`, `${HOST}={HTTP_HOST}`, `${PROTO}={OdvProxyScheme:{HTTPS}}`]);
      }
      assert.match(result.webConfig, /<rewriteMap name="OdvProxyScheme" defaultValue="http">/);
      // The variables are allowed for the application's location, never in its own web.config.
      assert.doesNotMatch(result.webConfig, /<allowedServerVariables>/);
      assert.deepEqual(iis.locationAllowed().sort(), [FOR, HOST, PROTO]);
    });
  }, 120_000);

  test('is idempotent: three runs in a row give the same web.config and a working proxy every time', async () => {
    for (const params of [{ ForwardClientHeaders: true }, {}]) {
      await withIis({}, async (iis) => {
        const first = await iis.run(params);
        assertWorkingProxy(iis, first);
        const allowedAfterFirst = iis.locationAllowed();
        for (const label of ['second', 'third']) {
          const again = await iis.run(params);
          assertWorkingProxy(iis, again);
          // The rules with their serverVariables blocks, and the rewrite map, part by part ...
          for (const name of ['Proxy_SystemLog', 'Proxy_UserLog', 'Landing']) {
            assert.equal(ruleBlock(again.webConfig, name), ruleBlock(first.webConfig, name), `${label} run changed rule ${name}`);
          }
          assert.equal(rewriteMaps(again.webConfig), rewriteMaps(first.webConfig), `${label} run changed the rewrite map`);
          assert.deepEqual(variablesSet(again.webConfig), variablesSet(first.webConfig));
          // ... and the whole file, byte for byte.
          assert.equal(again.webConfig, first.webConfig, `${label} run changed web.config`);
          assert.deepEqual(iis.locationAllowed(), allowedAfterFirst, `${label} run changed the allow list`);
          assert.deepEqual(writes(again.calls).filter((call) => call.location), [], `${label} run wrote to the allow list again`);
        }
      });
    }
  }, 480_000);

  test('switching -ForwardClientHeaders on and off leaves the right rules and a working proxy each time', async () => {
    await withIis({}, async (iis) => {
      const off = await iis.run({});
      assertWorkingProxy(iis, off);
      const on = await iis.run({ ForwardClientHeaders: true });
      assertWorkingProxy(iis, on);
      assert.deepEqual(variablesSet(on.webConfig), [FOR, HOST, PROTO]);
      const offAgain = await iis.run({});
      assertWorkingProxy(iis, offAgain);
      assert.equal(offAgain.webConfig, off.webConfig);
      assert.deepEqual(variablesSet(offAgain.webConfig), [HOST]);
      const onAgain = await iis.run({ ForwardClientHeaders: true });
      assertWorkingProxy(iis, onAgain);
      assert.equal(onAgain.webConfig, on.webConfig);
    });
  }, 480_000);

  test('repairs what earlier versions left behind', async () => {
    const earlier = (allowedSection) => fs.readFileSync(template, 'utf8')
      .replace('<!--__ALLOWED_SERVER_VARIABLES__-->', allowedSection)
      .replace('<!--__USER_LOG_CLIENT_HEADERS__-->', `<set name="${FOR}" value="{REMOTE_ADDR}" />`);
    const section = `<allowedServerVariables><add name="${FOR}" /><add name="${PROTO}" /></allowedServerVariables>`;
    // The variables in the application's own web.config (first run of the previous version), and
    // the same file written without them (its second run, where both rules answered 500).
    for (const webConfigText of [earlier(section), earlier('')]) {
      await withIis({}, async (iis) => {
        iis.seed({ webConfigText, location: [HOST] });
        const result = await iis.run({ ForwardClientHeaders: true });
        assertWorkingProxy(iis, result);
        assert.doesNotMatch(result.webConfig, /<allowedServerVariables>/);
        assert.deepEqual(iis.locationAllowed().sort(), [FOR, HOST, PROTO]);
      });
    }
  }, 240_000);

  test('never repeats a variable that the server or the site already allows', async () => {
    await withIis({ serverAllowed: [FOR], siteWebConfigAllowed: [HOST] }, async (iis) => {
      for (let run = 0; run < 2; run += 1) {
        const result = await iis.run({ ForwardClientHeaders: true });
        assertWorkingProxy(iis, result);
        assert.deepEqual(iis.locationAllowed(), [PROTO]);
      }
    });
    await withIis({ serverAllowed: [FOR, PROTO, HOST] }, async (iis) => {
      const result = await iis.run({ ForwardClientHeaders: true });
      assertWorkingProxy(iis, result);
      assert.deepEqual(writes(result.calls).filter((call) => call.location), []);
    });
  }, 360_000);

  test('allows only what the enabled rules set', async () => {
    await withIis({}, async (iis) => {
      const result = await iis.run({ EnableUserLog: false });
      assertWorkingProxy(iis, result);
      assert.deepEqual(writes(result.calls).filter((call) => call.location), []);
      assert.match(ruleBlock(result.webConfig, 'Proxy_UserLog'), /enabled="false"/);
    });
    await withIis({}, async (iis) => {
      const result = await iis.run({ EnableUserLog: false, ForwardClientHeaders: true });
      assertWorkingProxy(iis, result);
      assert.deepEqual(iis.locationAllowed().sort(), [FOR, HOST, PROTO]);
    });
  }, 240_000);

  test('ends with an error when a variable that a rule sets is not allowed afterwards', async () => {
    await withIis({ dropAdds: true }, async (iis) => {
      const result = await iis.run({ ForwardClientHeaders: true });
      assert.notEqual(result.code, 0, result.output);
      assert.match(result.output, /not allowed/);
      for (const variable of [FOR, PROTO, HOST]) assert.match(result.output, new RegExp(variable));
      assert.match(result.output, /500/);
      assert.doesNotMatch(result.output, /Deployment complete/);
    });
  }, 120_000);

  test('warns when the user-log upstream is not a loopback address', async () => {
    await withIis({}, async (iis) => {
      const remote = await iis.run({ UserLogUrl: 'http://logs.example:3002/userlog/record' });
      assert.equal(remote.code, 0, remote.output);
      assert.match(remote.output, /is not a loopback address/);
      for (const url of ['http://localhost:3002/userlog/record', 'http://127.0.0.1:3002/userlog/record', 'http://[::1]:3002/userlog/record']) {
        const local = await iis.run({ UserLogUrl: url });
        assert.equal(local.code, 0, local.output);
        assert.doesNotMatch(local.output, /is not a loopback address/);
      }
    });
  }, 480_000);

  test('refuses to start in PowerShell 7, before it has changed anything', async () => {
    await withIis({}, async (iis) => {
      const result = await iis.run({ ForwardClientHeaders: true }, { shell: 'pwsh' });
      assert.notEqual(result.code, 0, result.output);
      // The message names the PowerShell that is required.
      assert.match(result.output, /#requires/i);
      assert.match(result.output, /edition/i);
      assert.match(result.output, /Desktop/);
      // Nothing was called: no IIS read or write, no program, and no file or folder was created.
      assert.deepEqual(result.calls, []);
      assert.equal(result.webConfig, '');
      assert.equal(iis.physicalPathExists(), false);
      assert.deepEqual(iis.locationAllowed(), []);
      assert.doesNotMatch(result.output, /ARR proxying is enabled|Wrote web\.config|Deployment complete/);
    });
  }, 120_000);
});

test('the setup script requires Windows PowerShell before its first statement', () => {
  const text = fs.readFileSync(script, 'utf8');
  const requirement = text.search(/^#requires -PSEdition Desktop\s*$/mi);
  assert.ok(requirement > 0, 'no "#requires -PSEdition Desktop" line');
  assert.ok(requirement < text.indexOf('[CmdletBinding('), 'the requirement comes after the first statement');
});

test('the proxy template forwards the public host on the user-log rule only', () => {
  const text = fs.readFileSync(template, 'utf8');
  assert.match(ruleBlock(text, 'Proxy_UserLog'), /<set name="HTTP_X_FORWARDED_HOST" value="\{HTTP_HOST\}" \/>/);
  assert.doesNotMatch(ruleBlock(text, 'Proxy_SystemLog'), /HTTP_X_FORWARDED_HOST/);
  // Every placeholder is a comment or an attribute value, so none can end up as raw text.
  assert.doesNotMatch(text.replace(/<!--[\s\S]*?-->/g, '').replace(/"[^"]*"/g, '""'), /__[A-Z][A-Z_]*__/);
});
