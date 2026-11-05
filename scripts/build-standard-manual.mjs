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
const HTML_SPACES = '\t\n\f\r ';
const RAW_TEXT_ELEMENTS = new Set([
  'iframe', 'noembed', 'noframes', 'plaintext', 'script', 'style', 'textarea', 'title', 'xmp',
]);

/**
 * @param {string} character
 * @returns {boolean}
 */
function isHtmlSpace(character) {
  return Boolean(character) && HTML_SPACES.includes(character);
}

/**
 * Reads one ordinary HTML tag and its actual attributes. In particular, a `>` or tag-like example
 * inside a quoted attribute does not terminate the tag or become a new candidate element.
 * This is deliberately a tokenizer for the trusted generated manual format, not an HTML5
 * error-recovery parser for arbitrary site-owned markup.
 *
 * @param {string} html
 * @param {number} start Index of the opening `<`.
 * @returns {{ tagName: string, id: string|null, closing: boolean, selfClosing: boolean, start: number, end: number }|null}
 */
function readHtmlTag(html, start) {
  let cursor = start + 1;
  const closing = html[cursor] === '/';
  if (closing) cursor += 1;
  if (!/[A-Za-z]/.test(html[cursor] || '')) return null;
  const nameStart = cursor;
  while (cursor < html.length && !isHtmlSpace(html[cursor]) && !['/', '>'].includes(html[cursor])) cursor += 1;
  const tagName = html.slice(nameStart, cursor).toLowerCase();
  let id = null;
  let selfClosing = false;

  while (cursor < html.length) {
    while (isHtmlSpace(html[cursor])) cursor += 1;
    if (html[cursor] === '>') {
      return { tagName, id, closing, selfClosing, start, end: cursor + 1 };
    }
    if (html[cursor] === '/' && html[cursor + 1] === '>') {
      selfClosing = !closing;
      return { tagName, id, closing, selfClosing, start, end: cursor + 2 };
    }

    const attributeStart = cursor;
    while (cursor < html.length && !isHtmlSpace(html[cursor]) && !['=', '/', '>'].includes(html[cursor])) cursor += 1;
    if (cursor === attributeStart) {
      cursor += 1;
      continue;
    }
    const attributeName = html.slice(attributeStart, cursor).toLowerCase();
    while (isHtmlSpace(html[cursor])) cursor += 1;
    let value = '';
    if (html[cursor] === '=') {
      cursor += 1;
      while (isHtmlSpace(html[cursor])) cursor += 1;
      const quote = html[cursor] === '"' || html[cursor] === "'" ? html[cursor++] : '';
      const valueStart = cursor;
      if (quote) {
        while (cursor < html.length && html[cursor] !== quote) cursor += 1;
        value = html.slice(valueStart, cursor);
        if (html[cursor] === quote) cursor += 1;
      } else {
        while (cursor < html.length && !isHtmlSpace(html[cursor]) && html[cursor] !== '>') cursor += 1;
        value = html.slice(valueStart, cursor);
      }
    }
    if (!closing && attributeName === 'id' && id === null) id = value;
  }
  return null;
}

/**
 * Tokenizes actual tags while excluding comments, declarations and raw-text element bodies. Raw-text
 * scanning follows HTML's first matching end-tag rule; malformed-markup recovery is intentionally
 * outside this build validator's contract.
 *
 * @param {string} html
 * @yields {{ tagName: string, id: string|null, closing: boolean, selfClosing: boolean, start: number, end: number }}
 */
function* htmlTags(html) {
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) return;
    if (html.startsWith('<!--', start)) {
      const commentEnd = html.indexOf('-->', start + 4);
      cursor = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }
    if (html.startsWith('<!', start) || html.startsWith('<?', start)) {
      const declarationEnd = html.indexOf('>', start + 2);
      cursor = declarationEnd < 0 ? html.length : declarationEnd + 1;
      continue;
    }

    const tag = readHtmlTag(html, start);
    if (!tag) {
      cursor = start + 1;
      continue;
    }
    yield tag;
    cursor = tag.end;
    if (tag.closing || tag.selfClosing || !RAW_TEXT_ELEMENTS.has(tag.tagName)) continue;
    if (tag.tagName === 'plaintext') return;
    const closingPattern = new RegExp(`</${tag.tagName}(?=[\\t\\n\\f\\r />])[^>]*>`, 'gi');
    closingPattern.lastIndex = cursor;
    const rawTextEnd = closingPattern.exec(html);
    cursor = rawTextEnd ? rawTextEnd.index + rawTextEnd[0].length : html.length;
  }
}

/**
 * Extracts ids only from actual elements, never from examples in comments, raw text or attributes.
 *
 * @param {string} html
 * @returns {Set<string>}
 */
function elementIds(html) {
  const ids = new Set();
  for (const tag of htmlTags(html)) {
    if (!tag.closing && tag.id !== null) ids.add(tag.id);
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
  let depth = 0;
  let start = -1;
  for (const tag of htmlTags(html)) {
    if (tag.tagName !== 'details') continue;
    if (start < 0) {
      if (tag.closing || tag.id !== guideId) continue;
      start = tag.start;
      depth = 1;
      continue;
    }
    if (tag.closing) depth -= 1;
    else if (!tag.selfClosing) depth += 1;
    if (depth === 0) return html.slice(start, tag.end);
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
