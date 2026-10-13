import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import {
  EXCLUDED_DIRECTORIES,
  buildExcludePattern,
  validateAgentDocsExclusions,
} from './validate-agent-docs-exclusions.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../jsdoc.json', import.meta.url), 'utf8'));
const withPattern = (excludePattern) => ({ source: { excludePattern } });

test('the repository exclusions accept both native path representations', () => {
  assert.doesNotThrow(() => validateAgentDocsExclusions(config));
});

test('the committed pattern is exactly the one derived from the declared directories', () => {
  assert.equal(config.source.excludePattern, buildExcludePattern());
});

// Both separator directions are locked: a slash-only probe loop survives the
// first family of cases, a backslash-only probe loop survives the second.
for (const directory of EXCLUDED_DIRECTORIES) {
  test(`rejects the legacy slash-only ${directory} exclusion`, () => {
    const legacy = structuredClone(config);
    legacy.source.excludePattern = legacy.source.excludePattern.replace(`${directory}[/\\\\]`, `${directory}/`);
    assert.notEqual(legacy.source.excludePattern, config.source.excludePattern);
    assert.throws(() => validateAgentDocsExclusions(legacy), /on both platforms/);
  });

  test(`rejects a backslash-only ${directory} exclusion`, () => {
    const backslashOnly = structuredClone(config);
    backslashOnly.source.excludePattern = backslashOnly.source.excludePattern.replace(`${directory}[/\\\\]`, `${directory}[\\\\]`);
    assert.notEqual(backslashOnly.source.excludePattern, config.source.excludePattern);
    assert.throws(() => validateAgentDocsExclusions(backslashOnly), /on both platforms/);
  });
}

test('a hand-written segment outside the declared directories is rejected in any separator form', () => {
  for (const segment of ['coverage/', 'coverage[\\\\]', 'coverage[/\\\\]', '(?<=coverage)[/]']) {
    const extended = config.source.excludePattern.replace('|\\.test\\.', `|${segment}|\\.test\\.`);
    assert.notEqual(extended, config.source.excludePattern);
    assert.throws(() => validateAgentDocsExclusions(withPattern(extended)), /derived from EXCLUDED_DIRECTORIES/);
  }
});

test('a newly declared directory is accepted and excluded on both platforms', () => {
  const directories = [...EXCLUDED_DIRECTORIES, 'coverage'];
  const pattern = buildExcludePattern(directories);
  assert.doesNotThrow(() => validateAgentDocsExclusions(withPattern(pattern), { directories }));
  const exclude = new RegExp(pattern);
  assert.equal(exclude.test('src/coverage/report.js'), true);
  assert.equal(exclude.test('src\\coverage\\report.js'), true);
});

test('a newly declared directory is probed even when the pattern omits it', () => {
  const directories = [...EXCLUDED_DIRECTORIES, 'coverage'];
  assert.throws(
    () => validateAgentDocsExclusions(config, { directories }),
    /must exclude "src\/coverage\/nested\/example\.js" on both platforms/,
  );
});

test('the pattern builder refuses separators in declared names and file patterns', () => {
  assert.throws(() => buildExcludePattern(['build/output']), /single, non-empty directory name/);
  assert.throws(() => buildExcludePattern(['build\\output']), /single, non-empty directory name/);
  assert.throws(() => buildExcludePattern(EXCLUDED_DIRECTORIES, ['coverage/']), /must not reference a path separator/);
  assert.throws(() => buildExcludePattern(EXCLUDED_DIRECTORIES, ['coverage\\\\']), /must not reference a path separator/);
});

test('equal but incorrect results cannot silently remove or broaden exclusions', () => {
  for (const excludePattern of ['never-match', '.*']) {
    assert.throws(() => validateAgentDocsExclusions(withPattern(excludePattern)), /on both platforms/);
  }
});

test('the filename exclusion is checked independently of excluded directories', () => {
  const missingTestFiles = structuredClone(config);
  missingTestFiles.source.excludePattern = missingTestFiles.source.excludePattern.replace('|\\.test\\.', '');
  assert.throws(() => validateAgentDocsExclusions(missingTestFiles), /example\.test\.js/);
});

test('missing and malformed patterns fail closed', () => {
  assert.throws(() => validateAgentDocsExclusions({}), /must declare/);
  assert.throws(() => validateAgentDocsExclusions(withPattern('[')), SyntaxError);
});
