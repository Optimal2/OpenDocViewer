// JSDoc sees native paths; AgentDocMap's inventory sees slash-normalized paths.
// Keep the repository's exclusion contract consistent in both representations.
// These probes cover the known exclusions, not arbitrary regex equivalence.
export function validateAgentDocsExclusions(config) {
  const pattern = config?.source?.excludePattern;
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('jsdoc.json must declare source.excludePattern.');
  }

  const exclude = new RegExp(pattern);
  const cases = [
    ['src/node_modules/dependency/index.js', true],
    ['src/docs/generated/index.js', true],
    ['src/utils/__tests__/helper.js', true],
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
}
