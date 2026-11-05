// File: src/utils/manualSources.js
/**
 * Resolves which manual HTML file the help dialog shows.
 *
 * Order per language: the site-local manual under `help/site/` (owned by the deployment and kept
 * across upgrades) before the bundled default manual under `help/default/` (shipped with every
 * release). `*.sample.html` files in `help/site/` are templates and never candidates.
 *
 * A candidate only counts when the server returns the manual itself. Static hosts with an SPA
 * fallback (the IIS rewrite rule, the Vite dev server) answer a request for a missing file with the
 * application shell (`index.html`) and status 200; that response must not hide the bundled default.
 */

export const DEFAULT_SITE_MANUAL_TEMPLATE = 'help/site/manual.{{lng}}.html';
export const DEFAULT_FALLBACK_MANUAL_TEMPLATE = 'help/default/manual.{{lng}}.html';

/**
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
function toText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

/**
 * @param {string} template
 * @param {string} language
 * @returns {string}
 */
export function interpolateManualTemplate(template, language) {
  return String(template || '')
    .replace(/\{\{lng\}\}/g, language)
    .replace(/\{\{lang\}\}/g, language);
}

/**
 * Formats an invalid value for diagnostics without invoking a host object's string coercion.
 *
 * @param {*} value
 * @returns {string}
 */
function invalidSourceDescription(value) {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'function') return 'function';
  try {
    return String(value);
  } catch {
    return typeof value;
  }
}

/**
 * Resolve help.manual.source. Only an omitted property and the exact primitive strings `auto` and
 * `standard` are accepted. Every other value is diagnosed and deliberately falls back to auto so
 * an invalid value cannot unexpectedly bypass a deployment's site-owned manual.
 *
 * @param {Object=} manualConfig Runtime config `help.manual` block.
 * @param {function(string): void} [warn] Diagnostic sink, normally console.warn.
 * @returns {'auto'|'standard'}
 */
export function resolveManualSourceMode(manualConfig, warn = undefined) {
  let hasSource;
  let source;
  try {
    hasSource = manualConfig !== null && manualConfig !== undefined && 'source' in Object(manualConfig);
    if (hasSource) source = manualConfig.source;
  } catch {
    hasSource = true;
  }
  if (!hasSource) return 'auto';
  if (source === 'auto' || source === 'standard') return source;

  const message = `[OpenDocViewer] Unknown help.manual.source "${invalidSourceDescription(source)}"; using "auto".`;
  try {
    if (typeof warn === 'function') warn(message);
    else if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(message);
  } catch {
    // A host-owned diagnostic sink must not prevent the manual from opening.
  }
  return 'auto';
}

/**
 * Language preference shared by fetched and generated manuals.
 *
 * @param {string} language UI language, e.g. `sv`.
 * @param {Object=} manualConfig Runtime config `help.manual` block.
 * @returns {Array<string>} UI language followed by the distinct fallback language.
 */
export function buildManualLanguageCandidates(language, manualConfig) {
  const fallbackLanguage = toText(manualConfig?.fallbackLanguage, 'en').toLowerCase();
  const normalizedLanguage = toText(language, 'en').toLowerCase();
  const variants = [];
  [normalizedLanguage, fallbackLanguage].forEach((entry) => {
    if (!entry || variants.includes(entry)) return;
    variants.push(entry);
  });
  return variants;
}

/**
 * Candidate manual URLs in priority order: UI language before fallback language. Auto tries site
 * before default; standard never lists site-owned HTML and uses only fallbackPathTemplate.
 *
 * @param {string} language UI language, e.g. `sv`.
 * @param {Object=} manualConfig Runtime config `help.manual` block.
 * @returns {Array<string>}
 */
export function buildManualCandidates(language, manualConfig) {
  const siteTemplate = toText(manualConfig?.sitePathTemplate, DEFAULT_SITE_MANUAL_TEMPLATE);
  const fallbackTemplate = toText(manualConfig?.fallbackPathTemplate, DEFAULT_FALLBACK_MANUAL_TEMPLATE);
  const templates = resolveManualSourceMode(manualConfig, () => {}) === 'standard'
    ? [fallbackTemplate]
    : [siteTemplate, fallbackTemplate];

  const candidates = [];
  buildManualLanguageCandidates(language, manualConfig).forEach((lng) => {
    templates.forEach((template) => {
      const interpolated = interpolateManualTemplate(template, lng);
      if (!interpolated || candidates.includes(interpolated)) return;
      candidates.push(interpolated);
    });
  });

  return candidates;
}

/**
 * True when the HTML is OpenDocViewer's own application shell rather than a manual. The shell's
 * bootstrap script tag carries `data-odv-bootstrap`; the OMP package build refuses an `index.html`
 * without it, so the marker is always present in a deployed shell.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function isApplicationShellHtml(html) {
  return /<script\b[^>]*\bdata-odv-bootstrap\b/i.test(String(html || ''));
}

/**
 * @typedef {Object} ManualCandidateResponse
 * @property {boolean} ok HTTP success.
 * @property {(string|undefined)} url Final response URL after redirects.
 * @property {function(): Promise<string>} text Reads the body.
 */

/**
 * Fetch candidates in order and return the first one the server delivers as a manual.
 *
 * @param {Array<string>} candidates
 * @param {function(string): Promise<ManualCandidateResponse>} fetchCandidate Usually `fetch`.
 * @returns {Promise<({candidate: string, url: string, html: string}|null)>}
 */
export async function resolveManualSource(candidates, fetchCandidate) {
  for (const candidate of candidates) {
    try {
      const response = await fetchCandidate(candidate);
      if (!response?.ok) continue;
      const html = await response.text();
      if (isApplicationShellHtml(html)) continue;
      return { candidate, url: String(response.url || ''), html };
    } catch (error) {
      if (String(error?.name || '') === 'AbortError') throw error;
    }
  }
  return null;
}
