import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import { validateAgentDocsExclusions } from './validate-agent-docs-exclusions.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../jsdoc.json', import.meta.url), 'utf8'));

test('the repository exclusions accept both native path representations', () => {
  assert.doesNotThrow(() => validateAgentDocsExclusions(config));
});

for (const directory of ['node_modules', 'docs', '__tests__']) {
  test(`rejects the legacy slash-only ${directory} exclusion`, () => {
    const legacy = structuredClone(config);
    legacy.source.excludePattern = legacy.source.excludePattern.replace(`${directory}[/\\\\]`, `${directory}/`);
    assert.notEqual(legacy.source.excludePattern, config.source.excludePattern);
    assert.throws(() => validateAgentDocsExclusions(legacy), /on both platforms/);
  });
}

test('equal but incorrect results cannot silently remove or broaden exclusions', () => {
  for (const excludePattern of ['never-match', '.*']) {
    assert.throws(() => validateAgentDocsExclusions({ source: { excludePattern } }), /on both platforms/);
  }
});

test('the filename exclusion is checked independently of excluded directories', () => {
  const missingTestFiles = structuredClone(config);
  missingTestFiles.source.excludePattern = missingTestFiles.source.excludePattern.replace('|\\.test\\.', '');
  assert.throws(() => validateAgentDocsExclusions(missingTestFiles), /example\.test\.js/);
});

test('missing and malformed patterns fail closed', () => {
  assert.throws(() => validateAgentDocsExclusions({}), /must declare/);
  assert.throws(() => validateAgentDocsExclusions({ source: { excludePattern: '[' } }), SyntaxError);
});
