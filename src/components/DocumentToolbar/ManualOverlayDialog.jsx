// File: src/components/DocumentToolbar/ManualOverlayDialog.jsx
/**
 * Manual overlay that loads simple external HTML fragments from the public help folder.
 *
 * This keeps customer-specific manual text and linked assets out of the compiled React bundle.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import DOMPurify from 'dompurify';
import { useTranslation } from 'react-i18next';
import { getRuntimeConfig } from '../../utils/runtimeConfig.js';
import {
  buildManualCandidates,
  buildManualLanguageCandidates,
  DEFAULT_FALLBACK_MANUAL_TEMPLATE,
  interpolateManualTemplate,
  resolveManualSource,
  resolveManualSourceMode,
} from '../../utils/manualSources.js';
import { filterStandardManual } from '../../utils/standardManual.js';
import {
  buildManualContentsTree,
  countManualMatchesPerSection,
  findManualSectionId,
} from '../../utils/manualContentsTree.js';

const MANUAL_REFRESH_QUERY_KEY = 'odvManualRefresh';
const MANUAL_FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

// Static loader keys let Vite create one lazy chunk per generated language without executing any
// script contained in the source HTML. Only these two generated modules exist; other UI languages
// follow help.manual.fallbackLanguage exactly as the fetched source path does.
const STANDARD_MANUAL_LOADERS = Object.freeze({
  sv: () => import('../../generated/standard-manual/manual.sv.js'),
  en: () => import('../../generated/standard-manual/manual.en.js'),
});

/**
 * @param {string} candidate
 * @returns {string} Absolute URL used to resolve manual-relative images and other assets.
 */
function absoluteManualUrl(candidate) {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : undefined;
    return new URL(String(candidate || ''), base).toString();
  } catch {
    return String(candidate || '');
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
 * @returns {Promise<({candidate: string, url: string, html: string, sourceType: string}|null)>}
 */
async function loadStandardManual({ language, manualConfig, fetchCandidate }) {
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
        url: absoluteManualUrl(candidate),
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
 * @returns {Promise<({candidate: string, url: string, html: string, sourceType: string}|null)>}
 */
async function loadAutoManual({ language, manualConfig, fetchCandidate }) {
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
 * Minimum query length before the manual search runs. Single characters match
 * almost every paragraph and only add noise to the highlight pass.
 */
const MANUAL_SEARCH_MIN_LENGTH = 2;

/**
 * Debounce delay before a typed query is applied to the rendered manual text.
 */
const MANUAL_SEARCH_DEBOUNCE_MS = 200;

/**
 * Name of the shared CSS Custom Highlight covering every manual search hit.
 */
const MANUAL_SEARCH_HIGHLIGHT_NAME = 'odv-manual-search';

/**
 * Name of the CSS Custom Highlight covering only the current manual search hit.
 */
const MANUAL_SEARCH_CURRENT_HIGHLIGHT_NAME = 'odv-manual-search-current';

/**
 * Attribute marking fallback `<mark>` wrappers with their hit index. Only marks
 * carrying it belong to the search; `<mark>` elements authored in the manual
 * itself stay searchable and are never unwrapped.
 */
const MANUAL_SEARCH_MARK_ATTRIBUTE = 'data-odv-manual-mark';

/**
 * Build a case-folding function that lowers one character through the UI
 * locale, so Swedish characters such as å/ä/ö fold correctly instead of by raw
 * code units. An invalid language tag falls back to locale-independent
 * lowering.
 *
 * @param {string} language BCP-47 language tag, e.g. `sv`.
 * @returns {function(string): string}
 */
function createManualSearchFolder(language) {
  let locale = language || undefined;
  try {
    'a'.toLocaleLowerCase(locale);
  } catch {
    locale = undefined;
  }
  const cache = new Map();
  return (character) => {
    let folded = cache.get(character);
    if (folded === undefined) {
      try {
        folded = character.toLocaleLowerCase(locale);
      } catch {
        folded = character.toLowerCase();
      }
      cache.set(character, folded);
    }
    return folded;
  };
}

/**
 * Case-fold text one code point at a time and keep, for every folded code
 * unit, the original code-unit range of the character it came from.
 *
 * Lower-casing can change the length (U+0130 "İ" becomes "i" + U+0307), so an
 * offset found in the folded string is not an offset in the original text.
 * The index map translates every hit back to the original text node, which is
 * what ranges and `<mark>` wrappers need. Folding the query the same way keeps
 * both sides on identical rules, including context-free handling of
 * characters such as the Greek final sigma.
 *
 * @param {string} text
 * @param {function(string): string} fold
 * @returns {{folded: string, sourceStart: Array<number>, sourceEnd: Array<number>, foldedStartAt: Array<number>}}
 *   `sourceStart`/`sourceEnd` are indexed by folded code unit; `foldedStartAt`
 *   is indexed by original character-start offset (and `text.length`).
 */
function foldManualSearchText(text, fold) {
  let folded = '';
  const sourceStart = [];
  const sourceEnd = [];
  const foldedStartAt = [];
  let offset = 0;
  for (const character of text) {
    const end = offset + character.length;
    const lowered = fold(character);
    foldedStartAt[offset] = folded.length;
    for (let unit = 0; unit < lowered.length; unit += 1) {
      sourceStart.push(offset);
      sourceEnd.push(end);
    }
    folded += lowered;
    offset = end;
  }
  foldedStartAt[offset] = folded.length;
  return { folded, sourceStart, sourceEnd, foldedStartAt };
}

/**
 * Find every non-overlapping occurrence of the query in the rendered manual
 * text. Script/style content and the search's own leftover marks never match.
 * Returned offsets always refer to the original text node value.
 *
 * @param {Element} root Rendered manual container.
 * @param {string} query Already trimmed search text.
 * @param {string} language BCP-47 language tag used for case folding.
 * @returns {Array<{node: Text, start: number, end: number}>}
 */
function collectManualTextMatches(root, query, language) {
  const matches = [];
  if (!root || typeof query !== 'string') return matches;
  const fold = createManualSearchFolder(language);
  const foldedQuery = foldManualSearchText(query, fold).folded;
  if (!foldedQuery) return matches;
  const doc = root.ownerDocument || document;
  const showText = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
  const filterAccept = typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_ACCEPT : 1;
  const filterReject = typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_REJECT : 2;
  const walker = doc.createTreeWalker(root, showText, {
    acceptNode(node) {
      if (!node || typeof node.nodeValue !== 'string' || !node.nodeValue) return filterReject;
      const parent = node.parentElement;
      if (!parent || !root.contains(parent)) return filterReject;
      const tagName = String(parent.tagName || '').toUpperCase();
      if (tagName === 'SCRIPT' || tagName === 'STYLE') return filterReject;
      if (tagName === 'MARK' && parent.hasAttribute(MANUAL_SEARCH_MARK_ATTRIBUTE)) return filterReject;
      return filterAccept;
    },
  });
  let current = walker.nextNode();
  while (current) {
    const { folded, sourceStart, sourceEnd, foldedStartAt } = foldManualSearchText(current.nodeValue, fold);
    let fromIndex = 0;
    for (;;) {
      const found = folded.indexOf(foldedQuery, fromIndex);
      if (found < 0) break;
      const start = sourceStart[found];
      const end = sourceEnd[found + foldedQuery.length - 1];
      matches.push({ node: current, start, end });
      // Continue after the last original character of the hit, so a hit that
      // ends inside a multi-unit folding never overlaps the next one.
      fromIndex = foldedStartAt[end];
    }
    current = walker.nextNode();
  }
  return matches;
}

/**
 * @returns {boolean} True when the CSS Custom Highlight API can be used.
 */
function canUseCustomHighlight() {
  try {
    return typeof CSS !== 'undefined' && !!CSS.highlights
      && typeof Range !== 'undefined' && typeof Highlight !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Highlight every match through the CSS Custom Highlight API without touching
 * the manual DOM at all.
 *
 * Only matches that produced a range are returned, so the caller's counter and
 * `ranges[index]` always describe the same hit.
 *
 * @param {Array<{node: Text, start: number, end: number}>} matches
 * @param {number} currentIndex
 * @returns {{matches: Array<{node: Text, start: number, end: number}>, setCurrent: function(number): void, cleanup: function(): void}}
 */
function applyCustomHighlight(matches, currentIndex) {
  const ranges = [];
  const kept = [];
  matches.forEach((match) => {
    const { node, start, end } = match;
    try {
      const range = (node.ownerDocument || document).createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      ranges.push(range);
      kept.push(match);
    } catch {
      // Skip matches whose text node changed under us.
    }
  });
  const setCurrent = (index) => {
    try {
      if (ranges[index]) {
        CSS.highlights.set(MANUAL_SEARCH_CURRENT_HIGHLIGHT_NAME, new Highlight(ranges[index]));
      } else {
        CSS.highlights.delete(MANUAL_SEARCH_CURRENT_HIGHLIGHT_NAME);
      }
    } catch {
      // The registry write failed; the shared highlight below still marks every hit.
    }
  };
  try {
    CSS.highlights.set(MANUAL_SEARCH_HIGHLIGHT_NAME, new Highlight(...ranges));
  } catch {
    // Registry write failed; the fallback path is picked on the next search.
  }
  setCurrent(currentIndex);
  return {
    matches: kept,
    setCurrent,
    cleanup() {
      try { CSS.highlights.delete(MANUAL_SEARCH_HIGHLIGHT_NAME); } catch { /* ignore */ }
      try { CSS.highlights.delete(MANUAL_SEARCH_CURRENT_HIGHLIGHT_NAME); } catch { /* ignore */ }
    },
  };
}

/**
 * Fallback highlighter for browsers without the CSS Custom Highlight API:
 * wrap every match in a `<mark>` carrying its hit index. Only matches that
 * were actually wrapped are returned, and the marks are indexed in the same
 * order, so the counter and the current mark always describe the same hit.
 * Callers must pass the returned marks to {@link removeMarkFallback} when the
 * search ends.
 *
 * @param {Element} container Rendered manual container.
 * @param {Array<{node: Text, start: number, end: number}>} matches
 * @returns {{matches: Array<{node: Text, start: number, end: number}>, marks: Array<Element>}}
 */
function applyMarkFallback(container, matches) {
  const doc = container.ownerDocument || document;
  const created = matches.map(() => null);
  const byNode = new Map();
  matches.forEach((match, index) => {
    if (!match || !match.node || !container.contains(match.node)) return;
    if (!byNode.has(match.node)) byNode.set(match.node, []);
    byNode.get(match.node).push({ ...match, index });
  });
  byNode.forEach((entries, node) => {
    // Descending offsets keep the earlier ranges valid while text nodes split.
    entries.sort((a, b) => b.start - a.start).forEach(({ start, end, index }) => {
      try {
        const text = node.nodeValue || '';
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end) return;
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const mark = doc.createElement('mark');
        mark.className = 'odv-manual-mark';
        range.surroundContents(mark);
        created[index] = mark;
      } catch {
        // Skip matches that no longer slice cleanly after a concurrent DOM change.
      }
    });
  });
  const kept = [];
  const marks = [];
  created.forEach((mark, index) => {
    if (!mark) return;
    mark.setAttribute(MANUAL_SEARCH_MARK_ATTRIBUTE, String(marks.length));
    marks.push(mark);
    kept.push(matches[index]);
  });
  return { matches: kept, marks };
}

/**
 * @param {Array<Element>} marks Search marks in hit-index order.
 * @param {number} index Hit index shown as current.
 */
function setCurrentMark(marks, index) {
  (marks || []).forEach((mark, markIndex) => {
    if (!mark || !mark.isConnected) return;
    if (markIndex === index) {
      mark.classList.add('is-current');
    } else {
      mark.classList.remove('is-current');
    }
  });
}

/**
 * Unwrap fallback marks and merge the split text nodes back together. This
 * also runs on a subtree React has already detached (the dialog closed), so
 * it relies on each mark's parent rather than on document connection.
 *
 * @param {Array<Element>} marks
 * @param {Element} container Rendered manual container.
 */
function removeMarkFallback(marks, container) {
  (marks || []).forEach((mark) => {
    try {
      if (!mark) return;
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    } catch { /* ignore */ }
  });
  try { container?.normalize?.(); } catch { /* ignore */ }
}

/**
 * Open collapsed `<details>` ancestors of the hit and scroll it into the
 * dialog scroll container.
 *
 * @param {Element} container Rendered manual container.
 * @param {{node: Text}|null} match
 * @param {number} index Hit index to reveal.
 * @param {{useMarks: boolean, marks: (Array<Element>|null)}|null} session Active highlight session.
 */
function revealManualMatch(container, match, index, session) {
  if (!container || !match) return;
  let target = null;
  if (session && session.useMarks) {
    target = session.marks?.[index] || null;
  }
  if (!target && match.node) target = match.node.parentElement;
  if (!target || !container.contains(target)) return;
  let ancestor = target.parentElement;
  while (ancestor && ancestor !== container) {
    if (String(ancestor.tagName || '').toUpperCase() === 'DETAILS' && ancestor.open === false) {
      try { ancestor.open = true; } catch { /* ignore */ }
    }
    ancestor = ancestor.parentElement;
  }
  if (typeof target.scrollIntoView === 'function') {
    try {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      try { target.scrollIntoView(); } catch { /* ignore */ }
    }
  }
}

/**
 * Share of the content pane height, measured from its top, inside which a heading counts as the
 * start of the section being read.
 */
const MANUAL_SECTION_ACTIVE_LINE = 0.25;

/** Gap in pixels kept above a heading when the content pane scrolls to it. */
const MANUAL_SECTION_SCROLL_GAP = 8;

/**
 * Open collapsed `<details>` ancestors so a target inside them can be shown.
 *
 * @param {Element} target
 * @param {Element} container Rendered manual container.
 */
function openDetailsAncestors(target, container) {
  let ancestor = target?.parentElement || null;
  while (ancestor && ancestor !== container) {
    if (String(ancestor.tagName || '').toUpperCase() === 'DETAILS' && ancestor.open === false) {
      try { ancestor.open = true; } catch { /* ignore */ }
    }
    ancestor = ancestor.parentElement;
  }
}

/**
 * Scroll only the given pane so the target sits at its top. Unlike `scrollIntoView` this never
 * moves any other scroll container (the contents tree, the dialog or the page).
 *
 * @param {HTMLElement} pane
 * @param {Element} target
 */
function scrollPaneToTarget(pane, target) {
  if (typeof target?.getBoundingClientRect !== 'function'
    || typeof pane?.getBoundingClientRect !== 'function') return;
  const offset = target.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  pane.scrollTop = Math.max(0, pane.scrollTop + offset - MANUAL_SECTION_SCROLL_GAP);
}

/** Id of the contents tree; the narrow-window toggle points at it with aria-controls. */
const MANUAL_CONTENTS_ID = 'odv-manual-contents';

/** Id of the manual search field. */
const MANUAL_SEARCH_INPUT_ID = 'odv-manual-search-input';

/** Id of the dialog title. */
const MANUAL_TITLE_ID = 'odv-help-title';

/**
 * Ids the dialog renders around the manual. The contents tree is built before the tree itself is
 * rendered, so the heading ids it generates must avoid these explicitly.
 */
const MANUAL_DIALOG_IDS = [MANUAL_CONTENTS_ID, MANUAL_SEARCH_INPUT_ID, MANUAL_TITLE_ID];

/**
 * @param {Element} container Rendered manual container.
 * @param {string} id
 * @returns {(Element|null)} Element in the manual with that id. Scoped to the manual, so an id the
 *   viewer page also uses still resolves to the manual's own element.
 */
function findManualElementById(container, id) {
  if (!container || !id) return null;
  try {
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(id)
      : id.replace(/["\\]/g, '\\$&');
    return container.querySelector(`[id="${escaped}"]`);
  } catch {
    return null;
  }
}

/**
 * True when the element or one of its ancestors inside the manual is not rendered
 * (`display: none`). The bundled manuals use that for a script-free image lightbox: `.lb` is hidden
 * until it is the URL fragment target (`.lb:target { display: block }`), so links to it must set
 * the fragment instead of scrolling. Collapsed `<details>` content keeps its own display value and
 * is not counted as hidden; navigation opens it instead.
 *
 * @param {Element} target
 * @param {Element} container Rendered manual container.
 * @returns {boolean}
 */
function isHiddenInManual(target, container) {
  const view = target?.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return false;
  let node = target;
  while (node && node !== container) {
    if (view.getComputedStyle(node).display === 'none') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Record the scroll positions of the page and of every ancestor of `from`, so a fragment
 * navigation (which the browser may scroll for) can be undone.
 *
 * @param {(Element|null)} from Innermost element whose scroll containers are recorded.
 * @returns {function(): void} Restores the recorded positions.
 */
function captureScrollPositions(from) {
  const saved = [];
  let node = from;
  while (node) {
    saved.push([node, node.scrollLeft, node.scrollTop]);
    node = node.parentElement;
  }
  const view = from?.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  const pageX = view?.scrollX || 0;
  const pageY = view?.scrollY || 0;
  return () => {
    saved.forEach(([element, left, top]) => {
      if (element.scrollLeft !== left) element.scrollLeft = left;
      if (element.scrollTop !== top) element.scrollTop = top;
    });
    if (view && typeof view.scrollTo === 'function' && (view.scrollX !== pageX || view.scrollY !== pageY)) {
      try { view.scrollTo(pageX, pageY); } catch { /* ignore */ }
    }
  };
}

/**
 * Replace the URL fragment without adding a history entry. A fragment-only `location.replace` is a
 * same-document navigation, so `:target` follows it (`history.replaceState` would not update
 * `:target`). The viewer keeps no state of its own in the URL fragment.
 *
 * @param {string} fragment Fragment without `#`; empty leaves a bare `#`.
 */
function replaceUrlFragment(fragment) {
  try {
    const base = String(window.location.href).split('#')[0];
    window.location.replace(`${base}#${fragment ? encodeURIComponent(fragment) : ''}`);
  } catch {
    // Leave the URL as it is; the lightbox simply does not open.
  }
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {{ current:(HTMLElement|null) }} [props.returnFocusRef] Toolbar button that gets focus back
 *   when the dialog closes.
 * @returns {(React.ReactElement|null)}
 */
export default function ManualOverlayDialog({ isOpen, onClose, returnFocusRef = undefined }) {
  const { t, i18n } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const contentRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const searchInputRef = useRef(/** @type {(HTMLInputElement|null)} */ (null));
  const searchQueryRef = useRef('');
  const clearSearchRef = useRef(() => {});
  const searchSessionRef = useRef(/** @type {({matches: Array, useMarks: boolean, marks: (Array<Element>|null), setCurrent: function(number): void, cleanup: function(): void}|null)} */ (null));
  const scrollPaneRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const contentsNavRef = useRef(/** @type {(HTMLElement|null)} */ (null));
  const contentsToggleRef = useRef(/** @type {(HTMLButtonElement|null)} */ (null));
  const contentsEntriesRef = useRef(/** @type {Array<{id: string, text: string, level: number, element: Element}>} */ ([]));
  const contentsLinksRef = useRef(/** @type {Map<string, HTMLAnchorElement>} */ (new Map()));
  // Section set by a click or a search jump; it stays current until the reader scrolls the pane.
  const pinnedSectionRef = useRef(/** @type {({id: string, scrollTop: number}|null)} */ (null));
  const contentsOpenRef = useRef(false);
  const closeContentsRef = useRef(() => {});
  // URL fragment from before the manual set one for a :target lightbox; null while untouched.
  const viewerFragmentRef = useRef(/** @type {(string|null)} */ (null));
  const wasOpenRef = useRef(false);
  const [manualState, setManualState] = useState({ loading: false, error: '', html: '', resolvedUrl: '' });
  const [refreshToken, setRefreshToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [currentSearchMatch, setCurrentSearchMatch] = useState(0);
  const [contentsGroups, setContentsGroups] = useState(/** @type {Array<{id: string, text: string, element: Element, children: Array<Object>}>} */ ([]));
  const [activeSectionId, setActiveSectionId] = useState('');
  const [sectionHitCounts, setSectionHitCounts] = useState(/** @type {Map<string, number>} */ (new Map()));
  const [contentsOpen, setContentsOpen] = useState(false);

  const language = useMemo(() => {
    const raw = String(i18n?.resolvedLanguage || i18n?.language || 'en').toLowerCase();
    return raw.split('-')[0] || 'en';
  }, [i18n?.language, i18n?.resolvedLanguage]);

  const handleRefresh = useCallback(() => {
    setRefreshToken(Date.now());
  }, []);

  const clearManualSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  // Ref mirrors for the native Escape listener below, which is registered once
  // per dialog opening and must see the latest search state.
  searchQueryRef.current = searchQuery;
  clearSearchRef.current = clearManualSearch;
  contentsOpenRef.current = contentsOpen;
  closeContentsRef.current = () => {
    setContentsOpen(false);
    contentsToggleRef.current?.focus?.();
  };

  /**
   * Make the section holding `target` current and keep it current until the reader scrolls.
   * @param {(Node|null|undefined)} target
   */
  const pinSectionFor = useCallback((target) => {
    const pane = scrollPaneRef.current;
    const entries = contentsEntriesRef.current;
    if (!pane || !target || entries.length === 0) return;
    const id = findManualSectionId(entries, target) || entries[0].id;
    pinnedSectionRef.current = { id, scrollTop: pane.scrollTop };
    setActiveSectionId(id);
  }, []);

  /**
   * Set the URL fragment for a manual link whose target is styled through `:target` (the bundled
   * manuals' image lightbox), without moving the content pane, the dialog or the page behind it.
   * @param {string} id
   */
  const setManualFragment = useCallback((id) => {
    if (typeof window === 'undefined') return;
    const restoreScroll = captureScrollPositions(scrollPaneRef.current);
    if (viewerFragmentRef.current === null) {
      viewerFragmentRef.current = String(window.location.hash || '').replace(/^#/, '');
    }
    replaceUrlFragment(id);
    restoreScroll();
  }, []);

  /** Put back the URL fragment the viewer had before the manual set one. */
  const restoreViewerFragment = useCallback(() => {
    const original = viewerFragmentRef.current;
    if (original === null || typeof window === 'undefined') return;
    viewerFragmentRef.current = null;
    const restoreScroll = captureScrollPositions(scrollPaneRef.current);
    let fragment = original;
    try { fragment = decodeURIComponent(original); } catch { /* keep the raw fragment */ }
    replaceUrlFragment(fragment);
    restoreScroll();
    if (!original) {
      // Drop the bare "#" the fragment navigation left behind; :target is already cleared.
      try {
        window.history.replaceState(window.history.state, '', String(window.location.href).split('#')[0]);
      } catch { /* keep the bare "#" */ }
    }
  }, []);

  /**
   * Scroll the content pane (never the tree) to an element in the manual and focus it.
   * @param {string} id
   */
  const navigateToManualTarget = useCallback((id) => {
    const container = contentRef.current;
    const pane = scrollPaneRef.current;
    if (!container || !pane || !id) return;
    const target = findManualElementById(container, id);
    if (!target) return;
    // An open lightbox would otherwise stay on top of the section the reader asked for.
    restoreViewerFragment();
    openDetailsAncestors(target, container);
    scrollPaneToTarget(pane, target);
    pinSectionFor(target);
    setContentsOpen(false);
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    try {
      target.focus({ preventScroll: true });
    } catch {
      try { target.focus(); } catch { /* ignore */ }
    }
  }, [pinSectionFor, restoreViewerFragment]);

  const handleContentsLinkClick = useCallback((event, id) => {
    event.preventDefault();
    navigateToManualTarget(id);
  }, [navigateToManualTarget]);

  // In-text links to "#id": a rendered target (a heading, a paragraph) is scrolled to inside the
  // content pane. A target hidden until it is the URL fragment target, or no target at all (the
  // lightbox's "#lb-stang" close link), sets the fragment so the manual's :target CSS applies.
  const handleManualContentClick = useCallback((event) => {
    const container = contentRef.current;
    const link = event?.target?.closest?.('a[href]');
    if (!link || !container?.contains(link)) return;
    const href = String(link.getAttribute('href') || '').trim();
    if (!href.startsWith('#')) return;
    event.preventDefault();
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch { /* keep the raw fragment */ }
    if (!id) return;
    const target = findManualElementById(container, id);
    if (!target || isHiddenInManual(target, container)) {
      setManualFragment(id);
      return;
    }
    navigateToManualTarget(id);
  }, [navigateToManualTarget, setManualFragment]);

  const goToSearchMatch = useCallback((delta) => {
    setCurrentSearchMatch((previous) => {
      const total = searchSessionRef.current?.matches?.length || 0;
      if (total <= 0) return 0;
      return (((previous + delta) % total) + total) % total;
    });
  }, []);

  const goToNextSearchMatch = useCallback(() => goToSearchMatch(1), [goToSearchMatch]);
  const goToPreviousSearchMatch = useCallback(() => goToSearchMatch(-1), [goToSearchMatch]);

  const handleSearchKeyDown = useCallback((event) => {
    const key = String(event?.key || '');
    if (key === 'Enter') {
      event.preventDefault();
      goToSearchMatch(event?.shiftKey ? -1 : 1);
    } else if (key === 'Escape' && searchQueryRef.current) {
      // Backup for the native capture listener below: clear the query instead
      // of letting Escape close the dialog.
      event.preventDefault();
      event.stopPropagation();
      clearSearchRef.current();
    }
  }, [goToSearchMatch]);

  // Focus the dialog once per opening. A separate effect: the Escape listener below re-registers
  // whenever the parent passes a new onClose, and that must not pull focus away from the search
  // field or a manual heading the reader just navigated to.
  // On close the fragment a lightbox link set is put back and focus returns to the opener.
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      dialogRef.current?.focus?.();
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    restoreViewerFragment();
    const opener = returnFocusRef?.current;
    if (opener && typeof opener.focus === 'function' && opener.isConnected !== false) {
      opener.focus();
    }
  }, [isOpen, restoreViewerFragment, returnFocusRef]);

  // Unmounting while open must not leave a lightbox fragment in the URL either.
  useEffect(() => () => restoreViewerFragment(), [restoreViewerFragment]);

  useEffect(() => {
    if (!isOpen) return undefined;

    /** @param {KeyboardEvent} event */
    const handleEscape = (event) => {
      if (String(event?.key || '') !== 'Escape') return;
      const target = event?.target;
      if (contentsOpenRef.current) {
        // Escape closes the narrow-window contents list first; the next Escape closes the dialog.
        event.preventDefault();
        event.stopPropagation();
        closeContentsRef.current();
        return;
      }
      if (target && typeof target.closest === 'function'
        && target.closest('[data-odv-manual-search="bar"]') && searchQueryRef.current) {
        // Escape anywhere in the search row (field, clear or previous/next
        // button) clears an active query; the dialog stays open and the next
        // Escape closes it. The native capture listener runs before React
        // handlers, so stop here to keep the backdrop handler from closing
        // the dialog.
        event.preventDefault();
        event.stopPropagation();
        clearSearchRef.current();
        // The clear button unmounts with the query; keep keyboard focus in
        // the search row instead of dropping it to the document body.
        if (target !== searchInputRef.current) searchInputRef.current?.focus?.();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    };

    document.addEventListener('keydown', handleEscape, true);
    window.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('keydown', handleEscape, true);
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setManualState({ loading: true, error: '', html: '', resolvedUrl: '' });

    const showManualNotAvailable = () => {
      if (cancelled) return;
      setManualState({
        loading: false,
        error: t('help.manualNotAvailable', { defaultValue: 'No manual file could be loaded for this language.' }),
        html: '',
        resolvedUrl: '',
      });
    };

    const load = async () => {
      try {
        const runtimeConfig = getRuntimeConfig();
        const manualConfig = runtimeConfig?.help?.manual;
        const sourceMode = resolveManualSourceMode(manualConfig);
        const fetchCandidate = (candidate) => fetch(appendManualRefreshToken(candidate, refreshToken), {
          cache: refreshToken ? 'reload' : 'no-store',
          credentials: 'same-origin',
          signal: controller?.signal,
          headers: { Accept: 'text/html, text/plain;q=0.9, */*;q=0.1' },
        });

        const source = await (sourceMode === 'standard'
          ? loadStandardManual({ language, manualConfig, fetchCandidate })
          : loadAutoManual({ language, manualConfig, fetchCandidate })
        );
        if (cancelled) return;

        if (source) {
          const resolvedUrl = removeManualRefreshToken(source.url) || source.candidate;
          // Only actual site-owned HTML bypasses capability filtering. Generated and emergency
          // standard HTML carry standard provenance even though their URL templates are arbitrary.
          const html = source.sourceType === 'site'
            ? source.html
            : filterStandardManual(source.html, runtimeConfig);
          setManualState({
            loading: false,
            error: '',
            html: rewriteManualHtml(html, resolvedUrl),
            resolvedUrl,
          });
          return;
        }

        showManualNotAvailable();
      } catch {
        // Cleanup aborts the active request when the dialog closes or the language changes. Any
        // other failure must settle visibly instead of leaving a permanent loading placeholder.
        if (cancelled || controller?.signal?.aborted) return;
        showManualNotAvailable();
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller?.abort?.();
    };
  }, [isOpen, language, refreshToken, t]);

  useEffect(() => {
    if (isOpen) return undefined;
    searchSessionRef.current = null;
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setSearchMatchCount(0);
    setCurrentSearchMatch(0);
    setContentsOpen(false);
    return undefined;
  }, [isOpen]);

  // Build the contents tree from the mounted, sanitised manual before the browser paints, so the
  // column appears together with the text. A manual without h2/h3 gets no column at all.
  useLayoutEffect(() => {
    const tree = isOpen && manualState.html
      ? buildManualContentsTree(contentRef.current, { reservedIds: MANUAL_DIALOG_IDS })
      : { entries: [], groups: [] };
    contentsEntriesRef.current = tree.entries;
    pinnedSectionRef.current = null;
    setContentsGroups(tree.groups);
    setActiveSectionId(tree.entries[0]?.id || '');
    if (tree.entries.length === 0) setContentsOpen(false);
  }, [manualState.html, isOpen]);

  // Track the section being read: the last heading above the active line of the content pane.
  // The observer only signals that a heading crossed that line; the position check reads layout
  // once per animation frame and never writes to it.
  useEffect(() => {
    const pane = scrollPaneRef.current;
    const entries = contentsEntriesRef.current;
    if (!isOpen || !pane || entries.length === 0 || typeof IntersectionObserver === 'undefined') return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const pinned = pinnedSectionRef.current;
      if (pinned && Math.abs(pane.scrollTop - pinned.scrollTop) < 2) {
        setActiveSectionId(pinned.id);
        return;
      }
      pinnedSectionRef.current = null;
      const paneBox = pane.getBoundingClientRect();
      const line = paneBox.top + pane.clientHeight * MANUAL_SECTION_ACTIVE_LINE;
      let active = entries[0].id;
      for (const entry of entries) {
        const box = entry.element.getBoundingClientRect();
        // Headings inside a collapsed <details> have no box; skip them.
        if (box.width === 0 && box.height === 0) continue;
        if (box.top > line) break;
        active = entry.id;
      }
      setActiveSectionId(active);
    };
    const schedule = () => {
      if (frame) return;
      frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(update) : setTimeout(update, 16);
    };
    const bottomMargin = Math.round((1 - MANUAL_SECTION_ACTIVE_LINE) * 100);
    const observer = new IntersectionObserver(schedule, {
      root: pane,
      rootMargin: `0px 0px -${bottomMargin}% 0px`,
      threshold: [0, 1],
    });
    entries.forEach((entry) => observer.observe(entry.element));
    return () => {
      observer.disconnect();
      if (frame) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        clearTimeout(frame);
      }
    };
  }, [contentsGroups, isOpen]);

  // Keep the current entry visible inside the tree without moving the content pane.
  useEffect(() => {
    const nav = contentsNavRef.current;
    const link = contentsLinksRef.current.get(activeSectionId);
    if (!nav || !link || nav.scrollHeight <= nav.clientHeight) return;
    const navBox = nav.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();
    if (linkBox.top < navBox.top) {
      nav.scrollTop -= navBox.top - linkBox.top + MANUAL_SECTION_SCROLL_GAP;
    } else if (linkBox.bottom > navBox.bottom) {
      nav.scrollTop += linkBox.bottom - navBox.bottom + MANUAL_SECTION_SCROLL_GAP;
    }
  }, [activeSectionId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const trimmed = searchQuery.trim();
    if (trimmed.length < MANUAL_SEARCH_MIN_LENGTH) {
      setDebouncedSearchQuery('');
      return undefined;
    }
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(trimmed);
    }, MANUAL_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen]);

  useEffect(() => {
    const container = contentRef.current;
    searchSessionRef.current = null;
    if (!container || !isOpen || debouncedSearchQuery.length < MANUAL_SEARCH_MIN_LENGTH) {
      setSearchMatchCount(0);
      setCurrentSearchMatch(0);
      return undefined;
    }
    const found = collectManualTextMatches(container, debouncedSearchQuery, language);
    setCurrentSearchMatch(0);
    if (found.length === 0) {
      setSearchMatchCount(0);
      setSectionHitCounts(new Map());
      return undefined;
    }
    let session;
    if (canUseCustomHighlight()) {
      const applied = applyCustomHighlight(found, 0);
      session = {
        matches: applied.matches,
        useMarks: false,
        marks: null,
        setCurrent: applied.setCurrent,
        cleanup: applied.cleanup,
      };
    } else {
      const { matches, marks } = applyMarkFallback(container, found);
      setCurrentMark(marks, 0);
      session = {
        matches,
        useMarks: true,
        marks,
        setCurrent: (index) => setCurrentMark(marks, index),
        cleanup: () => removeMarkFallback(marks, container),
      };
    }
    // Count only hits that are actually highlighted, so "N of M" never
    // includes a hit the user cannot see.
    setSearchMatchCount(session.matches.length);
    setSectionHitCounts(countManualMatchesPerSection(contentsEntriesRef.current, session.matches));
    searchSessionRef.current = session;
    revealManualMatch(container, session.matches[0], 0, session);
    pinSectionFor(session.matches[0]?.node);
    return () => {
      if (searchSessionRef.current === session) searchSessionRef.current = null;
      session.cleanup();
      setSectionHitCounts(new Map());
    };
  }, [debouncedSearchQuery, manualState.html, language, isOpen, pinSectionFor]);

  useEffect(() => {
    const session = searchSessionRef.current;
    const container = contentRef.current;
    if (!session || !container || !isOpen || session.matches.length === 0) return;
    const total = session.matches.length;
    const clamped = ((currentSearchMatch % total) + total) % total;
    session.setCurrent(clamped);
    revealManualMatch(container, session.matches[clamped], clamped, session);
    pinSectionFor(session.matches[clamped]?.node);
  }, [currentSearchMatch, isOpen, pinSectionFor]);

  const searchStatusText = useMemo(() => {
    if (debouncedSearchQuery.length < MANUAL_SEARCH_MIN_LENGTH) return '';
    if (searchMatchCount <= 0) {
      return t('help.searchNoMatches', { defaultValue: 'No matches' });
    }
    const current = Math.min(currentSearchMatch + 1, searchMatchCount);
    return t('help.searchMatchCount', {
      current,
      total: searchMatchCount,
      defaultValue: `${current} of ${searchMatchCount}`,
    });
  }, [debouncedSearchQuery, searchMatchCount, currentSearchMatch, t]);

  /** Keep forward and reverse Tab navigation inside the open modal dialog. */
  const handleManualTabTrap = (event) => {
    if (String(event?.key || '') !== 'Tab') return;
    const dialogNode = dialogRef.current;
    if (!dialogNode) return;
    const focusable = Array.from(dialogNode.querySelectorAll(MANUAL_FOCUSABLE_SELECTOR))
      .filter((element) => {
        // :disabled includes inherited fieldset disability and preserves the first-legend exception.
        if (element.matches(':disabled') || element.tabIndex < 0
          || element.closest('[hidden], [aria-hidden="true"]')) return false;
        // Browser layout excludes display:none, collapsed-details and visibility-hidden targets.
        // jsdom has no checkVisibility; its attribute-based fallback above preserves the unit fixture.
        return typeof element.checkVisibility !== 'function'
          || element.checkVisibility({ checkVisibilityCSS: true });
      })
      .map((element, domOrder) => ({ element, domOrder, tabIndex: element.tabIndex }))
      .sort((a, b) => {
        // Sequential focus navigation visits positive values in ascending order before zero and
        // default targets. DOM order breaks ties within each group, including custom manual HTML.
        if (a.tabIndex > 0 && b.tabIndex > 0 && a.tabIndex !== b.tabIndex) return a.tabIndex - b.tabIndex;
        if ((a.tabIndex > 0) !== (b.tabIndex > 0)) return a.tabIndex > 0 ? -1 : 1;
        return a.domOrder - b.domOrder;
      })
      .map(({ element }) => element);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogNode.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const outside = active === dialogNode || !dialogNode.contains(active);
    const activeIndex = focusable.indexOf(active);
    if (outside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (activeIndex >= 0) {
      // Move explicitly through the sequence: after a positive target the browser can otherwise
      // continue in DOM order to a zero target outside the dialog instead of the first zero here.
      // A programmatically focused tabindex=-1 heading keeps the browser's native starting point.
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      const nextIndex = (activeIndex + delta + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }
  };

  if (!isOpen) return null;

  const hasContents = contentsGroups.length > 0;
  /**
   * @param {{id: string, text: string}} entry
   * @param {number} level
   * @returns {React.ReactElement}
   */
  const renderContentsLink = (entry, level) => {
    const isActive = entry.id === activeSectionId;
    const hits = sectionHitCounts.get(entry.id) || 0;
    return (
      <a
        href={`#${entry.id}`}
        ref={(node) => {
          if (node) contentsLinksRef.current.set(entry.id, node);
          else contentsLinksRef.current.delete(entry.id);
        }}
        className={`odv-manual-toc-link odv-manual-toc-link--level-${level}${isActive ? ' is-active' : ''}`}
        aria-current={isActive ? 'true' : undefined}
        onClick={(event) => handleContentsLinkClick(event, entry.id)}
      >
        <span className="odv-manual-toc-text">{entry.text}</span>
        {hits > 0 ? (
          <span className="odv-manual-toc-hits">
            <span aria-hidden="true">{hits}</span>
            <span className="sr-only">
              {t('help.contentsHits', { count: hits, defaultValue: `, ${hits} matches` })}
            </span>
          </span>
        ) : null}
      </a>
    );
  };

  return (
    <div
      className="odv-help-backdrop odv-help-backdrop--manual"
      role="dialog"
      aria-modal="true"
      aria-labelledby={MANUAL_TITLE_ID}
      data-odv-shortcuts="off"
      onKeyDownCapture={(event) => {
        if (String(event?.key || '') !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className="odv-help-dialog odv-manual-dialog"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onKeyDown={handleManualTabTrap}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="odv-help-header">
          <div>
            <h2 id={MANUAL_TITLE_ID} className="odv-help-title">
              {t('help.menu.manual', { defaultValue: 'Manual' })}
            </h2>
            <p className="odv-help-subtitle">
              {manualState.resolvedUrl
                ? t('help.loadedFrom', {
                    path: manualState.resolvedUrl,
                    defaultValue: `Loaded from ${manualState.resolvedUrl}`,
                  })
                : t('help.subtitle', {
                    defaultValue: 'OpenDocViewer manual content loaded from a site-local HTML file.',
                  })}
            </p>
          </div>
          <div className="odv-help-header-actions">
            <button
              type="button"
              className="odv-help-close-icon"
              onClick={handleRefresh}
              disabled={manualState.loading}
              aria-label={t('help.refreshManual', { defaultValue: 'Reload manual from server' })}
              title={t('help.refreshManual', { defaultValue: 'Reload manual from server' })}
            >
              <span className="material-icons" aria-hidden="true">refresh</span>
            </button>
            <button
              type="button"
              className="odv-help-close-icon"
              onClick={onClose}
              aria-label={t('help.close', { defaultValue: 'Close' })}
              title={t('help.close', { defaultValue: 'Close' })}
            >
              <span className="material-icons" aria-hidden="true">close</span>
            </button>
          </div>
        </div>

        {manualState.html ? (
          <div className="odv-manual-searchbar" role="search" data-odv-manual-search="bar">
            {hasContents ? (
              <button
                ref={contentsToggleRef}
                type="button"
                className="odv-manual-toc-toggle"
                aria-expanded={contentsOpen}
                aria-controls={MANUAL_CONTENTS_ID}
                onClick={() => setContentsOpen((current) => !current)}
              >
                <span className="material-icons" aria-hidden="true">toc</span>
                <span>{t('help.contentsToggle', { defaultValue: 'Contents' })}</span>
              </button>
            ) : null}
            <label className="odv-manual-searchbar-label" htmlFor={MANUAL_SEARCH_INPUT_ID}>
              {t('help.searchManualLabel', { defaultValue: 'Search the manual' })}
            </label>
            <div className="odv-manual-searchbar-field">
              <span className="material-icons" aria-hidden="true">search</span>
              <input
                ref={searchInputRef}
                id={MANUAL_SEARCH_INPUT_ID}
                data-odv-manual-search="input"
                type="search"
                autoComplete="off"
                spellCheck={false}
                className="odv-manual-searchbar-input"
                placeholder={t('help.searchManual', { defaultValue: 'Search the manual…' })}
                aria-label={t('help.searchManualLabel', { defaultValue: 'Search the manual' })}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event?.target?.value ?? '')}
                onSearch={(event) => setSearchQuery(event?.target?.value ?? '')}
                onKeyDown={handleSearchKeyDown}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="odv-manual-searchbar-clear"
                  onClick={() => {
                    clearManualSearch();
                    searchInputRef.current?.focus?.();
                  }}
                  aria-label={t('help.searchClear', { defaultValue: 'Clear search' })}
                  title={t('help.searchClear', { defaultValue: 'Clear search' })}
                >
                  <span className="material-icons" aria-hidden="true">close</span>
                </button>
              ) : null}
            </div>
            <span className="odv-manual-searchbar-count" role="status" aria-live="polite">
              {searchStatusText}
            </span>
            <div className="odv-manual-searchbar-nav">
              <button
                type="button"
                className="odv-help-close-icon"
                onClick={goToPreviousSearchMatch}
                disabled={searchMatchCount <= 0}
                aria-label={t('help.searchPrevious', { defaultValue: 'Previous match' })}
                title={t('help.searchPrevious', { defaultValue: 'Previous match' })}
              >
                <span className="material-icons" aria-hidden="true">keyboard_arrow_up</span>
              </button>
              <button
                type="button"
                className="odv-help-close-icon"
                onClick={goToNextSearchMatch}
                disabled={searchMatchCount <= 0}
                aria-label={t('help.searchNext', { defaultValue: 'Next match' })}
                title={t('help.searchNext', { defaultValue: 'Next match' })}
              >
                <span className="material-icons" aria-hidden="true">keyboard_arrow_down</span>
              </button>
            </div>
          </div>
        ) : null}

        <div className={`odv-help-body odv-help-body-manual${hasContents ? ' has-contents' : ''}`}>
          {hasContents ? (
            <nav
              ref={contentsNavRef}
              id={MANUAL_CONTENTS_ID}
              className={`odv-manual-toc${contentsOpen ? ' is-open' : ''}`}
              aria-label={t('help.contentsLabel', { defaultValue: 'Contents of this page' })}
            >
              <ol className="odv-manual-toc-list">
                {contentsGroups.map((group) => (
                  <li key={group.id}>
                    {renderContentsLink(group, 1)}
                    {group.children.length > 0 ? (
                      <ol>
                        {group.children.map((child) => (
                          <li key={child.id}>{renderContentsLink(child, 2)}</li>
                        ))}
                      </ol>
                    ) : null}
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div
            ref={scrollPaneRef}
            className="odv-manual-scroll"
            onMouseDown={() => { if (contentsOpenRef.current) setContentsOpen(false); }}
          >
            {manualState.loading ? (
              <p className="odv-help-placeholder">
                {t('help.loading', { defaultValue: 'Loading manual…' })}
              </p>
            ) : manualState.error ? (
              <div className="odv-help-placeholder is-error">
                <p>{manualState.error}</p>
                <p>{t('help.manualPathsHint', {
                  defaultValue: 'Place a site-local HTML file under help/site/ or rely on the bundled fallback under help/default/.',
                })}</p>
              </div>
            ) : (
              <div
                ref={contentRef}
                className="odv-manual-content"
                onClick={handleManualContentClick}
                dangerouslySetInnerHTML={{ __html: manualState.html }}
              />
            )}
          </div>
        </div>

        <div className="odv-help-footer">
          <button type="button" className="odv-help-close-button" onClick={onClose}>
            {t('help.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}

ManualOverlayDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  returnFocusRef: PropTypes.shape({ current: PropTypes.any }),
};
