// Process-local, exact-text cache around PowerShell's real AST parser.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const parserScriptPath = fileURLToPath(new URL('./parse-local-ci-ast.ps1', import.meta.url));
const MAX_BUFFER = 64 * 1024 * 1024;
const BATCH_SIZE = 16;
const violate = (detail) => assert.fail(`step-4 allowlist violation: ${detail}`);

export function createPowerShellParser({ spawn = spawnSync } = {}) {
  const cache = new Map();

  function invoke(args) {
    let lastError = null;
    for (const exe of ['pwsh', 'powershell']) {
      const res = spawn(exe, ['-NoProfile', '-File', parserScriptPath, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
      if (res.error) {
        if (res.error.code === 'ENOBUFS') violate(`PowerShell AST output exceeded the 64 MiB maxBuffer (ENOBUFS) for ${exe}: ${res.error.message}; raise maxBuffer in parsePowerShell -- this is not a missing interpreter`);
        if (res.error.code === 'ENOENT') { lastError = res.error; continue; }
        violate(`PowerShell AST parser failed to launch ${exe} (${res.error.code ?? 'unknown'}): ${res.error.message}; refusing to skip`);
      }
      assert.equal(res.status, 0, `PowerShell AST parser exited ${res.status}: ${res.stderr}`);
      return JSON.parse(res.stdout);
    }
    violate(`PowerShell (pwsh/powershell) is unavailable, so the step-4 allowlist parser cannot run (${lastError?.message ?? 'not found'}); refusing to skip`);
  }

  function validateAst(parsed) {
    assert.ok(parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.parseErrors)
      && parsed.parseErrors.every((error) => typeof error === 'string'), 'PowerShell AST response must contain nodes and parseErrors arrays');
  }

  function load(texts, batch) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-step4-ast-'));
    try {
      const files = texts.map((text, i) => {
        const file = path.join(dir, `${i}.ps1`);
        fs.writeFileSync(file, text, 'utf8');
        return file;
      });
      let results;
      if (batch) {
        const manifest = path.join(dir, 'manifest.json');
        fs.writeFileSync(manifest, JSON.stringify(files), 'utf8');
        const response = invoke(['-ManifestPath', manifest]);
        assert.deepEqual(response?.paths, files, 'PowerShell AST batch response paths must match manifest order');
        assert.ok(Array.isArray(response.results) && response.results.length === texts.length, 'PowerShell AST batch response must contain exactly one result per source');
        results = response.results;
      } else {
        results = [invoke(['-Path', files[0]])];
      }
      // Validate the whole group before caching any entry. Parse errors stay
      // intact; the existing buildTree check still refuses malformed scripts.
      results.forEach(validateAst);
      texts.forEach((text, i) => cache.set(text, results[i]));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  return {
    parse(sourceText) {
      if (!cache.has(sourceText)) load([sourceText], false);
      return cache.get(sourceText);
    },
    prewarm(sourceTexts) {
      const pending = [...new Set(sourceTexts)].filter((text) => !cache.has(text));
      for (let i = 0; i < pending.length; i += BATCH_SIZE) load(pending.slice(i, i + BATCH_SIZE), true);
    },
  };
}
