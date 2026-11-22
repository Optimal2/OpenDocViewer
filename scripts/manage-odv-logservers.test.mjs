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
