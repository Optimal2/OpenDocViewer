// Two consumers apply jsdoc.json's source.excludePattern, and neither tests the
// short relative path a quick check would use:
//   - JSDoc (`jsdoc -X -c jsdoc.json` inside AgentDocMap, and `npm run doc`)
//     tests the ABSOLUTE NATIVE path, so the checkout prefix is part of the
//     input: /home/runner/work/<repo>/<repo>/ on GitHub Actions, a drive and
//     user folder on Windows;
//   - AgentDocMap's file inventory tests `${relative}/`: relative, slash-
//     normalized and WITH a trailing slash.
//
// jsdoc.json is static JSON, so the pattern cannot be computed there. Instead
// the excluded directories and file-name fragments are declared here and the
// committed pattern must equal the one derived from them. That guarantees:
//   - every directory segment is the escaped name followed by [/\\], so it
//     matches "/" and "\" alike;
//   - every file-name fragment fits a small allowlist grammar (see
//     assertFilePatternGrammar) whose atoms all treat "/" and "\" alike and
//     which has no anchors: "^" depends on the native path prefix, and "$"
//     never matches before AgentDocMap's trailing slash. The grammar is
//     deliberately stricter than separator parity requires;
//   - the LAST atom of every file-name fragment is neither an UNESCAPED "."
//     nor a negated character class. A trailing unescaped "." or negated
//     class depends on what comes after the fragment, which the corpus
//     cannot enumerate and the pattern cannot anchor against: a pattern
//     ending in "." matches "example.test." on every consumer but
//     "example.test" on JSDoc and "example.test/" on AgentDocMap, an
//     asymmetry no corpus can prove beyond its cases. An escaped "\."
//     matches a LITERAL dot, which can never be "/" or "\", so it is as
//     safe as any other literal and the tail rule does not apply to it;
//   - every declared directory, every fragment's declared example file and two
//     ordinary files get the expected verdict in four representations of the
//     same file (see probeRepresentations): relative, AgentDocMap's relative +
//     "/", Linux absolute and Windows absolute, under checkout prefixes that
//     contain the usual words (home, runner, work, Users, the repository name).
// The trailing-atom rule removes the cause; the corpus catches what remains.
// It does NOT guarantee anything about checkout prefixes it does not probe: a
// fragment or directory name that equals a word of some other clone path (a
// user name, a custom folder) still excludes everything there. It also does
// not prove a fragment for file names outside the corpus: the corpus tests
// four representations of each path and the fragment must agree across all
// four. A prefix word unique to a fifth checkout (a GitHub Windows runner under
// D:\\a\\<repo>\\<repo>\\) still slips past. Today's workflows all run
// ubuntu-latest, so no CI branch needs a fifth representation today. Finally,
// an unescaped "." anywhere in the MIDDLE of a fragment can still match a
// separator in an absolute representation (e.g. ".test." on the substring
// "/.test." inside an absolute path); the leading and trailing atoms are the
// only ones the tail rule covers, and the corpus catches the middle case only
// for the four probe representations.
export const EXCLUDED_DIRECTORIES = ['node_modules', 'docs', '__tests__'];

// File-name fragments are raw regex text. Each one declares an example file
// name that it must exclude, so the probe sees the fragment's own verdict.
// The last atom must NOT be an UNESCAPED "." or a negated class: see the
// header above. An escaped "\." matches a literal dot and is not a hazard.
export const EXCLUDED_FILES = [{ pattern: '\\.test\\.', example: 'example.test.js' }];

const SEPARATOR_CLASS = '[/\\\\]';

const LINUX_CHECKOUT = '/home/runner/work/OpenDocViewer/OpenDocViewer/';
const WINDOWS_CHECKOUT = 'C:\\Users\\runner\\work\\OpenDocViewer\\OpenDocViewer\\';

// Regex syntax characters that a fragment may escape to stand for themselves.
// "/" and "\" are absent, so no escape can name a single separator (\x2F, \57,
// \u005C, ...). Separator-agnostic class escapes such as \W, \d, \w, \s, \S and
// \b are rejected too: not because they tell the separators apart, but because
// the allowlist admits nothing it does not need.
const ESCAPABLE_IN_FILE_PATTERN = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '-']);
const RANGE_KINDS = [/[a-z]/, /[A-Z]/, /[0-9]/];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The same repository file as each consumer presents it to the exclude pattern.
 *
 * @param {string} relativePath slash-separated path relative to the repository root
 * @returns {Array<[string, string]>} [representation name, path] pairs
 */
export function probeRepresentations(relativePath) {
  return [
    ['relative', relativePath],
    ['AgentDocMap relative + "/"', `${relativePath}/`],
    ['Linux absolute', `${LINUX_CHECKOUT}${relativePath}`],
    ['Windows absolute', `${WINDOWS_CHECKOUT}${relativePath.replaceAll('/', '\\')}`],
  ];
}

/**
 * Accept a file-name fragment only when it is built from atoms that match "/"
 * and "\" either both or neither: literal non-separator characters, escaped
 * syntax characters, ".", groups, alternation, quantifiers and character
 * classes of literals or same-kind ranges (a-z, A-Z, 0-9). Anchors are
 * rejected. The fragment must also compile on its own, so it cannot break out
 * of its alternation branch.
 *
 * @param {string} filePattern
 */
export function assertFilePatternGrammar(filePattern) {
  const fail = (reason) => {
    throw new Error(`Excluded file pattern "${filePattern}" does not fit the file-pattern grammar: ${reason}.`);
  };
  if (typeof filePattern !== 'string' || filePattern.length === 0) fail('it must be a non-empty string');

  const readAtom = (index) => {
    const char = filePattern[index];
    if (char === '/') fail('it must not reference a path separator');
    if (char !== '\\') return { char, next: index + 1, escaped: false };
    const escaped = filePattern[index + 1];
    if (!ESCAPABLE_IN_FILE_PATTERN.has(escaped)) {
      fail(`only regex syntax characters may be escaped, and "\\${escaped ?? ''}" is not one`);
    }
    return { char: escaped, next: index + 2, escaped: true };
  };

  let depth = 0;
  let index = 0;
  // The fragment's last atom must not depend on what comes after it: a trailing
  // "." or negated class matches a separator and can reach outside the file name
  // of a path the corpus does not probe (e.g. "src/App.jsx" vs "src/App.jsx/").
  // Track whether the final meaningful atom is "." or a negated class.
  let lastAtom = null;
  let lastAtomIsNegatedClass = false;
  while (index < filePattern.length) {
    const char = filePattern[index];
    if (char === '[') {
      const negated = filePattern[index + 1] === '^';
      index += negated ? 2 : 1;
      let members = 0;
      // Bounded by the length, so a missing "]" ends the scan instead of looping.
      while (index < filePattern.length && filePattern[index] !== ']') {
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
      if (index >= filePattern.length) fail('a character class is not terminated');
      // JavaScript reads "[]" as a class that matches nothing and "[^]" as one
      // that matches anything, separators included.
      if (members === 0) fail('a character class is empty');
      // A negated class is the last meaningful atom only when it is the final
      // class in the fragment AND the trailing quantifier (if any) is absent.
      // recordLastAtom sees the class before any trailing "*", "+" or "?".
      index += 1;
      lastAtom = null;
      lastAtomIsNegatedClass = negated;
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
    } else if (char === '$') {
      fail('"$" never matches in AgentDocMap, which tests the relative path with a trailing "/"');
    }
    const atom = readAtom(index);
    lastAtom = atom;
    lastAtomIsNegatedClass = false;
    index = atom.next;
  }
  if (depth !== 0) fail('it leaves a group open');
  if (lastAtomIsNegatedClass) {
    fail('it ends with a negated character class, which matches a separator and depends on what follows the file name');
  }
  if (lastAtom !== null && lastAtom.char === '.' && !lastAtom.escaped) {
    fail('it ends with ".", which matches a separator and depends on what follows the file name');
  }

  try {
    new RegExp(filePattern);
  } catch (error) {
    fail(`it does not compile on its own (${error.message})`);
  }
}

export function buildExcludePattern(directories = EXCLUDED_DIRECTORIES, files = EXCLUDED_FILES) {
  for (const directory of directories) {
    if (typeof directory !== 'string' || directory.length === 0 || /[/\\]/.test(directory)) {
      throw new Error(`Excluded directory "${directory}" must be a single, non-empty directory name.`);
    }
  }
  for (const { pattern: filePattern, example } of files) {
    assertFilePatternGrammar(filePattern);
    if (typeof example !== 'string' || example.length === 0 || /[/\\]/.test(example)) {
      throw new Error(`Excluded file pattern "${filePattern}" must declare an example file name without a path separator.`);
    }
  }
  const segments = directories.map((directory) => `${escapeRegExp(directory)}${SEPARATOR_CLASS}`);
  return `(${[...segments, ...files.map((file) => file.pattern)].join('|')})`;
}

export function validateAgentDocsExclusions(config, { directories = EXCLUDED_DIRECTORIES, files = EXCLUDED_FILES } = {}) {
  const pattern = config?.source?.excludePattern;
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('jsdoc.json must declare source.excludePattern.');
  }

  const derived = buildExcludePattern(directories, files);
  const exclude = new RegExp(pattern);
  const cases = [
    ...directories.map((directory) => [`src/${directory}/nested/example.js`, true]),
    ...files.map(({ example }) => [`src/utils/${example}`, true]),
    ['src/utils/example.js', false],
    ['server/example.js', false],
  ];

  for (const [relativePath, expected] of cases) {
    for (const [representation, candidate] of probeRepresentations(relativePath)) {
      if (exclude.test(candidate) !== expected) {
        throw new Error(
          `jsdoc.json source.excludePattern must ${expected ? 'exclude' : 'include'} "${relativePath}" in every representation, but not in the ${representation} form ${JSON.stringify(candidate)}. JSDoc tests absolute native paths and AgentDocMap tests "<relative>/"; use separator-agnostic directory patterns such as docs[/\\\\] and file patterns that cannot match the checkout prefix.`,
        );
      }
    }
  }

  for (const { pattern: filePattern, example } of files) {
    const fragment = new RegExp(filePattern);
    for (const [representation, candidate] of probeRepresentations(`src/utils/${example}`)) {
      if (!fragment.test(candidate)) {
        throw new Error(
          `Excluded file pattern "${filePattern}" must match its example "${example}" in every representation, but not in the ${representation} form ${JSON.stringify(candidate)}.`,
        );
      }
    }
  }

  if (pattern !== derived) {
    throw new Error(
      `jsdoc.json source.excludePattern must be derived from EXCLUDED_DIRECTORIES and EXCLUDED_FILES in scripts/validate-agent-docs-exclusions.mjs. Expected ${JSON.stringify(derived)}, found ${JSON.stringify(pattern)}. Declare new exclusions there instead of editing the pattern by hand.`,
    );
  }
}
