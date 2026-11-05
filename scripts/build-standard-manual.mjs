// File: scripts/build-standard-manual.mjs
/**
 * Converts the bundled manual HTML into lazy-loadable JavaScript modules.
 *
 * The generated files contain no filtered manual text. The standardManualRules module supplies the
 * manifest whose rule ids are validated here; runtime filtering is outside this generator.
 * Generation deliberately fails when that manifest is absent or when either language does not
 * contain every manifest-named element id.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const LANGUAGES = ['sv', 'en'];

/**
 * Extracts element ids without treating data-id attributes or plain text as manifest coverage.
 * The bundled manuals use ordinary quoted HTML attributes; unquoted attributes are accepted too.
 *
 * @param {string} html
 * @returns {Set<string>}
 */
function elementIds(html) {
  const ids = new Set();
  const attributePattern = /\s+id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const tag of html.matchAll(/<[^>]+>/g)) {
    for (const attribute of tag[0].matchAll(attributePattern)) {
      ids.add(attribute[1] ?? attribute[2] ?? attribute[3]);
    }
  }
  return ids;
}

/**
 * Loads and validates the agreed standardManualRules interface.
 *
 * @param {string} manifestPath
 * @returns {Promise<Array<string>>}
 */
async function loadRuleIds(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Standard manual manifest not found: ${manifestPath}. `
      + 'Expected src/utils/standardManualRules.js to export standardManualRuleIds.',
    );
  }

  const { mtimeMs } = await stat(manifestPath);
  let manifest;
  try {
    manifest = await import(`${pathToFileURL(manifestPath).href}?mtime=${mtimeMs}`);
  } catch (error) {
    throw new Error(`Could not load standard manual manifest ${manifestPath}: ${error.message}`, { cause: error });
  }

  const ruleIds = manifest.standardManualRuleIds;
  if (!Array.isArray(ruleIds) || ruleIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error(`${manifestPath} must export standardManualRuleIds as a flat array of non-empty strings.`);
  }
  const uniqueIds = new Set(ruleIds);
  if (uniqueIds.size !== ruleIds.length) {
    throw new Error(`${manifestPath} exports duplicate ids in standardManualRuleIds.`);
  }
  return ruleIds;
}

/**
 * Validates every rule in both languages before any output is written.
 *
 * @param {Array<string>} ruleIds
 * @param {Array<{ language: string, sourcePath: string, html: string }>} sources
 */
function validateRuleCoverage(ruleIds, sources) {
  const coverage = sources.map((source) => {
    const ids = elementIds(source.html);
    return { ...source, missing: ruleIds.filter((id) => !ids.has(id)) };
  });
  if (coverage.every((source) => source.missing.length === 0)) return;

  const mismatch = new Set(coverage.map((source) => source.missing.join('\0'))).size > 1;
  const heading = mismatch
    ? 'Standard manual manifest id coverage mismatch between languages.'
    : 'Standard manual rule ids are missing from the source HTML.';
  const details = coverage.map((source) => (
    `  ${path.basename(source.sourcePath)}: ${source.missing.length ? source.missing.join(', ') : 'none'}`
  ));
  throw new Error(`${heading}\n${details.join('\n')}`);
}

/**
 * Uses a JavaScript string literal, not HTML escaping, so importing the module returns the exact
 * source string. U+2028/U+2029 are escaped for compatibility with every JavaScript parser.
 *
 * @param {string} html
 * @returns {string}
 */
function manualModule(html) {
  return `export default ${JSON.stringify(html).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};\n`;
}

/**
 * Generates src/generated/standard-manual/manual.<lng>.js from public/help/default.
 * Paths are injectable so tests can use self-contained fixture repositories and manifests.
 *
 * @param {Object} [options]
 * @param {string} [options.rootDir]
 * @param {string} [options.manifestPath]
 * @param {string} [options.sourceDir]
 * @param {string} [options.outputDir]
 * @returns {Promise<{ outputFiles: Array<string>, ruleIds: Array<string> }>}
 */
export async function buildStandardManual(options = {}) {
  const rootDir = path.resolve(options.rootDir || REPOSITORY_ROOT);
  const manifestPath = path.resolve(rootDir, options.manifestPath || 'src/utils/standardManualRules.js');
  const sourceDir = path.resolve(rootDir, options.sourceDir || 'public/help/default');
  const outputDir = path.resolve(rootDir, options.outputDir || 'src/generated/standard-manual');

  const ruleIds = await loadRuleIds(manifestPath);
  const sources = await Promise.all(LANGUAGES.map(async (language) => {
    const sourcePath = path.join(sourceDir, `manual.${language}.html`);
    return { language, sourcePath, html: await readFile(sourcePath, 'utf8') };
  }));
  validateRuleCoverage(ruleIds, sources);

  await mkdir(outputDir, { recursive: true });
  const outputFiles = [];
  for (const source of sources) {
    const outputPath = path.join(outputDir, `manual.${source.language}.js`);
    await writeFile(outputPath, manualModule(source.html), 'utf8');
    outputFiles.push(outputPath);
  }
  return { outputFiles, ruleIds: [...ruleIds] };
}

/**
 * @param {Array<string>} argv
 * @returns {Promise<void>}
 */
async function main(argv) {
  let rootDir = REPOSITORY_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') {
      rootDir = argv[++index];
      if (!rootDir) throw new Error('--root requires a directory path.');
    } else if (argument.startsWith('--root=')) {
      rootDir = argument.slice('--root='.length);
      if (!rootDir) throw new Error('--root requires a directory path.');
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  const { outputFiles } = await buildStandardManual({ rootDir });
  for (const outputFile of outputFiles) {
    console.log(`[build-standard-manual] generated ${path.relative(rootDir, outputFile)}`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`[build-standard-manual] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
