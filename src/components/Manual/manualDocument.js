// File: src/components/Manual/manualDocument.js
/**
 * Manual source loading and HTML preparation shared by every manual host (the overlay dialog and a
 * full-page view). Loads site HTML, the generated standard manual or its emergency HTML fallback,
 * rewrites relative asset URLs against the resolved source and sanitises the result.
 */

import DOMPurify from 'dompurify';
import {
  buildManualCandidates,
  buildManualLanguageCandidates,
  DEFAULT_FALLBACK_MANUAL_TEMPLATE,
  interpolateManualTemplate,
  resolveManualSource,
  resolveManualSourceMode,
} from '../../utils/manualSources.js';
import { filterStandardManual } from '../../utils/standardManual.js';

const MANUAL_REFRESH_QUERY_KEY = 'odvManualRefresh';

// Static loader keys let Vite create one lazy chunk per generated language without executing any
// script contained in the source HTML. Only these two generated modules exist; other UI languages
// follow help.manual.fallbackLanguage exactly as the fetched source path does.
const STANDARD_MANUAL_LOADERS = Object.freeze({
  sv: () => import('../../generated/standard-manual/manual.sv.js'),
  en: () => import('../../generated/standard-manual/manual.en.js'),
});

/**
 * The ODV base URL relative manual paths (and the stand-alone manual page) belong to: runtime
 * config `baseHref` (set by odv.config.js from its own location), else the base src/app/bootConfig.js
 * derived at start-up (`window.__ODV_APP_BASE__`, which honours the stand-alone page's
 * `odv-app-base` meta tag), else the page's folder. In the viewer all three agree; on the
 * stand-alone manual page, one folder below the base, the page's folder is wrong.
 *
 * The base is a folder: a hierarchical result whose path lacks the trailing slash (`baseHref:
 * '/OpenDocViewer'`) gets one, so `manual/` and `help/...` resolve inside that folder instead of
 * next to it. Candidates are tried in order and the first one that parses to an http(s) or file
 * URL wins: a configured `baseHref` with a rejected scheme (`javascript:`, `data:`) or one that
 * fails to parse falls through to the boot base (on the stand-alone page, the app base its
 * `odv-app-base` meta names), then to the page's folder, so such a value never
 * reaches an href and never resolves under `/manual/`.
 *
 * @param {Object=} runtimeConfig Runtime configuration (reads `baseHref`).
 * @returns {(string|undefined)} Absolute base URL, or undefined outside a browser or when no
 *   usable base resolves.
 */
export function resolveOdvBaseUrl(runtimeConfig) {
  if (typeof window === 'undefined') return undefined;
  let baseHref;
  try { baseHref = runtimeConfig?.baseHref; } catch { baseHref = undefined; }
  let bootBase;
  try { bootBase = window.__ODV_APP_BASE__; } catch { bootBase = undefined; }
  const configured = typeof baseHref === 'string' ? baseHref.trim() : '';
  const derived = typeof bootBase === 'string' ? bootBase.trim() : '';
  for (const candidate of [configured, derived, './']) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate, window.location.href);
      if (!['http:', 'https:', 'file:'].includes(url.protocol)) continue;
      if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
      return url.toString();
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Absolute URL of the stand-alone manual page (`<ODV base>/manual/`), optionally opened at a
 * section. Built from the ODV base, so it is right whatever page the viewer runs on.
 *
 * @param {Object=} runtimeConfig Runtime configuration (reads `baseHref`).
 * @param {string=} sectionId Element id for the fragment; empty for none.
 * @returns {string}
 */
export function resolveManualPageUrl(runtimeConfig, sectionId = '') {
  const path = sectionId ? `manual/#${encodeURIComponent(sectionId)}` : 'manual/';
  const baseUrl = resolveOdvBaseUrl(runtimeConfig);
  try {
    return baseUrl ? new URL(path, baseUrl).toString() : path;
  } catch {
    return path;
  }
}

/**
 * @param {string} candidate
 * @param {(string|undefined)} baseUrl ODV base URL (resolveOdvBaseUrl).
 * @returns {string} Absolute URL used to resolve manual-relative images and other assets.
 */
function absoluteManualUrl(candidate, baseUrl) {
  try {
    const base = baseUrl || (typeof window !== 'undefined' ? window.location.href : undefined);
    return new URL(String(candidate || ''), base).toString();
  } catch {
    return String(candidate || '');
  }
}

/**
 * A relative candidate path (a default template, or a relative configured one) is fetched from the
 * ODV base. Where the base is the page's own folder (the viewer) the path is passed on unchanged.
 *
 * @param {string} candidate
 * @param {(string|undefined)} baseUrl ODV base URL (resolveOdvBaseUrl).
 * @returns {string}
 */
function candidateFromOdvBase(candidate, baseUrl) {
  if (!baseUrl || !isRewritableRelativeUrl(candidate)) return candidate;
  try {
    if (new URL('./', window.location.href).toString() === baseUrl) return candidate;
    return new URL(String(candidate), baseUrl).toString();
  } catch {
    return candidate;
  }
}

/**
 * Copy only settings used by the selected source. Host objects can have unrelated throwing getters.
 *
 * @param {Object=} manualConfig Runtime config `help.manual` block.
 * @param {'auto'|'standard'} sourceMode Resolved source mode.
 * @returns {Object} Safe internal configuration.
 */
function copyManualConfig(manualConfig, sourceMode) {
  const config = { source: sourceMode };
  const keys = ['fallbackLanguage', 'fallbackPathTemplate'];
  if (sourceMode === 'auto') keys.push('sitePathTemplate');
  for (const key of keys) {
    try {
      const value = manualConfig?.[key];
      if (value !== undefined) config[key] = value;
    } catch {
      // Use the existing default for this optional setting.
    }
  }
  return config;
}

/**
 * Load the preferred generated standard manual. A chunk failure uses fallbackPathTemplate through
 * the same response validation and abortable fetch path as auto, but still excludes every site file.
 *
 * @param {Object} options
 * @param {string} options.language
 * @param {Object=} options.manualConfig
 * @param {function(string): Promise<Object>} options.fetchCandidate
 * @param {(string|undefined)} options.baseUrl ODV base URL the generated manual's assets live under.
 * @returns {Promise<({candidate: string, url: string, html: string, sourceType: string}|null)>}
 */
async function loadStandardManual({ language, manualConfig, fetchCandidate, baseUrl }) {
  const standardConfig = copyManualConfig(manualConfig, 'standard');
  // Preserve configuration failure settlement even when a healthy generated module needs no fetch.
  const fallbackCandidates = buildManualCandidates(language, standardConfig);
  const preferredLanguage = buildManualLanguageCandidates(language, standardConfig)
    .find((entry) => typeof STANDARD_MANUAL_LOADERS[entry] === 'function');
  if (preferredLanguage) {
    try {
      const module = await STANDARD_MANUAL_LOADERS[preferredLanguage]();
      if (typeof module?.default !== 'string') throw new Error('Generated manual has no HTML string.');
      // Generated modules come from public/help/default, independently of the emergency HTML path.
      const candidate = interpolateManualTemplate(DEFAULT_FALLBACK_MANUAL_TEMPLATE, preferredLanguage);
      return {
        candidate,
        url: absoluteManualUrl(candidate, baseUrl),
        html: module.default,
        sourceType: 'standard',
      };
    } catch {
      // A missing/failed lazy chunk falls back to the configured static HTML below.
    }
  }
  const source = await resolveManualSource(fallbackCandidates, fetchCandidate);
  return source ? { ...source, sourceType: 'standard' } : null;
}

/**
 * Resolve auto mode per language: site HTML first, then generated standard content or its emergency
 * HTML fallback. Provenance is explicit because arbitrary site and fallback templates can overlap.
 *
 * @param {Object} options
 * @param {string} options.language
 * @param {Object=} options.manualConfig
 * @param {function(string): Promise<Object>} options.fetchCandidate
 * @param {(string|undefined)} options.baseUrl ODV base URL (passed on to loadStandardManual).
 * @returns {Promise<({candidate: string, url: string, html: string, sourceType: string}|null)>}
 */
async function loadAutoManual({ language, manualConfig, fetchCandidate, baseUrl }) {
  const autoConfig = copyManualConfig(manualConfig, 'auto');
  const languages = buildManualLanguageCandidates(language, autoConfig);
  for (const candidateLanguage of languages) {
    // Restrict each iteration to one language so an English chunk cannot overtake English site HTML.
    const languageConfig = { ...autoConfig, fallbackLanguage: candidateLanguage };
    const siteCandidate = buildManualCandidates(candidateLanguage, languageConfig)[0];
    const siteSource = await resolveManualSource([siteCandidate], fetchCandidate);
    if (siteSource) return { ...siteSource, sourceType: 'site' };

    const standardSource = await loadStandardManual({
      language: candidateLanguage,
      manualConfig: languageConfig,
      fetchCandidate,
      baseUrl,
    });
    if (standardSource) return standardSource;
  }
  return null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isRewritableRelativeUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (normalized.startsWith('#')) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return false;
  if (normalized.startsWith('//')) return false;
  return true;
}

/**
 * Rewrite the URL in each srcset candidate while retaining its width or density descriptor.
 * Commas inside URLs (notably data URLs) are preserved; only a comma outside a descriptor ends a
 * candidate. This mirrors the browser's tokenization instead of splitting the attribute on commas.
 *
 * @param {string} value
 * @param {string} resolvedUrl
 * @returns {string}
 */
function rewriteManualSrcset(value, resolvedUrl) {
  const input = String(value || '');
  const candidates = [];
  let position = 0;
  const isWhitespace = (character) => character === ' ' || character === '\t'
    || character === '\n' || character === '\f' || character === '\r';

  while (position < input.length) {
    while (position < input.length && (isWhitespace(input[position]) || input[position] === ',')) position += 1;
    if (position >= input.length) break;

    const urlStart = position;
    while (position < input.length && !isWhitespace(input[position])) position += 1;
    let url = input.slice(urlStart, position);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      const descriptorStart = position;
      let parentheses = 0;
      while (position < input.length) {
        const character = input[position];
        if (character === '(') parentheses += 1;
        else if (character === ')' && parentheses > 0) parentheses -= 1;
        else if (character === ',' && parentheses === 0) break;
        position += 1;
      }
      descriptor = input.slice(descriptorStart, position).trim();
      if (input[position] === ',') position += 1;
    }
    if (!url) continue;

    let rewrittenUrl = url;
    if (isRewritableRelativeUrl(url)) {
      try {
        rewrittenUrl = new URL(url, resolvedUrl).toString();
      } catch {
        // Leave this candidate as-is if URL rewriting fails.
      }
    }
    candidates.push(`${rewrittenUrl}${descriptor ? ` ${descriptor}` : ''}`);
  }
  return candidates.join(', ');
}

/**
 * @param {string} html
 * @returns {string}
 */
function sanitizeManualHtml(html) {
  return DOMPurify.sanitize(String(html || ''), {
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ADD_ATTR: ['target'],
    FORBID_ATTR: ['srcdoc'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  });
}

/**
 * @param {string} html
 * @param {string} resolvedUrl
 * @returns {string}
 */
function rewriteManualHtml(html, resolvedUrl) {
  if (typeof DOMParser === 'undefined') return sanitizeManualHtml(html);
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script').forEach((node) => node.remove());

  const urlAttributes = ['href', 'src', 'poster'];
  urlAttributes.forEach((attribute) => {
    doc.querySelectorAll(`[${attribute}]`).forEach((node) => {
      const current = node.getAttribute(attribute);
      if (!isRewritableRelativeUrl(current || '')) return;
      try {
        node.setAttribute(attribute, new URL(String(current), resolvedUrl).toString());
      } catch {
        // Leave the attribute as-is if URL rewriting fails.
      }
    });
  });

  doc.querySelectorAll('[srcset]').forEach((node) => {
    node.setAttribute('srcset', rewriteManualSrcset(node.getAttribute('srcset') || '', resolvedUrl));
  });

  doc.querySelectorAll('a[href]').forEach((node) => {
    const href = String(node.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#')) return;
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  });

  const headMarkup = doc.head
    ? Array.from(doc.head.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((node) => node.outerHTML)
      .join('')
    : '';
  const rewrittenHtml = doc.body && doc.body.innerHTML.trim()
    ? `${headMarkup}${doc.body.innerHTML}`
    : `${headMarkup}${doc.documentElement?.innerHTML || String(html || '')}`;
  return sanitizeManualHtml(rewrittenHtml);
}

/**
 * @param {string} url
 * @param {number} refreshToken
 * @returns {string}
 */
function appendManualRefreshToken(url, refreshToken) {
  if (!refreshToken) return url;
  try {
    const parsed = new URL(String(url || ''), window.location.href);
    parsed.searchParams.set(MANUAL_REFRESH_QUERY_KEY, String(refreshToken));
    return parsed.toString();
  } catch {
    const separator = String(url || '').includes('?') ? '&' : '?';
    return `${url}${separator}${MANUAL_REFRESH_QUERY_KEY}=${encodeURIComponent(String(refreshToken))}`;
  }
}

/**
 * @param {string} url
 * @returns {string}
 */
function removeManualRefreshToken(url) {
  const raw = String(url || '');
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, window.location.href);
    parsed.searchParams.delete(MANUAL_REFRESH_QUERY_KEY);
    return parsed.toString();
  } catch {
    return raw.replace(new RegExp(`([?&])${MANUAL_REFRESH_QUERY_KEY}=[^&]*&?`), '$1').replace(/[?&]$/, '');
  }
}

/**
 * Load the manual for one UI language exactly as the configured source mode prescribes, apply
 * feature filtering to standard content and return sanitised HTML ready for rendering.
 *
 * Only actual site-owned HTML bypasses capability filtering. Generated and emergency standard HTML
 * carry standard provenance even though their URL templates are arbitrary.
 *
 * @param {Object} options
 * @param {string} options.language Base UI language, e.g. `sv`.
 * @param {Object=} options.runtimeConfig Effective runtime configuration (`help.manual` and the
 *   feature switches the standard manual filter reads).
 * @param {number=} options.refreshToken Non-zero to bypass caches (the "reload manual" action).
 * @param {AbortSignal=} options.signal Aborts outstanding requests.
 * @returns {Promise<({html: string, resolvedUrl: string}|null)>} Null when no source exists for the
 *   language. Rejects on unexpected failures (and on abort).
 */
export async function loadManualDocument({ language, runtimeConfig, refreshToken = 0, signal = undefined }) {
  const manualConfig = runtimeConfig?.help?.manual;
  const sourceMode = resolveManualSourceMode(manualConfig);
  const baseUrl = resolveOdvBaseUrl(runtimeConfig);
  const fetchCandidate = (candidate) => fetch(appendManualRefreshToken(candidateFromOdvBase(candidate, baseUrl), refreshToken), {
    cache: refreshToken ? 'reload' : 'no-store',
    credentials: 'same-origin',
    signal,
    headers: { Accept: 'text/html, text/plain;q=0.9, */*;q=0.1' },
  });

  const source = await (sourceMode === 'standard'
    ? loadStandardManual({ language, manualConfig, fetchCandidate, baseUrl })
    : loadAutoManual({ language, manualConfig, fetchCandidate, baseUrl })
  );
  if (!source) return null;

  const resolvedUrl = removeManualRefreshToken(source.url) || source.candidate;
  const html = source.sourceType === 'site'
    ? source.html
    : filterStandardManual(source.html, runtimeConfig);
  return { html: rewriteManualHtml(html, resolvedUrl), resolvedUrl };
}
