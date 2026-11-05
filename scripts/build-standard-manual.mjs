// File: scripts/build-standard-manual.mjs
/**
 * Converts the bundled main manual HTML into lazy-loadable JavaScript modules.
 *
 * The generated files contain no filtered or rewritten manual text. Logical rules name the actual
 * localized aliases in their standalone and embedded source documents. Generation fails when a
 * required id is absent from its own document/guide or when Swedish and English logical coverage
 * differs; a literal id intersection across languages would accept precisely the wrong contract.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const LANGUAGES = ['sv', 'en'];
const ID_ATTRIBUTE_PATTERN = /\s+id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

/**
 * @param {string} tag
 * @returns {string|null}
 */
function tagId(tag) {
  const attribute = tag.match(ID_ATTRIBUTE_PATTERN);
  return attribute ? (attribute[1] ?? attribute[2] ?? attribute[3]) : null;
}

/**
 * Extracts element ids without treating data-id attributes or plain text as manifest coverage.
 * The bundled manuals use ordinary quoted HTML attributes; unquoted attributes are accepted too.
 *
 * @param {string} html
 * @returns {Set<string>}
 */
function elementIds(html) {
  const ids = new Set();
  const attributePattern = new RegExp(ID_ATTRIBUTE_PATTERN.source, 'gi');
  for (const tag of html.matchAll(/<[^>]+>/g)) {
    for (const attribute of tag[0].matchAll(attributePattern)) {
      ids.add(attribute[1] ?? attribute[2] ?? attribute[3]);
    }
  }
  return ids;
}

/**
 * Scopes an embedded requirement to its own details element. A depth counter is required because
 * manual sections contain nested ordinary details elements before the embedded guide closes.
 *
 * @param {string} html
 * @param {string} guideId
 * @returns {string}
 */
function embeddedGuideHtml(html, guideId) {
  const tags = html.matchAll(/<\/?details\b[^>]*>/gi);
  let depth = 0;
  let start = -1;
  for (const match of tags) {
    const tag = match[0];
    const closing = tag.startsWith('</');
    if (start < 0) {
      if (closing || tagId(tag) !== guideId) continue;
      start = match.index;
      depth = 1;
      continue;
    }
    depth += closing ? -1 : 1;
    if (depth === 0) {
      return html.slice(start, match.index + tag.length);
    }
  }
  throw new Error(`embedded guide ${guideId} was not found or was not closed`);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function nonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

/**
 * Loads and validates the language/document-aware manifest interface.
 *
 * @param {string} manifestPath
 * @returns {Promise<Array<Object>>}
 */
async function loadLogicalRules(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Standard manual manifest not found: ${manifestPath}. `
      + 'Expected src/utils/standardManualRules.js to export standardManualLogicalRules.',
    );
  }

  const { mtimeMs } = await stat(manifestPath);
  let manifest;
  try {
    manifest = await import(`${pathToFileURL(manifestPath).href}?mtime=${mtimeMs}`);
  } catch (error) {
    throw new Error(`Could not load standard manual manifest ${manifestPath}: ${error.message}`, { cause: error });
  }

  const logicalRules = manifest.standardManualLogicalRules;
  if (!Array.isArray(logicalRules) || logicalRules.length === 0) {
    throw new Error(`${manifestPath} must export standardManualLogicalRules as a non-empty array.`);
  }
  const logicalIds = new Set();
  for (const rule of logicalRules) {
    if (!nonEmptyString(rule?.id) || !nonEmptyString(rule?.state) || logicalIds.has(rule.id)) {
      throw new Error(`${manifestPath} has a missing or duplicate logical rule id/state.`);
    }
    logicalIds.add(rule.id);
    for (const language of LANGUAGES) {
      const documents = rule.documents?.[language];
      if (!Array.isArray(documents) || documents.length === 0) {
        throw new Error(`${manifestPath} logical rule ${rule.id} has no ${language} documents.`);
      }
      for (const document of documents) {
        const validFile = nonEmptyString(document?.file)
          && document.file === path.basename(document.file)
          && !document.file.includes('/')
          && !document.file.includes('\\')
          && document.file.endsWith(`.${language}.html`);
        if (!validFile || !nonEmptyString(document?.id)
          || (document.guide !== undefined && !nonEmptyString(document.guide))) {
          throw new Error(`${manifestPath} logical rule ${rule.id} has an invalid ${language} document entry.`);
        }
      }
    }
  }
  return logicalRules;
}

/**
 * @param {Object} rule
 * @param {string} language
 * @returns {Array<string>}
 */
function coverageSlots(rule, language) {
  return rule.documents[language].map((document) => (
    `${document.file.replace(`.${language}.html`, '.<language>.html')}#${document.guide || ''}`
  )).sort();
}

/**
 * Requires the same logical standalone/embedded slots in both languages. Localized ids themselves
 * deliberately differ and are checked later against their own source HTML.
 *
 * @param {Array<Object>} logicalRules
 */
function validateLogicalCoverage(logicalRules) {
  for (const rule of logicalRules) {
    const swedish = coverageSlots(rule, 'sv');
    const english = coverageSlots(rule, 'en');
    if (JSON.stringify(swedish) === JSON.stringify(english)) continue;
    throw new Error(
      `Standard manual logical rule coverage mismatch for ${rule.id}.\n`
      + `  sv: ${swedish.join(', ')}\n  en: ${english.join(', ')}`,
    );
  }
}

/**
 * @param {Array<Object>} logicalRules
 * @param {string} sourceDir
 * @returns {Promise<Map<string, { sourcePath: string, html: string }>>}
 */
async function readRequiredSources(logicalRules, sourceDir) {
  const files = new Set(LANGUAGES.map((language) => `manual.${language}.html`));
  for (const rule of logicalRules) {
    for (const language of LANGUAGES) {
      for (const document of rule.documents[language]) files.add(document.file);
    }
  }
  const entries = await Promise.all([...files].sort().map(async (file) => {
    const sourcePath = path.join(sourceDir, file);
    return [file, { sourcePath, html: await readFile(sourcePath, 'utf8') }];
  }));
  return new Map(entries);
}

/**
 * Validates every real localized id in its declared source before any output is written.
 *
 * @param {Array<Object>} logicalRules
 * @param {Map<string, { sourcePath: string, html: string }>} sources
 */
function validateRequiredIds(logicalRules, sources) {
  const missing = [];
  for (const rule of logicalRules) {
    for (const language of LANGUAGES) {
      for (const document of rule.documents[language]) {
        let html = sources.get(document.file).html;
        try {
          if (document.guide) html = embeddedGuideHtml(html, document.guide);
        } catch (error) {
          missing.push({ ...document, language, ruleId: rule.id, reason: error.message });
          continue;
        }
        if (!elementIds(html).has(document.id)) {
          missing.push({ ...document, language, ruleId: rule.id });
        }
      }
    }
  }
  if (missing.length === 0) return;

  const languageCoverage = LANGUAGES.map((language) => (
    missing.filter((document) => document.language === language).map((document) => document.id).sort().join('\0')
  ));
  const heading = new Set(languageCoverage).size > 1
    ? 'Standard manual manifest id coverage mismatch between languages.'
    : 'Standard manual required rule ids are missing from their declared sources.';
  const details = missing.map((document) => (
    `  ${document.ruleId}: ${document.file}${document.guide ? ` [${document.guide}]` : ''}: ${document.id}`
      + `${document.reason ? ` (${document.reason})` : ''}`
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

  const logicalRules = await loadLogicalRules(manifestPath);
  validateLogicalCoverage(logicalRules);
  const requiredSources = await readRequiredSources(logicalRules, sourceDir);
  validateRequiredIds(logicalRules, requiredSources);
  const sources = LANGUAGES.map((language) => ({
    language,
    ...requiredSources.get(`manual.${language}.html`),
  }));

  await mkdir(outputDir, { recursive: true });
  const outputFiles = [];
  for (const source of sources) {
    const outputPath = path.join(outputDir, `manual.${source.language}.js`);
    await writeFile(outputPath, manualModule(source.html), 'utf8');
    outputFiles.push(outputPath);
  }
  const ruleIds = [...new Set(logicalRules.flatMap((rule) => (
    LANGUAGES.flatMap((language) => rule.documents[language].map((document) => document.id))
  )))];
  return { outputFiles, ruleIds };
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
