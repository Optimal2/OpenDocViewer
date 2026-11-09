// File: src/components/Manual/ManualView.jsx
/**
 * Shared manual body: loads the configured manual source for the current UI language, filters the
 * standard manual by enabled features, renders a contents tree built from the h2/h3 headings, an
 * in-manual search with highlighted, navigable hits, and keeps the bundled manuals' `:target` image
 * lightbox working.
 *
 * The view does not assume it lives in a modal. Hosts render their own chrome (title bar, close
 * button, page header) around it. It renders two siblings without a wrapper element — the search
 * row and the `.odv-help-body-manual` body — so the host container must be a flex column that gives
 * the body its height (the overlay's `.odv-help-dialog`, or a full-page container). The narrow
 * layout (contents toggle instead of a column) is a CSS container query on the `odv-manual`
 * container, so a full-page host should declare `container: odv-manual / inline-size` as well.
 *
 * The contents tree and search field use fixed ids, so render at most one view per document.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getRuntimeConfig } from '../../utils/runtimeConfig.js';
import {
  buildManualContentsTree,
  countManualMatchesPerSection,
  findManualSectionId,
} from '../../utils/manualContentsTree.js';
import { loadManualDocument } from './manualDocument.js';
import {
  applyCustomHighlight,
  applyMarkFallback,
  canUseCustomHighlight,
  collectManualTextMatches,
  MANUAL_SEARCH_DEBOUNCE_MS,
  MANUAL_SEARCH_MIN_LENGTH,
  removeMarkFallback,
  revealManualMatch,
  setCurrentMark,
} from './manualSearch.js';
import {
  captureScrollPositions,
  findManualElementById,
  isHiddenInManual,
  MANUAL_SECTION_ACTIVE_LINE,
  MANUAL_SECTION_SCROLL_GAP,
  openDetailsAncestors,
  replaceUrlFragment,
  scrollPaneToTarget,
} from './manualNavigation.js';

/** Id of the contents tree; the narrow-window toggle points at it with aria-controls. */
export const MANUAL_CONTENTS_ID = 'odv-manual-contents';

/** Id of the manual search field. */
export const MANUAL_SEARCH_INPUT_ID = 'odv-manual-search-input';

/**
 * State of the loaded manual document as reported to the host.
 *
 * @typedef {Object} ManualDocumentState
 * @property {boolean} loading True while a source is being loaded.
 * @property {string} error Localised error text when no manual could be loaded, otherwise empty.
 * @property {string} resolvedUrl URL the manual was loaded from (without the refresh token).
 */

/**
 * @param {(string|null|undefined)} value Section id, optionally with a leading `#` and URL-encoded
 *   (as in `location.hash`).
 * @returns {string} Plain element id, or an empty string.
 */
function normalizeSectionId(value) {
  let id = String(value || '').replace(/^#/, '');
  try { id = decodeURIComponent(id); } catch { /* keep the raw id */ }
  return id;
}

/**
 * @param {Object} props
 * @param {number} [props.refreshToken=0] Non-zero value that changes to reload the manual from the
 *   server, bypassing caches. Zero loads normally.
 * @param {function(ManualDocumentState): void} [props.onDocumentStateChange] Called whenever the
 *   loading state, error or resolved source URL changes (e.g. for a "Loaded from" subtitle or to
 *   disable a reload button while loading).
 * @param {function(): void} [props.onEscape] Called for Escape when neither the open narrow-window
 *   contents list nor an active search query consumes it. A modal host passes its close action;
 *   without it the view leaves such Escape presses alone.
 * @param {Array<string>} [props.reservedIds] Additional ids the host renders around the view (e.g.
 *   its title id). Generated heading ids avoid them. Read when a manual is loaded.
 * @param {string} [props.initialSectionId] Element id (a leading `#` and URL encoding are accepted,
 *   so `location.hash` can be passed as is) to scroll to once the manual has loaded. Applied once
 *   per distinct manual (a new language applies it again). The id of an element hidden until it is
 *   the fragment target (a lightbox image) opens that lightbox while the URL fragment still names
 *   it, as a click on its thumbnail would; otherwise such an id is ignored and the manual opens at
 *   the top. A reload that yields the same manual content keeps the reader
 *   at the section they were in (the initial one, or the one navigated or scrolled to since).
 * @param {function(string): void} [props.onActiveSectionChange] Reports the id of the section the
 *   reader is currently in (the contents entry marked current), or an empty string when the manual
 *   has no contents tree. Usable for building a "#<section>" link. Not called while a manual image
 *   lightbox holds the URL fragment (so mirroring the section into the fragment cannot close it);
 *   the current section is reported again when the lightbox closes.
 * @returns {React.ReactElement}
 */
export default function ManualView({
  refreshToken = 0,
  onDocumentStateChange = undefined,
  onEscape = undefined,
  reservedIds = undefined,
  initialSectionId = undefined,
  onActiveSectionChange = undefined,
}) {
  const { t, i18n } = useTranslation('common');
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
  // Host callbacks and options read through refs, so new identities never re-run effects.
  const onEscapeRef = useRef(onEscape);
  const onDocumentStateChangeRef = useRef(onDocumentStateChange);
  const onActiveSectionChangeRef = useRef(onActiveSectionChange);
  const reservedIdsRef = useRef(reservedIds);
  // Section navigation per completed load: the load it was last applied to, the manual HTML of
  // that load, and the section the reader is in (set by navigation and by scrolling; empty while
  // the reader is still at the top of the manual).
  const loadSequenceRef = useRef(0);
  const appliedLoadRef = useRef(0);
  const appliedHtmlRef = useRef('');
  const currentSectionRef = useRef('');
  // `failed` is a flag, not a translated text: the localised message is derived while rendering,
  // so locale resources settling later never have to re-run (and reload) the manual.
  const [manualState, setManualState] = useState({ loading: false, failed: false, html: '', resolvedUrl: '', load: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [currentSearchMatch, setCurrentSearchMatch] = useState(0);
  const [contentsGroups, setContentsGroups] = useState(/** @type {Array<{id: string, text: string, element: Element, children: Array<Object>}>} */ ([]));
  const [activeSectionId, setActiveSectionId] = useState('');
  const [sectionHitCounts, setSectionHitCounts] = useState(/** @type {Map<string, number>} */ (new Map()));
  const [contentsOpen, setContentsOpen] = useState(false);
  // True while a manual link has put a `:target` element (the image lightbox) into the URL fragment.
  const [fragmentTargetOpen, setFragmentTargetOpen] = useState(false);

  onEscapeRef.current = onEscape;
  onDocumentStateChangeRef.current = onDocumentStateChange;
  onActiveSectionChangeRef.current = onActiveSectionChange;
  reservedIdsRef.current = reservedIds;

  const language = useMemo(() => {
    const raw = String(i18n?.resolvedLanguage || i18n?.language || 'en').toLowerCase();
    return raw.split('-')[0] || 'en';
  }, [i18n?.language, i18n?.resolvedLanguage]);

  const clearManualSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  // Ref mirrors for the native Escape listener below, which is registered once per mount and must
  // see the latest search state.
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
    currentSectionRef.current = id;
    setActiveSectionId(id);
  }, []);

  /**
   * Set the URL fragment for a manual link whose target is styled through `:target` (the bundled
   * manuals' image lightbox), without moving the content pane, the host or the page behind it.
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

  /** Put back the URL fragment the page had before the manual set one. */
  const restoreViewerFragment = useCallback(() => {
    const original = viewerFragmentRef.current;
    if (original === null || typeof window === 'undefined') return;
    viewerFragmentRef.current = null;
    setFragmentTargetOpen(false);
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

  /**
   * Show a manual element that is hidden until it is the URL fragment target (the bundled manuals'
   * `:target` image lightbox) by making it the fragment target. Only when that actually shows it is
   * it treated as an open lightbox (section reports are held back); otherwise the fragment is put
   * back as it was.
   *
   * @param {string} id
   * @returns {boolean} True when the element is now shown as the fragment target.
   */
  const openFragmentTarget = useCallback((id) => {
    const container = contentRef.current;
    const target = findManualElementById(container, id);
    if (!container || !target || !isHiddenInManual(target, container)) return false;
    setManualFragment(id);
    if (isHiddenInManual(target, container)) {
      restoreViewerFragment();
      return false;
    }
    setFragmentTargetOpen(true);
    return true;
  }, [restoreViewerFragment, setManualFragment]);

  /**
   * After new manual content has been rendered: a fragment the manual set is kept only while it
   * still opens a lightbox in the new content; otherwise the page's own fragment is put back and
   * section reports resume. The new content replaced the element the fragment pointed at, so the
   * fragment is applied again to make the new element the target.
   */
  const revalidateFragmentTarget = useCallback(() => {
    if (viewerFragmentRef.current === null || typeof window === 'undefined') return;
    const id = normalizeSectionId(window.location.hash);
    if (id && openFragmentTarget(id)) return;
    restoreViewerFragment();
  }, [openFragmentTarget, restoreViewerFragment]);

  const handleContentsLinkClick = useCallback((event, id) => {
    event.preventDefault();
    navigateToManualTarget(id);
  }, [navigateToManualTarget]);

  // In-text links to "#id": a rendered target (a heading, a paragraph) is scrolled to inside the
  // content pane. A target hidden until it is the URL fragment target (the lightbox image) is
  // opened through the fragment; one that stays hidden is navigated to like a rendered one. No
  // target at all (the lightbox's "#lb-stang" close link) sets the fragment, which closes the
  // lightbox through the manual's :target CSS.
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
    if (!target) {
      setManualFragment(id);
      setFragmentTargetOpen(false);
      return;
    }
    if (isHiddenInManual(target, container) && openFragmentTarget(id)) return;
    navigateToManualTarget(id);
  }, [navigateToManualTarget, openFragmentTarget, setManualFragment]);

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
      // of letting Escape reach the host (which may close a dialog).
      event.preventDefault();
      event.stopPropagation();
      clearSearchRef.current();
    }
  }, [goToSearchMatch]);

  // Leaving (a dialog closing, a page unmounting) must not leave a lightbox fragment in the URL.
  useEffect(() => () => restoreViewerFragment(), [restoreViewerFragment]);

  useEffect(() => {
    /** @param {KeyboardEvent} event */
    const handleEscape = (event) => {
      if (String(event?.key || '') !== 'Escape') return;
      const target = event?.target;
      if (contentsOpenRef.current) {
        // Escape closes the narrow-window contents list first; the next Escape reaches the host.
        event.preventDefault();
        event.stopPropagation();
        closeContentsRef.current();
        return;
      }
      if (target && typeof target.closest === 'function'
        && target.closest('[data-odv-manual-search="bar"]') && searchQueryRef.current) {
        // Escape anywhere in the search row (field, clear or previous/next
        // button) clears an active query; the host stays open and the next
        // Escape reaches it. The native capture listener runs before React
        // handlers, so stop here to keep a backdrop handler from closing
        // the dialog.
        event.preventDefault();
        event.stopPropagation();
        clearSearchRef.current();
        // The clear button unmounts with the query; keep keyboard focus in
        // the search row instead of dropping it to the document body.
        if (target !== searchInputRef.current) searchInputRef.current?.focus?.();
        return;
      }
      const handleHostEscape = onEscapeRef.current;
      if (typeof handleHostEscape !== 'function') return;
      event.preventDefault();
      event.stopPropagation();
      handleHostEscape();
    };

    document.addEventListener('keydown', handleEscape, true);
    window.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('keydown', handleEscape, true);
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, []);

  // Reloads only for a new language or an explicit refresh. `t` is deliberately not a dependency:
  // its identity changes when the locale resources settle, which can happen after the manual has
  // loaded, and a reload then would throw away the section the reader was taken to.
  useEffect(() => {
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setManualState({ loading: true, failed: false, html: '', resolvedUrl: '', load: 0 });

    const showManualNotAvailable = () => {
      if (cancelled) return;
      loadSequenceRef.current += 1;
      setManualState({ loading: false, failed: true, html: '', resolvedUrl: '', load: loadSequenceRef.current });
    };

    const load = async () => {
      // Start one microtask later: React StrictMode's development-only mount/unmount/mount check
      // runs synchronously, so its discarded first mount is cancelled here before any request is
      // sent. A host mounting the view on demand (the overlay) would otherwise fetch twice in dev.
      await Promise.resolve();
      if (cancelled) return;
      try {
        const loaded = await loadManualDocument({
          language,
          runtimeConfig: getRuntimeConfig(),
          refreshToken,
          signal: controller?.signal,
        });
        if (cancelled) return;
        if (loaded) {
          loadSequenceRef.current += 1;
          setManualState({
            loading: false,
            failed: false,
            html: loaded.html,
            resolvedUrl: loaded.resolvedUrl,
            load: loadSequenceRef.current,
          });
          return;
        }
        showManualNotAvailable();
      } catch {
        // Cleanup aborts the active request when the view unmounts or the language changes. Any
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
  }, [language, refreshToken]);

  const manualErrorText = manualState.failed
    ? t('help.manualNotAvailable', { defaultValue: 'No manual file could be loaded for this language.' })
    : '';

  useEffect(() => {
    onDocumentStateChangeRef.current?.({
      loading: manualState.loading,
      error: manualErrorText,
      resolvedUrl: manualState.resolvedUrl,
    });
  }, [manualState.loading, manualErrorText, manualState.resolvedUrl]);

  // Build the contents tree from the mounted, sanitised manual before the browser paints, so the
  // column appears together with the text. A manual without h2/h3 gets no column at all.
  useLayoutEffect(() => {
    const tree = manualState.html
      ? buildManualContentsTree(contentRef.current, {
        reservedIds: [MANUAL_CONTENTS_ID, MANUAL_SEARCH_INPUT_ID, ...(reservedIdsRef.current || [])],
      })
      : { entries: [], groups: [] };
    contentsEntriesRef.current = tree.entries;
    pinnedSectionRef.current = null;
    setContentsGroups(tree.groups);
    setActiveSectionId(tree.entries[0]?.id || '');
    if (tree.entries.length === 0) setContentsOpen(false);
  }, [manualState.html]);

  // After each completed load (and after the tree assigned heading ids): a new manual opens at the
  // requested initial section; a reload with the same content (an explicit refresh, a host
  // re-running the load) first revalidates an open lightbox — which stays open while its
  // fragment still opens one in the loaded content — and otherwise returns to the section the
  // reader was in, because the reload replaced the content element, its focus and the pane's
  // scroll position. An initial id that names a
  // lightbox opens it, as a click on its thumbnail would. A lightbox that was open before the load
  // stays open only when its fragment still opens one in the loaded content; otherwise (no such
  // element, a failed load, a section navigated to) the page's own fragment is put back, so the
  // held-back section reports never stay muted with no lightbox on screen.
  useEffect(() => {
    const html = manualState.html;
    const load = manualState.load;
    if (!load || appliedLoadRef.current === load) return;
    appliedLoadRef.current = load;
    const container = contentRef.current;
    if (!html || !container) {
      restoreViewerFragment();
      return;
    }
    const sameContent = appliedHtmlRef.current === html;
    appliedHtmlRef.current = html;
    if (!sameContent) currentSectionRef.current = '';
    if (sameContent) {
      // A reload with the same content (an explicit refresh, a host re-running the load) must
      // not close a lightbox the reader has open: the open fragment is revalidated first and
      // stays open while it still opens one in the loaded content. Only when no lightbox stays
      // open is the reader returned to the section they were in.
      revalidateFragmentTarget();
      if (viewerFragmentRef.current !== null) return;
      const currentId = currentSectionRef.current;
      const currentTarget = currentId ? findManualElementById(container, currentId) : null;
      if (currentTarget && !isHiddenInManual(currentTarget, container)) {
        navigateToManualTarget(currentId);
      }
      return;
    }
    const id = normalizeSectionId(initialSectionId);
    const target = id ? findManualElementById(container, id) : null;
    if (target && !isHiddenInManual(target, container)) {
      navigateToManualTarget(id);
      return;
    }
    if (target && !sameContent && typeof window !== 'undefined'
      && normalizeSectionId(window.location.hash) === id) {
      // Opened at a lightbox that still owns the URL fragment (a reload of the stand-alone page
      // while one was open). There is no earlier fragment to hand back when it closes; a lightbox
      // the reader has closed since (the fragment moved on) is not opened again.
      if (viewerFragmentRef.current === null) viewerFragmentRef.current = '';
      if (openFragmentTarget(id)) return;
    }
    revalidateFragmentTarget();
  }, [
    manualState.html,
    manualState.load,
    initialSectionId,
    navigateToManualTarget,
    openFragmentTarget,
    restoreViewerFragment,
    revalidateFragmentTarget,
  ]);

  // Held back while a lightbox owns the URL fragment: a host that mirrors the section into the
  // fragment would otherwise replace it (images loading late shift the layout and move the current
  // section) and close the lightbox. The section is reported again once the lightbox closes.
  useEffect(() => {
    if (fragmentTargetOpen) return;
    onActiveSectionChangeRef.current?.(activeSectionId);
  }, [activeSectionId, fragmentTargetOpen]);

  // The search field's own clear button fires the native `search` event (React has no prop for
  // it); follow it like an input change. The field exists only while a manual is shown.
  const hasManualHtml = Boolean(manualState.html);
  useEffect(() => {
    const input = searchInputRef.current;
    if (!hasManualHtml || !input) return undefined;
    const handleNativeSearch = (event) => setSearchQuery(event?.target?.value ?? '');
    input.addEventListener('search', handleNativeSearch);
    return () => input.removeEventListener('search', handleNativeSearch);
  }, [hasManualHtml]);

  // Track the section being read: the last heading above the active line of the content pane.
  // The observer only signals that a heading crossed that line; the position check reads layout
  // once per animation frame and never writes to it.
  useEffect(() => {
    const pane = scrollPaneRef.current;
    const entries = contentsEntriesRef.current;
    if (!pane || entries.length === 0 || typeof IntersectionObserver === 'undefined') return undefined;
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
      // At the top of the manual there is nothing to return to after a same-content reload.
      currentSectionRef.current = pane.scrollTop < 2 ? '' : active;
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
  }, [contentsGroups]);

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
    const trimmed = searchQuery.trim();
    if (trimmed.length < MANUAL_SEARCH_MIN_LENGTH) {
      setDebouncedSearchQuery('');
      return undefined;
    }
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(trimmed);
    }, MANUAL_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const container = contentRef.current;
    searchSessionRef.current = null;
    if (!container || debouncedSearchQuery.length < MANUAL_SEARCH_MIN_LENGTH) {
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
  }, [debouncedSearchQuery, manualState.html, language, pinSectionFor]);

  useEffect(() => {
    const session = searchSessionRef.current;
    const container = contentRef.current;
    if (!session || !container || session.matches.length === 0) return;
    const total = session.matches.length;
    const clamped = ((currentSearchMatch % total) + total) % total;
    session.setCurrent(clamped);
    revealManualMatch(container, session.matches[clamped], clamped, session);
    pinSectionFor(session.matches[clamped]?.node);
  }, [currentSearchMatch, pinSectionFor]);

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
    <>
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
          ) : manualErrorText ? (
            <div className="odv-help-placeholder is-error">
              <p>{manualErrorText}</p>
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
    </>
  );
}

ManualView.propTypes = {
  refreshToken: PropTypes.number,
  onDocumentStateChange: PropTypes.func,
  onEscape: PropTypes.func,
  reservedIds: PropTypes.arrayOf(PropTypes.string),
  initialSectionId: PropTypes.string,
  onActiveSectionChange: PropTypes.func,
};
