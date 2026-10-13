// JSDoc sees native paths; AgentDocMap's inventory sees slash-normalized paths.
// Keep the repository's exclusion contract consistent in both representations.
//
// jsdoc.json is static JSON, so source.excludePattern cannot be computed there.
// Instead the excluded directories are declared here and the committed pattern
// must equal the one derived from them. Every directory segment is emitted with
// a separator-agnostic class, so a slash-only or backslash-only segment cannot
// be added to jsdoc.json without also failing this guard.
export const EXCLUDED_DIRECTORIES = ['node_modules', 'docs', '__tests__'];

// File-name fragments are raw regex text and must not depend on path separators.
export const EXCLUDED_FILE_PATTERNS = ['\\.test\\.'];

const SEPARATOR_CLASS = '[/\\\\]';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildExcludePattern(directories = EXCLUDED_DIRECTORIES, filePatterns = EXCLUDED_FILE_PATTERNS) {
  for (const directory of directories) {
    if (typeof directory !== 'string' || directory.length === 0 || /[/\\]/.test(directory)) {
      throw new Error(`Excluded directory "${directory}" must be a single, non-empty directory name.`);
    }
  }
  for (const filePattern of filePatterns) {
    if (typeof filePattern !== 'string' || filePattern.length === 0 || filePattern.includes('/') || filePattern.includes('\\\\')) {
      throw new Error(`Excluded file pattern "${filePattern}" must not reference a path separator.`);
    }
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
