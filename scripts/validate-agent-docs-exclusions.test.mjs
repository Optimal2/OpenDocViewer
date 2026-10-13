import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'vitest';
import {
  EXCLUDED_DIRECTORIES,
  EXCLUDED_FILES,
  assertFilePatternGrammar,
  buildExcludePattern,
  probeRepresentations,
  validateAgentDocsExclusions,
} from './validate-agent-docs-exclusions.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../jsdoc.json', import.meta.url), 'utf8'));
const withPattern = (excludePattern) => ({ source: { excludePattern } });
const withFile = (pattern, example) => [...EXCLUDED_FILES, { pattern, example }];

test('the repository exclusions accept every representation', () => {
  assert.doesNotThrow(() => validateAgentDocsExclusions(config));
});

test('the committed pattern is exactly the one derived from the declarations', () => {
  assert.equal(config.source.excludePattern, buildExcludePattern());
});

test('the probe covers each consumer: relative, AgentDocMap, Linux and Windows absolute', () => {
  assert.deepEqual(probeRepresentations('src/a.js'), [
    ['relative', 'src/a.js'],
    ['AgentDocMap relative + "/"', 'src/a.js/'],
    ['Linux absolute', '/home/runner/work/OpenDocViewer/OpenDocViewer/src/a.js'],
    ['Windows absolute', 'C:\\Users\\runner\\work\\OpenDocViewer\\OpenDocViewer\\src\\a.js'],
  ]);
});

// Both separator directions are locked: a slash-only probe loop survives the
// first family of cases, a backslash-only probe loop survives the second.
for (const directory of EXCLUDED_DIRECTORIES) {
  test(`rejects the legacy slash-only ${directory} exclusion`, () => {
    const legacy = structuredClone(config);
    legacy.source.excludePattern = legacy.source.excludePattern.replace(`${directory}[/\\\\]`, `${directory}/`);
    assert.notEqual(legacy.source.excludePattern, config.source.excludePattern);
    assert.throws(() => validateAgentDocsExclusions(legacy), /in every representation, but not in the Windows absolute form/);
  });

  test(`rejects a backslash-only ${directory} exclusion`, () => {
    const backslashOnly = structuredClone(config);
    backslashOnly.source.excludePattern = backslashOnly.source.excludePattern.replace(`${directory}[/\\\\]`, `${directory}[\\\\]`);
    assert.notEqual(backslashOnly.source.excludePattern, config.source.excludePattern);
    assert.throws(() => validateAgentDocsExclusions(backslashOnly), /in every representation, but not in the relative form/);
  });
}

test('a hand-written segment outside the declared directories is rejected in any separator form', () => {
  for (const segment of ['coverage/', 'coverage[\\\\]', 'coverage[/\\\\]', '(?<=coverage)[/]']) {
    const extended = config.source.excludePattern.replace('|\\.test', `|${segment}|\\.test`);
    assert.notEqual(extended, config.source.excludePattern);
    assert.throws(() => validateAgentDocsExclusions(withPattern(extended)), /derived from EXCLUDED_DIRECTORIES/);
  }
});

test('a newly declared directory is accepted and excluded in every representation', () => {
  const directories = [...EXCLUDED_DIRECTORIES, 'coverage'];
  const pattern = buildExcludePattern(directories);
  assert.doesNotThrow(() => validateAgentDocsExclusions(withPattern(pattern), { directories }));
  const exclude = new RegExp(pattern);
  for (const [representation, candidate] of probeRepresentations('src/coverage/report.js')) {
    assert.equal(exclude.test(candidate), true, representation);
  }
});

test('a newly declared directory is probed even when the pattern omits it', () => {
  const directories = [...EXCLUDED_DIRECTORIES, 'coverage'];
  assert.throws(
    () => validateAgentDocsExclusions(config, { directories }),
    /must exclude "src\/coverage\/nested\/example\.js" in every representation/,
  );
});

test('the pattern builder refuses separators in declared names, file patterns and examples', () => {
  assert.throws(() => buildExcludePattern(['build/output']), /single, non-empty directory name/);
  assert.throws(() => buildExcludePattern(['build\\output']), /single, non-empty directory name/);
  assert.throws(() => buildExcludePattern(EXCLUDED_DIRECTORIES, withFile('coverage/', 'coverage.js')), /must not reference a path separator/);
  assert.throws(() => buildExcludePattern(EXCLUDED_DIRECTORIES, withFile('coverage\\\\', 'coverage.js')), /does not fit the file-pattern grammar/);
  for (const example of ['src/a.spec.js', 'src\\a.spec.js', '', undefined]) {
    assert.throws(() => buildExcludePattern(EXCLUDED_DIRECTORIES, withFile('\\.spec', example)), /must declare an example file name/);
  }
});

// JSDoc tests the absolute native path. A name that is an ordinary word of the
// checkout prefix passes the grammar, yet excludes every file on the runner whose
// clone path contains it, and nothing elsewhere.
test('exclusions that match the checkout prefix are rejected', () => {
  for (const word of ['runner', 'work', 'home', 'Users', 'OpenDocViewer']) {
    const files = withFile(word, `example.${word}.js`);
    const pattern = buildExcludePattern(EXCLUDED_DIRECTORIES, files);
    assert.throws(
      () => validateAgentDocsExclusions(withPattern(pattern), { files }),
      /must include "src\/utils\/example\.js" in every representation, but not in the (Linux|Windows) absolute form/,
      word,
    );
    const directories = [...EXCLUDED_DIRECTORIES, word];
    assert.throws(
      () => validateAgentDocsExclusions(withPattern(buildExcludePattern(directories)), { directories }),
      /must include "src\/utils\/example\.js" in every representation/,
      word,
    );
  }
});

// A trailing "." or negated class depends on what comes after the fragment,
// which the corpus cannot enumerate and the pattern cannot anchor against: a
// pattern ending in "." matches "example.js." on every consumer but "example.js"
// on JSDoc and "example.js/" on AgentDocMap, an asymmetry no corpus can prove
// beyond its cases. The grammar now rejects this by construction; the corpus
// still catches "." or a negated class at the LEADING edge.
test('fragments whose edges reach outside the file name are rejected', () => {
  // Trailing "." or negated class — rejected by the grammar directly.
  for (const filePattern of ['\\.jsx.', '\\.min\\.js.', '\\.test\\.', '\\.jsx[^y]', 'test[^x]']) {
    assert.throws(() => assertFilePatternGrammar(filePattern), /does not fit the file-pattern grammar/, filePattern);
    assert.throws(
      () => buildExcludePattern(EXCLUDED_DIRECTORIES, withFile(filePattern, 'example.jsx')),
      /does not fit the file-pattern grammar/,
      filePattern,
    );
  }
  // Leading "." or negated class — still caught by the corpus, not by the grammar.
  for (const [filePattern, example] of [
    ['.src', 'example.src.js'],
    ['[^x]src', 'example.src.js'],
  ]) {
    assert.doesNotThrow(() => assertFilePatternGrammar(filePattern), filePattern);
    const files = withFile(filePattern, example);
    assert.throws(
      () => validateAgentDocsExclusions(withPattern(buildExcludePattern(EXCLUDED_DIRECTORIES, files)), { files }),
      /in every representation/,
      filePattern,
    );
  }
});

test('a fragment must exclude its declared example on its own', () => {
  const files = withFile('\\.spec', 'example.test.js');
  assert.throws(
    () => validateAgentDocsExclusions(withPattern(buildExcludePattern(EXCLUDED_DIRECTORIES, files)), { files }),
    /"\\\.spec" must match its example "example\.test\.js" in every representation, but not in the relative form/,
  );
});

// AgentDocMap tests "<relative>/", where "$" never follows the file name.
test('end-anchored fragments are rejected because AgentDocMap never sees the end of the file name', () => {
  assert.equal(new RegExp('\\.min\\.js$').test('src/a.min.js'), true);
  assert.equal(new RegExp('\\.min\\.js$').test('src/a.min.js/'), false);
  for (const filePattern of ['\\.min\\.js$', '(?:\\.d)?\\.ts$', '[^_]\\.mock\\.js$', 'a$|b']) {
    assert.throws(() => assertFilePatternGrammar(filePattern), /"\$" never matches in AgentDocMap/, filePattern);
    assert.throws(() => buildExcludePattern(EXCLUDED_DIRECTORIES, withFile(filePattern, 'a.min.js')), /"\$" never matches/, filePattern);
  }
  assert.doesNotThrow(() => assertFilePatternGrammar('\\$secret'));
  assert.doesNotThrow(() => assertFilePatternGrammar('[$]secret'));
});

// The scanner must end on a missing "]" instead of looping. A hang cannot be
// preempted inside this process, so the call runs in a child with a time limit:
// a regression turns into a red test, not into a stuck doc:agent or CI run.
test('an unterminated character class fails fast with its own reason', () => {
  const patterns = ['[a', '[', '[^', 'x[a-z', '[\\.', '[a-'];
  const moduleUrl = new URL('./validate-agent-docs-exclusions.mjs', import.meta.url).href;
  const script = [
    `const { assertFilePatternGrammar } = await import(${JSON.stringify(moduleUrl)});`,
    `for (const pattern of ${JSON.stringify(patterns)}) {`,
    '  try { assertFilePatternGrammar(pattern); console.log("ACCEPTED " + pattern); }',
    '  catch (error) { console.log("REJECTED " + pattern + ": " + error.message); }',
    '}',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 60000,
    killSignal: 'SIGKILL',
  });
  assert.equal(result.signal, null, 'the grammar check did not return within 60 s');
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, patterns.length, result.stdout);
  for (const line of lines) {
    assert.match(line, /^REJECTED .*a character class is not terminated\.$/);
  }
});

// The scanner accepts these shapes; only compiling the fragment on its own
// shows that they are not regular expressions at all.
test('fragments that the scanner accepts but JavaScript cannot compile are rejected', () => {
  for (const filePattern of ['[9-0]', '[z-a]', '{2,3}', '(*)', 'a**']) {
    assert.throws(() => assertFilePatternGrammar(filePattern), /does not compile on its own/, filePattern);
  }
});

// JavaScript reads "[]" as a class that matches nothing and "[^]" as one that
// matches anything. "[]a]" is the empty class followed by "a]", not the class
// {"]", "a"} that some other regex dialects would read.
test('empty character classes are rejected', () => {
  assert.equal(new RegExp('[]a]').test('a]'), false);
  assert.equal(new RegExp('[^]').test('/'), true);
  for (const filePattern of ['[]x', '[^]x', '[]a]']) {
    assert.throws(() => assertFilePatternGrammar(filePattern), /a character class is empty/, filePattern);
  }
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
    assert.throws(() => buildExcludePattern(EXCLUDED_DIRECTORIES, withFile(filePattern, 'secret.js')), /does not fit the file-pattern grammar/, filePattern);
    assert.throws(() => assertFilePatternGrammar(filePattern), /does not fit the file-pattern grammar/, filePattern);
  }
});

// These class escapes treat "/" and "\" alike, so they are rejected for a
// different reason: the allowlist admits only escaped syntax characters. The
// strictness is deliberate; it is not a separator-parity failure.
test('separator-agnostic class escapes are rejected conservatively, not for parity', () => {
  for (const escape of ['\\W', '\\d', '\\w', '\\s', '\\S', '\\b']) {
    const atom = new RegExp(escape);
    for (const [slash, backslash] of [['/', '\\'], ['a/b', 'a\\b']]) {
      assert.equal(atom.test(slash), atom.test(backslash), `${escape} on ${slash}`);
    }
    assert.throws(() => assertFilePatternGrammar(`${escape}secret`), /only regex syntax characters may be escaped/, escape);
  }
});

test('the guard rejects a jsdoc.json built from a separator-escaping file pattern', () => {
  for (const filePattern of ['\\x2Fsecret', '\\x5Csecret']) {
    const files = withFile(filePattern, 'secret.js');
    const pattern = `${config.source.excludePattern.slice(0, -1)}|${filePattern})`;
    assert.throws(() => validateAgentDocsExclusions(withPattern(pattern), { files }), /does not fit the file-pattern grammar/);
  }
});

// None of these is anchored, so each one can only be read as "contains". That
// is the price of "$" being inert in AgentDocMap: "\.min\.js" also matches
// "a.min.json". Fragments must not end with "." or a negated class — that rule
// is verified separately — so the trailing dot has been dropped here.
test('accepted file patterns exclude their example and behave identically in every representation', () => {
  const samples = ['src/a.test.js', 'src/a.spec.js', 'src/a.min.js', 'src/Card.stories.jsx', 'src/types.d.ts', 'src/x/b.mock.js', 'src/x/b.js'];
  for (const [filePattern, example] of [
    ['\\.test', 'a.test.js'],
    ['\\.spec', 'a.spec.js'],
    ['\\.min\\.js', 'a.min.js'],
    ['[A-Za-z0-9_]+\\.stories', 'Card.stories.jsx'],
    ['(?:\\.d)?\\.ts', 'types.d.ts'],
    ['[^_]\\.mock\\.js', 'b.mock.js'],
  ]) {
    const files = withFile(filePattern, example);
    const pattern = buildExcludePattern(EXCLUDED_DIRECTORIES, files);
    assert.doesNotThrow(() => validateAgentDocsExclusions(withPattern(pattern), { files }), filePattern);
    const fragment = new RegExp(filePattern);
    for (const sample of samples) {
      const verdicts = probeRepresentations(sample).map(([, candidate]) => fragment.test(candidate));
      assert.deepEqual(verdicts, verdicts.map(() => verdicts[0]), `${filePattern} on ${sample}`);
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
      for (const [representation, candidate] of probeRepresentations(relativePath)) {
        assert.equal(exclude.test(candidate), expected, `${relativePath} (${representation})`);
      }
    }
  });
}

test('equal but incorrect results cannot silently remove or broaden exclusions', () => {
  for (const excludePattern of ['never-match', '.*']) {
    assert.throws(() => validateAgentDocsExclusions(withPattern(excludePattern)), /in every representation/);
  }
});

test('the filename exclusion is checked independently of excluded directories', () => {
  const missingTestFiles = structuredClone(config);
  missingTestFiles.source.excludePattern = missingTestFiles.source.excludePattern.replace('|\\.test', '');
  assert.throws(() => validateAgentDocsExclusions(missingTestFiles), /example\.test\.js/);
});

test('missing and malformed patterns fail closed', () => {
  assert.throws(() => validateAgentDocsExclusions({}), /must declare/);
  assert.throws(() => validateAgentDocsExclusions(withPattern('[')), SyntaxError);
});
