import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import {
  EXCLUDED_DIRECTORIES,
  EXCLUDED_FILE_PATTERNS,
  assertSeparatorAgnosticFilePattern,
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
  assert.throws(() => buildExcludePattern(EXCLUDED_DIRECTORIES, ['coverage\\\\']), /not separator-agnostic/);
});

// Each of these was (or could be) green under a "no literal / or \\\\" check while
// excluding a path on one platform only, or depending on the native path prefix.
const separatorDependentFilePatterns = [
  'coverage\\x2F',
  'coverage\\x5C',
  '\\x2Fsecret',
  '\\x5Csecret',
  '\\u002Fsecret',
  '\\57secret',
  '\\Wsecret',
  'coverage\\/',
  'secret[/]',
  'secret[\\\\]',
  'secret[/\\\\]',
  'secret[\\\\/]',
  'secret[\\x2F]',
  'secret[.-0]',
  'secret[A-z]',
  '[^/]secret',
  '^src',
  '(?<=coverage).',
  'secret)|(.',
];

test('file patterns that can tell the separators apart are rejected in any spelling', () => {
  for (const filePattern of separatorDependentFilePatterns) {
    const filePatterns = [...EXCLUDED_FILE_PATTERNS, filePattern];
    assert.throws(() => buildExcludePattern(EXCLUDED_DIRECTORIES, filePatterns), /not separator-agnostic/, filePattern);
    assert.throws(() => assertSeparatorAgnosticFilePattern(filePattern), /not separator-agnostic/, filePattern);
  }
});

test('the guard rejects a jsdoc.json built from a separator-escaping file pattern', () => {
  for (const filePattern of ['\\x2Fsecret', '\\x5Csecret']) {
    const filePatterns = [...EXCLUDED_FILE_PATTERNS, filePattern];
    const pattern = `${config.source.excludePattern.slice(0, -1)}|${filePattern})`;
    assert.throws(() => validateAgentDocsExclusions(withPattern(pattern), { filePatterns }), /not separator-agnostic/);
  }
});

test('separator-agnostic file patterns are accepted and behave identically on both platforms', () => {
  const samples = ['src/a.test.js', 'src/a.spec.js', 'src/a.min.js', 'src/Card.stories.jsx', 'src/types.d.ts', 'src/x/b.mock.js', 'src/x/b.js'];
  for (const filePattern of ['\\.test\\.', '\\.spec\\.', '\\.min\\.js$', '[A-Za-z0-9_]+\\.stories\\.', '(?:\\.d)?\\.ts$', '[^_]\\.mock\\.js$']) {
    const filePatterns = [...EXCLUDED_FILE_PATTERNS, filePattern];
    const pattern = buildExcludePattern(EXCLUDED_DIRECTORIES, filePatterns);
    assert.doesNotThrow(() => validateAgentDocsExclusions(withPattern(pattern), { filePatterns }));
    const fragment = new RegExp(filePattern);
    for (const sample of samples) {
      assert.equal(fragment.test(sample), fragment.test(sample.replaceAll('/', '\\')), `${filePattern} on ${sample}`);
    }
  }
});

// Kills the mutation that drops escapeRegExp from the directory segments: the
// declared name must match literally, not as a regular expression. "a.b" would
// silently over-exclude, "c++" would not even compile.
for (const [directory, lookalike] of [
  ['a.b', 'aXb'],
  ['c++', 'ccc'],
]) {
  test(`the declared directory ${directory} is matched literally, not as a regular expression`, () => {
    const directories = [...EXCLUDED_DIRECTORIES, directory];
    const pattern = buildExcludePattern(directories);
    assert.doesNotThrow(() => validateAgentDocsExclusions(withPattern(pattern), { directories }));
    const exclude = new RegExp(pattern);
    for (const [relativePath, expected] of [
      [`src/${directory}/x.js`, true],
      [`src/${lookalike}/x.js`, false],
    ]) {
      assert.equal(exclude.test(relativePath), expected, relativePath);
      assert.equal(exclude.test(relativePath.replaceAll('/', '\\')), expected, relativePath);
    }
  });
}

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
