// File: src/components/DocumentToolbar/ManualOverlayDialog.jsx
/**
 * Manual overlay that loads simple external HTML fragments from the public help folder.
 *
 * This keeps customer-specific manual text and linked assets out of the compiled React bundle.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import DOMPurify from 'dompurify';
import { useTranslation } from 'react-i18next';
import { getRuntimeConfig } from '../../utils/runtimeConfig.js';
import { buildManualCandidates, resolveManualSource } from '../../utils/manualSources.js';

const MANUAL_REFRESH_QUERY_KEY = 'odvManualRefresh';

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
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @returns {(React.ReactElement|null)}
 */
export default function ManualOverlayDialog({ isOpen, onClose }) {
  const { t, i18n } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const contentRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const searchInputRef = useRef(/** @type {(HTMLInputElement|null)} */ (null));
  const searchQueryRef = useRef('');
  const clearSearchRef = useRef(() => {});
  const searchSessionRef = useRef(/** @type {({matches: Array, useMarks: boolean, marks: (Array<Element>|null), setCurrent: function(number): void, cleanup: function(): void}|null)} */ (null));
  const [manualState, setManualState] = useState({ loading: false, error: '', html: '', resolvedUrl: '' });
  const [refreshToken, setRefreshToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [currentSearchMatch, setCurrentSearchMatch] = useState(0);

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

  useEffect(() => {
    if (!isOpen) return undefined;
    dialogRef.current?.focus?.();

    /** @param {KeyboardEvent} event */
    const handleEscape = (event) => {
      if (String(event?.key || '') !== 'Escape') return;
      const target = event?.target;
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

    const load = async () => {
      const candidates = buildManualCandidates(language, getRuntimeConfig()?.help?.manual);
      const fetchCandidate = (candidate) => fetch(appendManualRefreshToken(candidate, refreshToken), {
        cache: refreshToken ? 'reload' : 'no-store',
        credentials: 'same-origin',
        signal: controller?.signal,
        headers: { Accept: 'text/html, text/plain;q=0.9, */*;q=0.1' },
      });

      const source = await resolveManualSource(candidates, fetchCandidate).catch(() => undefined);
      // undefined = aborted (the dialog closed or the language changed)
      if (cancelled || source === undefined) return;

      if (source) {
        const resolvedUrl = removeManualRefreshToken(source.url) || source.candidate;
        setManualState({
          loading: false,
          error: '',
          html: rewriteManualHtml(source.html, resolvedUrl),
          resolvedUrl,
        });
        return;
      }

      setManualState({
        loading: false,
        error: t('help.manualNotAvailable', { defaultValue: 'No manual file could be loaded for this language.' }),
        html: '',
        resolvedUrl: '',
      });
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
    return undefined;
  }, [isOpen]);

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
    searchSessionRef.current = session;
    revealManualMatch(container, session.matches[0], 0, session);
    return () => {
      if (searchSessionRef.current === session) searchSessionRef.current = null;
      session.cleanup();
    };
  }, [debouncedSearchQuery, manualState.html, language, isOpen]);

  useEffect(() => {
    const session = searchSessionRef.current;
    const container = contentRef.current;
    if (!session || !container || !isOpen || session.matches.length === 0) return;
    const total = session.matches.length;
    const clamped = ((currentSearchMatch % total) + total) % total;
    session.setCurrent(clamped);
    revealManualMatch(container, session.matches[clamped], clamped, session);
  }, [currentSearchMatch, isOpen]);

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

  if (!isOpen) return null;

  return (
    <div
      className="odv-help-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-help-title"
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
        className="odv-help-dialog"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="odv-help-header">
          <div>
            <h2 id="odv-help-title" className="odv-help-title">
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
            <label className="odv-manual-searchbar-label" htmlFor="odv-manual-search-input">
              {t('help.searchManualLabel', { defaultValue: 'Search the manual' })}
            </label>
            <div className="odv-manual-searchbar-field">
              <span className="material-icons" aria-hidden="true">search</span>
              <input
                ref={searchInputRef}
                id="odv-manual-search-input"
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

        <div className="odv-help-body odv-help-body-manual">
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
            <div ref={contentRef} className="odv-manual-content" dangerouslySetInnerHTML={{ __html: manualState.html }} />
          )}
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
};
