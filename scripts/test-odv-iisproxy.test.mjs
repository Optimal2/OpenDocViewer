// File: scripts/test-odv-iisproxy.test.mjs
/**
 * Test-ODV-IISProxy.ps1 exits 0 only when both proxy requests return HTTP 2xx, and names each
 * request by its label. Runs the script against a throwaway local HTTP server.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'Test-ODV-IISProxy.ps1');

function startServer(statusFor) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.statusCode = statusFor(req.url);
        res.end('true');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runScript(baseUrl) {
  return new Promise((resolve) => {
    execFile(
      'pwsh',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-BaseUrl', baseUrl, '-Token', 'test-token'],
      { encoding: 'utf8', timeout: 90_000, windowsHide: true, env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' } },
      (error, stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr });
      },
    );
  });
}

async function withServer(statusFor, fn) {
  const server = await startServer(statusFor);
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}/ODVProxy`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('exits 0 and labels both requests when the proxy answers 2xx', async () => {
  await withServer(() => 200, async (baseUrl) => {
    const result = await runScript(baseUrl);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /\[system-log\] .*\/ODVProxy\/log -> HTTP 200/);
    assert.match(result.stdout, /\[user-log\] .*\/ODVProxy\/userlog\/record -> HTTP 200/);
  });
}, 120_000);

test('exits 1 when one request fails', async () => {
  await withServer((url) => (url.endsWith('/userlog/record') ? 500 : 200), async (baseUrl) => {
    const result = await runScript(baseUrl);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /\[user-log\] .*-> HTTP 500/);
  });
}, 120_000);
