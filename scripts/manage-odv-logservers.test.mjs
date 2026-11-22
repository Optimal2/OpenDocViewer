// File: scripts/manage-odv-logservers.test.mjs
/**
 * Manage-ODV-LogServers.ps1 is interactive and installs Windows services, so it is read, not
 * run: the user log service must be installed with 30 days of print-record retention.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'Manage-ODV-LogServers.ps1'), 'utf8');

test('installs the user log service with 30 days of print-record retention', () => {
  assert.match(source, /^\$Script:PRINT_RETENTION_DAYS\s*=\s*30\s*$/m);
  const userEnv = /\$envUsr\s*=\s*@\{([^}]*)\}/.exec(source);
  assert.ok(userEnv, 'the user log service environment block was not found');
  assert.match(userEnv[1], /PRINT_LOG_RETENTION_DAYS\s*=\s*\$PRINT_RETENTION_DAYS/);
  assert.match(userEnv[1], /LOG_RETENTION_DAYS\s*=\s*\$RETENTION_DAYS/);
});

test('installs the user log service with strict origin as the standard', () => {
  assert.match(source, /^\$Script:STRICT_ORIGIN\s*=\s*'true'\s*$/m);
  const userEnv = /\$envUsr\s*=\s*@\{([^}]*)\}/.exec(source);
  const systemEnv = /\$envSys\s*=\s*@\{([^}]*)\}/.exec(source);
  assert.match(userEnv[1], /ODV_STRICT_ORIGIN\s*=\s*\$STRICT_ORIGIN/);
  assert.doesNotMatch(systemEnv[1], /ODV_STRICT_ORIGIN/);
});

test('installs the print log without a rate limit and the system log with 120 per minute', () => {
  assert.match(source, /^\$Script:USER_LOG_RATE_LIMIT_PER_MINUTE\s*=\s*0\s*$/m);
  assert.match(source, /^\$Script:SYSTEM_LOG_RATE_LIMIT_PER_MINUTE\s*=\s*120\s*$/m);
  const userEnv = /\$envUsr\s*=\s*@\{([^}]*)\}/.exec(source);
  const systemEnv = /\$envSys\s*=\s*@\{([^}]*)\}/.exec(source);
  assert.match(userEnv[1], /USER_LOG_RATE_LIMIT_PER_MINUTE\s*=\s*\$USER_LOG_RATE_LIMIT_PER_MINUTE/);
  assert.match(systemEnv[1], /SYSTEM_LOG_RATE_LIMIT_PER_MINUTE\s*=\s*\$SYSTEM_LOG_RATE_LIMIT_PER_MINUTE/);
});
