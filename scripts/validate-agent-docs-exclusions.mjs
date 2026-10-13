// JSDoc sees native paths; AgentDocMap's inventory sees slash-normalized paths.
// Keep the repository's exclusion contract consistent in both representations.
//
// jsdoc.json is static JSON, so source.excludePattern cannot be computed there.
// Instead the excluded directories are declared here and the committed pattern
// must equal the one derived from them. Every directory segment is emitted with
// a separator-agnostic class. File-name fragments stay raw regex text, so each
// one is checked against a small grammar whose atoms all treat "/" and "\"
// alike (see assertSeparatorAgnosticFilePattern). Together this guarantees that
// no slash-only or backslash-only exclusion, however it is spelled, can be added
// to jsdoc.json without also failing this guard.
export const EXCLUDED_DIRECTORIES = ['node_modules', 'docs', '__tests__'];

// File-name fragments are raw regex text and must not depend on path separators.
export const EXCLUDED_FILE_PATTERNS = ['\\.test\\.'];

const SEPARATOR_CLASS = '[/\\\\]';

// Regex syntax characters that a fragment may escape to stand for themselves.
// "/" and "\" are deliberately absent, and every other escape (\x2F, \,
// \57, \W, \1, ...) is rejected, so no escape can name a single separator.
const ESCAPABLE_IN_FILE_PATTERN = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '-']);
const RANGE_KINDS = [/[a-z]/, /[A-Z]/, /[0-9]/];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Accept a file-name fragment only when it is built from atoms that match "/"
 * and "\" either both or neither: literal non-separator characters, escaped
 * syntax characters, ".", groups, alternation, quantifiers, "$", and character
 * classes of literals or same-kind ranges (a-z, A-Z, 0-9). The fragment must
 * also compile on its own, so it cannot break out of its alternation branch.
 *
 * @param {string} filePattern
 */
export function assertSeparatorAgnosticFilePattern(filePattern) {
  const fail = (reason) => {
    throw new Error(`Excluded file pattern "${filePattern}" is not separator-agnostic: ${reason}.`);
  };
  if (typeof filePattern !== 'string' || filePattern.length === 0) fail('it must be a non-empty string');

  const readAtom = (index) => {
    const char = filePattern[index];
    if (char === '/') fail('it must not reference a path separator');
    if (char !== '\\') return { char, next: index + 1, escaped: false };
    const escaped = filePattern[index + 1];
    if (!ESCAPABLE_IN_FILE_PATTERN.has(escaped)) {
      fail(`"\\${escaped ?? ''}" may name a path separator; only regex syntax characters may be escaped`);
    }
    return { char: escaped, next: index + 2, escaped: true };
  };

  let depth = 0;
  let index = 0;
  while (index < filePattern.length) {
    const char = filePattern[index];
    if (char === '[') {
      index += filePattern[index + 1] === '^' ? 2 : 1;
      let members = 0;
      while (filePattern[index] !== ']') {
        if (index >= filePattern.length) fail('a character class is not terminated');
        const from = readAtom(index);
        index = from.next;
        if (filePattern[index] === '-' && index + 1 < filePattern.length && filePattern[index + 1] !== ']') {
          const to = readAtom(index + 1);
          const sameKind = !from.escaped && !to.escaped && RANGE_KINDS.some((kind) => kind.test(from.char) && kind.test(to.char));
          if (!sameKind) fail(`the range "${from.char}-${to.char}" may cover a path separator; use a-z, A-Z or 0-9 ranges`);
          index = to.next;
        }
        members += 1;
      }
      if (members === 0) fail('a character class is empty');
      index += 1;
      continue;
    }
    if (char === '(') {
      if (filePattern[index + 1] === '?' && filePattern[index + 2] !== ':') fail('only plain and non-capturing groups are allowed');
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) fail('it closes a group it did not open');
    } else if (char === '^') {
      fail('"^" anchors to the native path prefix, which differs per platform');
    }
    index = readAtom(index).next;
  }
  if (depth !== 0) fail('it leaves a group open');

  try {
    new RegExp(filePattern);
  } catch (error) {
    fail(`it does not compile on its own (${error.message})`);
  }
}

export function buildExcludePattern(directories = EXCLUDED_DIRECTORIES, filePatterns = EXCLUDED_FILE_PATTERNS) {
  for (const directory of directories) {
    if (typeof directory !== 'string' || directory.length === 0 || /[/\\]/.test(directory)) {
      throw new Error(`Excluded directory "${directory}" must be a single, non-empty directory name.`);
    }
  }
  for (const filePattern of filePatterns) {
    assertSeparatorAgnosticFilePattern(filePattern);
  }
  const segments = directories.map((directory) => `${escapeRegExp(directory)}${SEPARATOR_CLASS}`);
  return `(${[...segments, ...filePatterns].join('|')})`;
}

export function validateAgentDocsExclusions(
  config,
  { directories = EXCLUDED_DIRECTORIES, filePatterns = EXCLUDED_FILE_PATTERNS } = {},
) {
  const pattern = config?.source?.excludePattern;
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('jsdoc.json must declare source.excludePattern.');
  }

  const exclude = new RegExp(pattern);
  const cases = [
    ...directories.map((directory) => [`src/${directory}/nested/example.js`, true]),
    ['src/utils/example.test.js', true],
    ['src/utils/example.js', false],
    ['server/example.js', false],
  ];

  for (const [relativePath, expected] of cases) {
    for (const candidate of [relativePath, relativePath.replaceAll('/', '\\')]) {
      if (exclude.test(candidate) !== expected) {
        throw new Error(
          `jsdoc.json source.excludePattern must ${expected ? 'exclude' : 'include'} "${candidate}" on both platforms. Use separator-agnostic directory patterns such as docs[/\\\\].`,
        );
      }
    }
  }

  const derived = buildExcludePattern(directories, filePatterns);
  if (pattern !== derived) {
    throw new Error(
      `jsdoc.json source.excludePattern must be derived from EXCLUDED_DIRECTORIES in scripts/validate-agent-docs-exclusions.mjs. Expected ${JSON.stringify(derived)}, found ${JSON.stringify(pattern)}. Declare new directories there instead of editing the pattern by hand.`,
    );
  }
}
