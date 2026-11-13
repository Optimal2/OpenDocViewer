// File: src/components/DocumentToolbar/OcrSearchBar.jsx
/**
 * Search in the recognised text, from the toolbar: a search button right after the
 * image-adjustment group that doubles as the page's OCR status (an LED on the button, the status
 * in its tooltip and in a visually hidden live region; the button is enabled once the displayed
 * page's text is recognised, or any page's when the displayed page has none), and a field that
 * grows out of it to the right (a short width transition, styles/ocr.css) with the match
 * position, previous/next and close. The field takes only the room the toolbar's spacer leaves
 * (measured when it opens and whenever the window, the toolbar or its spacer changes size or
 * the toolbar's contents change, utils/ocrSearchPlacement.js); with too little
 * room it hangs under the toolbar at the button's right edge instead, so the toolbar never
 * overflows for it.
 *
 * The search covers the recognised text of every page that has an outcome, in page order
 * (utils/ocrSearch.js: case-insensitive, a phrase also across a line break), and nothing else
 * on the page; a checkbox in the field limits it to the displayed page (the matches follow the
 * page as it changes, and the steps never leave it). Typing finds the matches and makes the
 * first one on the displayed page current without leaving the page; Enter and the arrows walk
 * the matches, moving to a match's page when it is another one. The current term, match and
 * (when limited) the page are published to the viewer (ViewerContext `ocrSearch`), where the
 * text layer marks the matches on its page and scrolls the current one into view. While not
 * every page has an outcome yet, the status says how many pages the search covers. Page
 * numbers here are original session page numbers (they index `allPages` and are what
 * `setPageNumber` takes), not ordinals among the visible pages. Mounted by OcrToolbarActions
 * (from DocumentToolbar) only while `ocr.enabled` is the literal true.
 *
 * Under the pointer, and with keyboard focus, the button grows to the right in a short ease
 * (styles/ocr.css) and shows its details: the count of pages with a text layer over all pages
 * ("4/300"), roughly how long the waiting pages will take, and how many pages are being worked
 * on right now. They live in the button and not in its tooltip because they change with every
 * recognised page, and a browser takes a native tooltip away whenever its text changes: the
 * tooltip holds only what rarely changes (what the button does, the page's status, the boost).
 * The button grows only into the room the toolbar's spacer leaves (measured when the pointer or
 * the focus arrives and while it stays, utils/ocrSearchPlacement.js): with too little room the
 * details are dropped whole from the end and only the count is left, so the toolbar's end is
 * not pushed out for more than the count, which always stood in the button. They are folded
 * away at once when the field opens, before the field is placed
 * (the field takes the room). The button's description for assistive technology spells the
 * same things out.
 *
 * With `ocr.boost` on, the button also shows the boost (utils/ocrBoostStatus.js): a small badge
 * with the engine count while more engines than the cautious count run, and a line at the end of
 * the tooltip saying what the last climb found. Without a boost (the default) neither exists.
 *
 * With `ocr.recognizeWholeDocument` on, while pages wait for OCR and enough of them have been
 * recognised to tell the pace, the details say roughly how long the rest will take
 * (utils/ocrProgress.js). Without it only the few pages around the shown one are ever queued,
 * and a time for those next to the count of all pages would mislead.
 *
 * With `searchEnabled` false (`ocr.search.enabled: false`) only the status remains: the button
 * stays a never-enabled, status-only indicator with its LED, the status as its name and in its
 * tooltip, the details and the live region, and no field exists, so no term is ever published
 * and the layers mark nothing.
 */
import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import ViewerContext from '../../contexts/viewerContext.js';
import StatusLed from '../common/StatusLed.jsx';
import { ocrPageKeyOf } from '../../utils/ocrPageKey.js';
import { hasSearchableOcrText, OCR_STATUS_FALLBACK, OCR_STATUS_LED, ocrStatusKeyOf } from '../../utils/ocrStatus.js';
import { normalizeOcrSearchTerm, searchOcrPages } from '../../utils/ocrSearch.js';
import { measureOcrDetailsWidth, measureOcrSearchPlacement, OCR_SEARCH_PANEL_WIDTH } from '../../utils/ocrSearchPlacement.js';
import { hasActiveModalDialog, isEditableTarget } from '../DocumentViewer/hooks/useViewerEffects.js';
import { OCR_BOOST_FALLBACK, describeOcrBoost } from '../../utils/ocrBoostStatus.js';
import { OCR_PROGRESS_FALLBACK, createOcrProgressEstimator, describeOcrTimeLeft, describeOcrTimeLeftShort } from '../../utils/ocrProgress.js';
import { isOcrWholeDocumentEnabled } from '../../utils/runtimeConfig.js';

/** Statuses (src/ocr/queue.js OCR_PAGE_STATUS) of a page still waiting for OCR. */
const OCR_PENDING_STATUSES = new Set(['queued', 'probing', 'recognizing']);
/** Statuses of a page being worked on right now: one for each of the queue's pages in flight. */
const OCR_ACTIVE_STATUSES = new Set(['probing', 'recognizing']);

/** @param {{ pageKey:string, ordinal:number }} match */
const matchIdOf = (match) => `${match.pageKey}\u001f${match.ordinal}`;

/**
 * @param {Object} props
 * @param {number} props.pageNumber  Original session page number (1-based) of the displayed
 *   page: DocumentToolbar's `pageNumberDisplay`.
 * @param {function(number): void} props.setPageNumber  Takes an original session page number.
 * @param {Array<Object>} props.allPages  The viewer's pages.
 * @param {boolean} [props.searchEnabled=true]  False keeps only the status indicator.
 * @param {boolean} [props.ctrlFOverride=false]  True lets Ctrl+F (Cmd+F) open the field instead
 *   of the browser's find (`ocr.search.overridesCtrlF`); Ctrl+F stays the browser's in a modal
 *   dialog, in other text fields and in the toolbar's other menus (every `data-odv-shortcuts="off"`
 *   area, such as the language menu), and with Shift or Alt held.
 * @returns {React.ReactElement}
 */
export default function OcrSearchBar({ pageNumber, setPageNumber, allPages, searchEnabled = true, ctrlFOverride = false }) {
  const { t } = useTranslation('common');
  const { ocrPages, ocrEngineFailure, ocrBoost = null, setOcrSearch } = useContext(ViewerContext);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  // Limited to the displayed page: the page's own matches only, the steps never leave it.
  const [pageOnly, setPageOnly] = useState(false);
  const [currentId, setCurrentId] = useState(/** @type {(string|null)} */ (null));
  const inputRef = useRef(/** @type {(HTMLInputElement|null)} */ (null));
  const buttonRef = useRef(/** @type {(HTMLButtonElement|null)} */ (null));
  const rootRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const panelRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  // True from a left-button press on the page checkbox until its change: that change hands the
  // focus back to the input. A keyboard change leaves the focus on the checkbox, so a key press
  // clears the flag (a press that never became a change, dragged away or a right click, would
  // otherwise hand a later keyboard change's focus to the input).
  const scopeByMouseRef = useRef(false);
  const panelId = useId();
  const coverageId = useId();
  const [placement, setPlacement] = useState({ mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 });
  // The match whose page was last asked for: a match on a page the print selection hides lands
  // on the nearest shown page, and the next step must then move on instead of asking again.
  // Forgotten with a new term and when another match becomes current; not on a page change,
  // which the request itself causes (landing elsewhere must not cost a second request).
  const shownMatchRef = useRef(/** @type {(string|null)} */ (null));

  const pages = useMemo(() => (Array.isArray(allPages) ? allPages : []), [allPages]);
  const displayedIndex = Math.max(0, (Number(pageNumber) || 1) - 1);
  const displayedPage = pages[displayedIndex] || null;
  const displayedKey = displayedPage ? ocrPageKeyOf(displayedPage) : '';
  const displayedEntry = displayedKey && ocrPages ? ocrPages[displayedKey] || null : null;
  const statusKey = ocrStatusKeyOf(displayedEntry, ocrEngineFailure);
  const statusText = statusKey
    ? t(`ocr.status.${statusKey}`, { defaultValue: OCR_STATUS_FALLBACK[statusKey] })
    : t('ocr.status.notStarted', { defaultValue: 'Text recognition has not started on this page' });
  // The boost (`ocr.boost`), when there is one: a line in the tooltip saying what the last climb
  // found, and a badge with the engine count while it runs. The badge is the live part: reaching
  // for the button is input, and input ends the boost.
  const boostInfo = describeOcrBoost(ocrBoost);
  let boostText = '';
  if (boostInfo) {
    boostText = t(`ocr.boost.${boostInfo.key}`, { engines: boostInfo.engines, defaultValue: OCR_BOOST_FALLBACK[boostInfo.key] });
    if (boostInfo.slow) {
      boostText += ` (${t('ocr.boost.slow', { level: boostInfo.slow.level, percent: boostInfo.slow.percent, defaultValue: OCR_BOOST_FALLBACK.slow })})`;
    }
  }
  const boostState = boostInfo ? String(ocrBoost.state) : undefined;
  // The boost's line comes last in the tooltip; what goes before it is `head`.
  const withBoost = (head) => (boostText ? `${head} · ${boostText}` : head);
  const boostBadge = boostInfo?.badge ? (
    <span className="toolbar-ocr-boost" data-odv-ocr="boost" aria-hidden="true">
      <span className="material-icons toolbar-ocr-boost-icon">bolt</span>
      <span className="toolbar-ocr-boost-text">{boostInfo.badge}</span>
    </span>
  ) : null;

  // Every page with its outcome, in page order; the search runs over the ones with text.
  const searchablePages = useMemo(() => pages.map((page, index) => {
    const pageKey = ocrPageKeyOf(page);
    return { pageKey, pageIndex: index, pageNumber: index + 1, outcome: (ocrPages && ocrPages[pageKey]) || null };
  }), [ocrPages, pages]);
  // Pages the search covers: recognised, or a PDF page's own text (both `done`).
  const recognisedPages = useMemo(
    () => searchablePages.filter((page) => page.outcome?.status === 'done').length,
    [searchablePages]
  );
  // The pages being worked on right now (the queue's pages in flight), whatever the mode. And
  // with the whole document asked for: the pages still waiting for OCR, and roughly how long
  // they will take at the pace of the pages the engine recognised lately (utils/ocrProgress.js;
  // a PDF page's own text is done without the engine and is no pace). The estimate is dropped
  // a window after the last recognised page, whatever else changes meanwhile: a figure from a
  // pace that no longer holds is worse than none, and without a new page nothing else would
  // take it away.
  const wholeDocument = isOcrWholeDocumentEnabled();
  const [pendingPages, enginePages, activePages] = useMemo(() => {
    let pending = 0;
    let engine = 0;
    let active = 0;
    for (const page of searchablePages) {
      const outcome = page.outcome;
      if (OCR_ACTIVE_STATUSES.has(outcome?.status)) active += 1;
      if (!wholeDocument) continue;
      if (OCR_PENDING_STATUSES.has(outcome?.status)) pending += 1;
      else if (outcome?.status === 'done' && outcome.source !== 'pdf-text') engine += 1;
    }
    return [pending, engine, active];
  }, [searchablePages, wholeDocument]);
  const progressRef = useRef(/** @type {*} */ (null));
  const [timeLeftMs, setTimeLeftMs] = useState(/** @type {(number|null)} */ (null));
  useEffect(() => {
    if (!wholeDocument) return undefined;
    if (!progressRef.current) progressRef.current = createOcrProgressEstimator();
    progressRef.current.record(enginePages);
    const estimate = progressRef.current.remainingMs(pendingPages);
    setTimeLeftMs(estimate);
    if (estimate === null) return undefined;
    const timer = setTimeout(() => setTimeLeftMs(null), progressRef.current.expiresInMs() ?? 0);
    return () => clearTimeout(timer);
  }, [enginePages, pendingPages, wholeDocument]);
  const timeLeft = describeOcrTimeLeft(timeLeftMs);
  const timeLeftText = timeLeft
    ? t(`ocr.progress.${timeLeft.key}`, { minutes: timeLeft.minutes, hours: timeLeft.hours, defaultValue: OCR_PROGRESS_FALLBACK[timeLeft.key] })
    : '';
  const timeLeftShort = describeOcrTimeLeftShort(timeLeftMs);
  const timeLeftShortText = timeLeftShort
    ? t(`ocr.progress.${timeLeftShort.key}`, {
      seconds: timeLeftShort.seconds, minutes: timeLeftShort.minutes, hours: timeLeftShort.hours, defaultValue: OCR_PROGRESS_FALLBACK[timeLeftShort.key],
    })
    : '';
  let workersText = '';
  if (activePages === 1) workersText = t('ocr.progress.workerOne', { defaultValue: OCR_PROGRESS_FALLBACK.workerOne });
  else if (activePages > 1) workersText = t('ocr.progress.workers', { workers: activePages, defaultValue: OCR_PROGRESS_FALLBACK.workers });
  // How wide the details may unfold: into the room the toolbar's spacer leaves and no further,
  // dropped whole from the end when it is too small (utils/ocrSearchPlacement.js). The unfolding
  // itself is CSS (`:hover`, `:focus-visible`); the pointer and the focus are followed here only
  // to measure while the details show: when they arrive, whenever the details' text changes,
  // whenever the boost's badge comes or goes (it takes room in the button too) and
  // whenever the toolbar or its spacer changes size (the window, the field closing). Unfolding
  // does not change the answer (the spacer gives what the details take, and a toolbar that
  // overflows is counted by how much), so the observer settles at once.
  const [detailsHover, setDetailsHover] = useState(false);
  const [detailsFocus, setDetailsFocus] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState(/** @type {(number|null)} */ (null));
  const detailsShown = (detailsHover || detailsFocus) && !open;
  const fitDetails = useCallback(() => {
    const width = measureOcrDetailsWidth(rootRef.current);
    if (width !== null) setDetailsWidth((current) => (current === width ? current : width));
  }, []);
  useLayoutEffect(() => {
    if (!detailsShown) return undefined;
    fitDetails();
    const toolbar = rootRef.current?.closest?.('.toolbar');
    const spacer = toolbar?.querySelector?.('.toolbar-spacer');
    if (!spacer || typeof ResizeObserver !== 'function') return undefined;
    const sizes = new ResizeObserver(fitDetails);
    sizes.observe(toolbar);
    sizes.observe(spacer);
    return () => sizes.disconnect();
  }, [detailsShown, fitDetails, recognisedPages, pages.length, timeLeftShortText, workersText, boostInfo?.badge]);
  // The boost's badge leaves at the first input, and the move that brings the pointer onto the
  // button is input: the button would lose the badge's width at once, before the details have
  // begun to unfold, and a pointer that came in over the badge would be left outside a button
  // that then never unfolds. The badge's width is therefore measured as the pointer arrives
  // (the arrival is dispatched before the move that ends the boost) and held by the details
  // while the pointer stays and no badge shows.
  const [detailsHold, setDetailsHold] = useState(/** @type {(number|null)} */ (null));
  const detailsHandlers = {
    onPointerEnter: () => {
      setDetailsHover(true);
      const badge = rootRef.current?.querySelector?.('[data-odv-ocr="boost"]');
      let hold = 0;
      // A badge that takes no room (hidden while the field is open) leaves nothing to hold.
      const badgeWidth = badge ? badge.getBoundingClientRect().width : 0;
      if (badgeWidth > 0 && typeof getComputedStyle === 'function') {
        const style = getComputedStyle(badge);
        hold = badgeWidth + (Number.parseFloat(style.marginLeft) || 0) + (Number.parseFloat(style.marginRight) || 0);
      }
      setDetailsHold(hold > 0 ? hold : null);
    },
    onPointerLeave: () => {
      setDetailsHover(false);
      setDetailsHold(null);
    },
  };
  const detailsStyle = {};
  if (detailsWidth !== null) detailsStyle['--odv-ocr-details-max'] = `${detailsWidth}px`;
  if (detailsHold !== null && !boostBadge && !open) detailsStyle.minWidth = `${detailsHold}px`;
  // The details the button unfolds under the pointer and with keyboard focus (styles/ocr.css):
  // the count behind a thin divider, then the time left and the pages being worked on while
  // there are any. For the eye only: the button's description spells them out.
  const coverageTitle = t('ocr.search.coverageLong', { done: recognisedPages, pages: pages.length, defaultValue: `${recognisedPages} of ${pages.length} pages ready` });
  const describedText = [coverageTitle, timeLeftText, workersText].filter(Boolean).join(' · ');
  const details = (
    <span
      className="toolbar-ocr-search-details"
      data-odv-ocr="details"
      aria-hidden="true"
      style={detailsStyle}
    >
      <span className="toolbar-ocr-search-details-divider" />
      <span className="toolbar-ocr-search-detail" data-odv-ocr="count">{`${recognisedPages}/${pages.length}`}</span>
      {timeLeftShortText ? <span className="toolbar-ocr-search-detail" data-odv-ocr="time-left">{timeLeftShortText}</span> : null}
      {workersText ? <span className="toolbar-ocr-search-detail" data-odv-ocr="workers">{workersText}</span> : null}
    </span>
  );
  // The displayed page's text, or (a page without text, skipped or failed) any page's.
  const ready = hasSearchableOcrText(displayedEntry)
    || searchablePages.some((page) => hasSearchableOcrText(page.outcome));
  const normalizedTerm = normalizeOcrSearchTerm(term);
  // The pages the search runs over: all of them, or the displayed page alone.
  const scopedPages = useMemo(
    () => (pageOnly ? searchablePages.filter((page) => page.pageIndex === displayedIndex) : searchablePages),
    [displayedIndex, pageOnly, searchablePages]
  );
  const matches = useMemo(
    () => (open && normalizedTerm ? searchOcrPages(scopedPages, normalizedTerm) : []),
    [normalizedTerm, open, scopedPages]
  );
  // The current match: the one chosen (if it still exists among the matches), else the first
  // match on the displayed page, or after it, or the first of all. Derived here, so the
  // position is right in the same render as the matches (never "0 of N"); the choice is kept
  // in state so that outcomes arriving later do not move it. The page is not changed here;
  // Enter and the arrows do that.
  const currentPosition = useMemo(() => {
    if (matches.length === 0) return -1;
    if (currentId !== null) {
      const chosen = matches.findIndex((match) => matchIdOf(match) === currentId);
      if (chosen >= 0) return chosen;
    }
    const onOrAfter = matches.findIndex((match) => match.pageIndex >= displayedIndex);
    return onOrAfter >= 0 ? onOrAfter : 0;
  }, [currentId, displayedIndex, matches]);
  const current = currentPosition >= 0 ? matches[currentPosition] : null;

  useEffect(() => {
    if (!open) return;
    const nextId = current ? matchIdOf(current) : null;
    if (nextId !== currentId) setCurrentId(nextId);
    if (shownMatchRef.current !== null && shownMatchRef.current !== nextId) shownMatchRef.current = null;
  }, [current, currentId, open]);

  // Publish the term, the current match and (limited to one page) the page for the text layers
  // (marks and scrolling): another page's layer then marks nothing, as in compare mode.
  useEffect(() => {
    if (typeof setOcrSearch !== 'function') return undefined;
    if (!open || !normalizedTerm) {
      setOcrSearch(null);
      return undefined;
    }
    setOcrSearch({
      term: normalizedTerm,
      current: current ? { pageKey: current.pageKey, ordinal: current.ordinal } : null,
      onlyPageKey: pageOnly ? displayedKey : null,
    });
    return undefined;
  }, [current, displayedKey, normalizedTerm, open, pageOnly, setOcrSearch]);

  useEffect(() => () => {
    if (typeof setOcrSearch === 'function') setOcrSearch(null);
  }, [setOcrSearch]);

  // Where the field goes: measured as it opens (the field is still closed, so the spacer shows
  // the room) and again while it is open whenever the window is resized, the toolbar or its
  // spacer changes size (another toolbar density) or the toolbar's contents change (the
  // signature overview button: with the toolbar already
  // overflowing, the spacer stays at 0 and only the button's place moves). The OCR group's
  // wrapper has no box of its own (display: contents), so it is not worth observing. The anchor
  // is the button: the root also holds the open inline field. The field's status is measured
  // too (its width is part of what the field needs), again whenever its text changes.
  const place = useCallback(() => {
    const next = measureOcrSearchPlacement(rootRef.current, panelRef.current, buttonRef.current);
    // The same placement again (most keystrokes) is no render.
    setPlacement((current) => (
      current.mode === next.mode && current.width === next.width && current.offset === next.offset && current.top === next.top
        ? current
        : next
    ));
  }, []);
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('resize', place);
    let sizes = null;
    let contents = null;
    const toolbar = rootRef.current?.closest?.('.toolbar');
    if (toolbar && typeof ResizeObserver === 'function') {
      sizes = new ResizeObserver(place);
      sizes.observe(toolbar);
      const spacer = toolbar.querySelector('.toolbar-spacer');
      if (spacer) sizes.observe(spacer);
      const status = panelRef.current?.querySelector?.('.toolbar-ocr-search-status');
      if (status) sizes.observe(status);
    }
    if (toolbar && typeof MutationObserver === 'function') {
      contents = new MutationObserver(place);
      contents.observe(toolbar, { childList: true, subtree: true });
    }
    return () => {
      window.removeEventListener('resize', place);
      sizes?.disconnect();
      contents?.disconnect();
    };
  }, [open, place]);

  // The status changes with the term, the matches, the current one, the pages recognised, the
  // scope and (limited to a page without text) the page's status: measured again in the same
  // layout pass (the observer above sees it too, a frame later and only where there is one).
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, normalizedTerm, matches.length, currentPosition, recognisedPages, pageOnly, statusKey]);

  useEffect(() => {
    if (open) inputRef.current?.focus?.();
  }, [open]);

  // Ctrl+F handed over: open the field, or put the cursor back in it with its text selected.
  // Captured on the window so the browser's find never shows; left alone in a modal dialog and
  // in other text fields (there Ctrl+F is theirs), and with Shift or Alt held.
  useEffect(() => {
    if (!ctrlFOverride || !searchEnabled || typeof window === 'undefined') return undefined;
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (String(event.key).toLowerCase() !== 'f' || event.defaultPrevented || event.isComposing) return;
      if (hasActiveModalDialog()) return;
      const panel = panelRef.current;
      const within = (node) => !!panel && node instanceof Node && panel.contains(node);
      // In the field (by target or by focus) the shortcut is ours; in another text field it is
      // the browser's.
      if (!within(event.target) && isEditableTarget(event.target)) return;
      if (!within(document.activeElement) && isEditableTarget(document.activeElement)) return;
      event.preventDefault();
      setOpen(true);
      const input = inputRef.current;
      if (input) {
        input.focus?.();
        input.select?.();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); };
  }, [ctrlFOverride, searchEnabled]);

  /** @param {number} position */
  const goToMatch = useCallback((position) => {
    const match = matches[position];
    if (!match) return;
    const id = matchIdOf(match);
    setCurrentId(id);
    if (match.pageNumber !== Number(pageNumber)) {
      shownMatchRef.current = id;
      if (typeof setPageNumber === 'function') setPageNumber(match.pageNumber);
    }
  }, [matches, pageNumber, setPageNumber]);

  useEffect(() => {
    shownMatchRef.current = null;
  }, [normalizedTerm, pageOnly]);

  /**
   * Enter / the arrows: a current match on another page is shown first (the position does not
   * move), unless its page was already asked for (a hidden page lands on the nearest shown one);
   * then, and on its page, the next or previous match becomes current, wrapping round.
   * @param {number} direction  1 forwards, -1 backwards.
   */
  const step = useCallback((direction) => {
    if (matches.length === 0) return;
    if (current && current.pageNumber !== Number(pageNumber) && shownMatchRef.current !== matchIdOf(current)) {
      goToMatch(currentPosition);
      return;
    }
    const from = currentPosition >= 0 ? currentPosition : (direction > 0 ? -1 : 0);
    goToMatch((from + direction + matches.length) % matches.length);
  }, [current, currentPosition, goToMatch, matches.length, pageNumber]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus?.();
  }, []);

  /** @param {React.KeyboardEvent<HTMLInputElement>} event */
  const handleInputKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  };

  /** Escape closes the field from any of its controls. @param {React.KeyboardEvent} event */
  const handlePanelKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  if (!searchEnabled) {
    // Status only: the same place and LED as the search button, never enabled, no field.
    return (
      <div ref={rootRef} className="toolbar-ocr-search is-status-only" data-odv-ocr="search" data-ocr-search="off" data-ocr-boost={boostState} {...detailsHandlers}>
        <button
          ref={buttonRef}
          type="button"
          className="odv-btn odv-btn--with-status-led toolbar-ocr-search-toggle is-status-only"
          data-odv-ocr="status"
          data-ocr-state={statusKey || 'notStarted'}
          aria-label={statusText}
          aria-describedby={coverageId}
          title={withBoost(statusText)}
          disabled
        >
          <span className="material-icons" aria-hidden="true">text_fields</span>
          {boostBadge}
          {details}
          <StatusLed state={OCR_STATUS_LED[statusKey] || 'off'} size="xs" title={statusText} className="odv-toolbar-runtime-led" />
        </button>
        <span className="sr-only" role="status" aria-live="polite" data-odv-ocr="status-text">{statusText}</span>
        {/* The details spelt out as the indicator's description, as on the search button. */}
        <span className="sr-only" id={coverageId} data-odv-ocr="coverage-text">{describedText}</span>
      </div>
    );
  }

  const openLabel = t('ocr.search.open', { defaultValue: 'Search in the recognised text' });
  const openTitle = ctrlFOverride ? `${openLabel} (Ctrl+F)` : openLabel;
  // The tooltip holds only what rarely changes; what changes with every page is in the details.
  const buttonTitle = withBoost(ready || open ? `${openTitle} · ${statusText}` : statusText);
  const pageOnlyLabel = t('ocr.search.pageOnly', { defaultValue: 'Search only on this page' });
  const pageOnlyShort = t('ocr.search.pageOnlyShort', { defaultValue: 'This page' });
  let statusLine = '';
  if (normalizedTerm && pageOnly && !hasSearchableOcrText(displayedEntry)) {
    // Limited to a page without searchable text: its status says why there is nothing.
    statusLine = statusText;
  } else if (normalizedTerm) {
    statusLine = matches.length === 0
      ? t('ocr.search.none', { defaultValue: 'No matches' })
      : t('ocr.search.position', { current: currentPosition + 1, total: matches.length, defaultValue: '{current}/{total}' });
    if (!pageOnly && recognisedPages < pages.length) {
      statusLine += ` · ${t('ocr.search.coverage', { done: recognisedPages, pages: pages.length, defaultValue: '{done}/{pages} pages searched' })}`;
    }
  }
  // The status spelt out, for its tooltip and assistive technology ("Match 3 of 12 · Searched 2
  // of 300 pages"). The status is never cut short: the field grows for it
  // (utils/ocrSearchPlacement.js).
  const statusTitle = normalizedTerm && matches.length > 0
    ? [
      t('ocr.search.positionLong', { current: currentPosition + 1, total: matches.length, defaultValue: 'Match {current} of {total}' }),
      ...(!pageOnly && recognisedPages < pages.length
        ? [t('ocr.search.coverageSearched', { done: recognisedPages, pages: pages.length, defaultValue: 'Searched {done} of {pages} pages' })]
        : []),
    ].join(' · ')
    : statusLine;

  return (
    <div ref={rootRef} className={`toolbar-ocr-search${open ? ' is-open' : ''}`} data-odv-ocr="search" data-ocr-boost={boostState} {...detailsHandlers}>
      <button
        ref={buttonRef}
        type="button"
        className={`odv-btn odv-btn--with-status-led toolbar-ocr-search-toggle${open ? ' is-active' : ''}`}
        data-odv-ocr="status"
        data-ocr-state={statusKey || 'notStarted'}
        aria-label={openLabel}
        aria-describedby={coverageId}
        title={buttonTitle}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={!ready && !open}
        onClick={() => (open ? close() : setOpen(true))}
        onFocus={() => setDetailsFocus(true)}
        onBlur={() => setDetailsFocus(false)}
      >
        <span className="material-icons" aria-hidden="true">search</span>
        {boostBadge}
        {details}
        <StatusLed state={OCR_STATUS_LED[statusKey] || 'off'} size="xs" title={statusText} className="odv-toolbar-runtime-led" />
      </button>
      <span className="sr-only" role="status" aria-live="polite" data-odv-ocr="status-text">{statusText}</span>
      {/* The details spelt out as the button's description (read on focus, never announced on
          their own), so assistive technology gets the search's reach and the progress too. */}
      <span className="sr-only" id={coverageId} data-odv-ocr="coverage-text">{describedText}</span>
      <div
        ref={panelRef}
        id={panelId}
        className={`toolbar-ocr-search-panel${placement.mode === 'hanging' ? ' is-hanging' : ''}`}
        data-placement={placement.mode}
        style={{
          width: open ? `${placement.width}px` : '0px',
          right: placement.mode === 'hanging' && placement.offset > 0 ? `${placement.offset}px` : undefined,
          top: placement.mode === 'hanging' ? `calc(100% + ${placement.top}px)` : undefined,
        }}
        role="search"
        aria-label={openLabel}
        aria-hidden={!open}
        data-odv-shortcuts="off"
        onKeyDown={handlePanelKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          className="toolbar-ocr-search-input"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={t('ocr.search.placeholder', { defaultValue: 'Search' })}
          aria-label={openLabel}
          autoComplete="off"
          spellCheck={false}
          tabIndex={open ? 0 : -1}
        />
        {/* The short status for the eye, the spelt-out one for assistive technology (a tooltip
            on a span is out of a screen reader's reach). */}
        <span className="toolbar-ocr-search-status" aria-live="polite" title={statusTitle}>
          <span className="toolbar-ocr-search-status-short" aria-hidden="true">{statusLine}</span>
          <span className="sr-only">{statusTitle}</span>
        </span>
        {/* The short text for the eye, the spelt-out one as the checkbox's name and tooltip. */}
        <label
          className={`toolbar-ocr-search-scope${pageOnly ? ' is-active' : ''}`}
          // A mouse click leaves the focus in the input, so Enter still steps (a focused
          // checkbox would be toggled back by it); keyboard focus reaches the checkbox as usual.
          onMouseDown={(event) => { event.preventDefault(); scopeByMouseRef.current = event.button === 0; }}
          title={pageOnlyLabel}
        >
          <input
            type="checkbox"
            className="toolbar-ocr-search-scope-input"
            checked={pageOnly}
            onKeyDown={() => { scopeByMouseRef.current = false; }}
            onChange={(event) => {
              setPageOnly(event.target.checked);
              if (scopeByMouseRef.current) {
                scopeByMouseRef.current = false;
                inputRef.current?.focus?.({ preventScroll: true });
              }
            }}
            aria-label={pageOnlyLabel}
            tabIndex={open ? 0 : -1}
          />
          <span className="toolbar-ocr-search-scope-text" aria-hidden="true">{pageOnlyShort}</span>
        </label>
        <button
          type="button"
          className="odv-btn toolbar-ocr-search-step"
          onClick={() => step(-1)}
          disabled={matches.length === 0}
          aria-label={t('ocr.search.previous', { defaultValue: 'Previous match' })}
          title={t('ocr.search.previous', { defaultValue: 'Previous match' })}
          tabIndex={open ? 0 : -1}
        >
          <span className="material-icons" aria-hidden="true">keyboard_arrow_up</span>
        </button>
        <button
          type="button"
          className="odv-btn toolbar-ocr-search-step"
          onClick={() => step(1)}
          disabled={matches.length === 0}
          aria-label={t('ocr.search.next', { defaultValue: 'Next match' })}
          title={t('ocr.search.next', { defaultValue: 'Next match' })}
          tabIndex={open ? 0 : -1}
        >
          <span className="material-icons" aria-hidden="true">keyboard_arrow_down</span>
        </button>
        <button
          type="button"
          className="odv-btn toolbar-ocr-search-close"
          onClick={close}
          aria-label={t('ocr.search.close', { defaultValue: 'Close the search' })}
          title={t('ocr.search.close', { defaultValue: 'Close the search' })}
          tabIndex={open ? 0 : -1}
        >
          <span className="material-icons" aria-hidden="true">close</span>
        </button>
      </div>
    </div>
  );
}

OcrSearchBar.propTypes = {
  pageNumber: PropTypes.number.isRequired,
  setPageNumber: PropTypes.func.isRequired,
  allPages: PropTypes.array,
  searchEnabled: PropTypes.bool,
  ctrlFOverride: PropTypes.bool,
};
