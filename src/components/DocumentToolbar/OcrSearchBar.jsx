// File: src/components/DocumentToolbar/OcrSearchBar.jsx
/**
 * Search in the recognised text, from the toolbar: a search button to the right of the
 * toolbar's end group that doubles as the page's OCR status (an LED on the button, the status
 * as its tooltip and in a visually hidden live region; the button is enabled once the displayed
 * page's text is recognised, or any page's when the displayed page has none), and a field that
 * grows out of it to the right (a short width transition, styles/ocr.css) with the match
 * position, previous/next and close. The field takes only the room the toolbar's spacer leaves
 * (measured when it opens and when the window is resized, utils/ocrSearchPlacement.js); with
 * too little room it hangs under the toolbar at the button's right edge instead, so the toolbar
 * never overflows for it.
 *
 * The search covers the recognised text of every page that has an outcome, in page order
 * (utils/ocrSearch.js: case-insensitive, a phrase also across a line break), and nothing else
 * on the page. Typing finds the matches and makes the first one on the displayed page current
 * without leaving the page; Enter and the arrows walk the matches, moving to a match's page
 * when it is another one. The current term and match are published to the viewer
 * (ViewerContext `ocrSearch`), where the text layer marks the matches on its page and scrolls
 * the current one into view. While not every page has an outcome yet, the status says how
 * many pages the search covers. Page numbers here are original session page numbers (they
 * index `allPages` and are what `setPageNumber` takes), not ordinals among the visible pages.
 * Mounted by DocumentToolbar only while `ocr.enabled` is the literal true.
 */
import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import ViewerContext from '../../contexts/viewerContext.js';
import StatusLed from '../common/StatusLed.jsx';
import { ocrPageKeyOf } from '../../utils/ocrPageKey.js';
import { hasSearchableOcrText, OCR_STATUS_FALLBACK, OCR_STATUS_LED, ocrStatusKeyOf } from '../../utils/ocrStatus.js';
import { normalizeOcrSearchTerm, searchOcrPages } from '../../utils/ocrSearch.js';
import { measureOcrSearchPlacement, OCR_SEARCH_PANEL_WIDTH } from '../../utils/ocrSearchPlacement.js';

/** @param {{ pageKey:string, ordinal:number }} match */
const matchIdOf = (match) => `${match.pageKey}\u001f${match.ordinal}`;

/**
 * @param {Object} props
 * @param {number} props.pageNumber  Original session page number (1-based) of the displayed
 *   page: DocumentToolbar's `pageNumberDisplay`.
 * @param {function(number): void} props.setPageNumber  Takes an original session page number.
 * @param {Array<Object>} props.allPages  The viewer's pages.
 * @returns {React.ReactElement}
 */
export default function OcrSearchBar({ pageNumber, setPageNumber, allPages }) {
  const { t } = useTranslation('common');
  const { ocrPages, ocrEngineFailure, setOcrSearch } = useContext(ViewerContext);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [currentId, setCurrentId] = useState(/** @type {(string|null)} */ (null));
  const inputRef = useRef(/** @type {(HTMLInputElement|null)} */ (null));
  const buttonRef = useRef(/** @type {(HTMLButtonElement|null)} */ (null));
  const rootRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const panelRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const panelId = useId();
  const [placement, setPlacement] = useState({ mode: 'inline', width: OCR_SEARCH_PANEL_WIDTH, offset: 0, top: 0 });
  // The match whose page was last asked for: a match on a page the print selection hides lands
  // on the nearest shown page, and the next step must then move on instead of asking again.
  // Forgotten with a new term and when the displayed page changes (then the current match's
  // page is shown first again).
  const shownMatchRef = useRef(/** @type {(string|null)} */ (null));

  const pages = useMemo(() => (Array.isArray(allPages) ? allPages : []), [allPages]);
  const displayedIndex = Math.max(0, (Number(pageNumber) || 1) - 1);
  const displayedPage = pages[displayedIndex] || null;
  const displayedEntry = displayedPage && ocrPages ? ocrPages[ocrPageKeyOf(displayedPage)] || null : null;
  const statusKey = ocrStatusKeyOf(displayedEntry, ocrEngineFailure);
  const statusText = statusKey
    ? t(`ocr.status.${statusKey}`, { defaultValue: OCR_STATUS_FALLBACK[statusKey] })
    : t('ocr.status.notStarted', { defaultValue: 'Text recognition has not started on this page' });

  // Every page with its outcome, in page order; the search runs over the ones with text.
  const searchablePages = useMemo(() => pages.map((page, index) => {
    const pageKey = ocrPageKeyOf(page);
    return { pageKey, pageIndex: index, pageNumber: index + 1, outcome: (ocrPages && ocrPages[pageKey]) || null };
  }), [ocrPages, pages]);
  const recognisedPages = useMemo(
    () => searchablePages.filter((page) => page.outcome?.status === 'done').length,
    [searchablePages]
  );
  // The displayed page's text, or (a page without text, skipped or failed) any page's.
  const ready = hasSearchableOcrText(displayedEntry)
    || searchablePages.some((page) => hasSearchableOcrText(page.outcome));
  const normalizedTerm = normalizeOcrSearchTerm(term);
  const matches = useMemo(
    () => (open && normalizedTerm ? searchOcrPages(searchablePages, normalizedTerm) : []),
    [normalizedTerm, open, searchablePages]
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
  }, [current, currentId, open]);

  // Publish the term and the current match for the text layers (marks and scrolling).
  useEffect(() => {
    if (typeof setOcrSearch !== 'function') return undefined;
    if (!open || !normalizedTerm) {
      setOcrSearch(null);
      return undefined;
    }
    setOcrSearch({
      term: normalizedTerm,
      current: current ? { pageKey: current.pageKey, ordinal: current.ordinal } : null,
    });
    return undefined;
  }, [current, normalizedTerm, open, setOcrSearch]);

  useEffect(() => () => {
    if (typeof setOcrSearch === 'function') setOcrSearch(null);
  }, [setOcrSearch]);

  // Where the field goes: measured as it opens (the field is still closed, so the spacer shows
  // the room) and again while it is open whenever the window is resized or the toolbar or its
  // spacer changes size (another toolbar density, a button appearing, the signature overview).
  // The anchor is the button: the root also holds the open inline field.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => setPlacement(measureOcrSearchPlacement(rootRef.current, panelRef.current, buttonRef.current));
    place();
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('resize', place);
    let observer = null;
    const toolbar = rootRef.current?.closest?.('.toolbar');
    if (toolbar && typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(place);
      observer.observe(toolbar);
      const spacer = toolbar.querySelector('.toolbar-spacer');
      if (spacer) observer.observe(spacer);
    }
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus?.();
  }, [open]);

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
  }, [normalizedTerm, pageNumber]);

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

  const openLabel = t('ocr.search.open', { defaultValue: 'Search in the recognised text' });
  const buttonTitle = ready || open ? `${openLabel} · ${statusText}` : statusText;
  let statusLine = '';
  if (normalizedTerm) {
    statusLine = matches.length === 0
      ? t('ocr.search.none', { defaultValue: 'No matches' })
      : t('ocr.search.position', { current: currentPosition + 1, total: matches.length, defaultValue: '{current} of {total}' });
    if (recognisedPages < pages.length) {
      statusLine += ` · ${t('ocr.search.coverage', { done: recognisedPages, pages: pages.length, defaultValue: '{done} of {pages} pages recognised' })}`;
    }
  }

  return (
    <div ref={rootRef} className={`toolbar-ocr-search${open ? ' is-open' : ''}`} data-odv-ocr="search">
      <button
        ref={buttonRef}
        type="button"
        className={`odv-btn odv-btn--with-status-led toolbar-ocr-search-toggle${open ? ' is-active' : ''}`}
        data-odv-ocr="status"
        data-ocr-state={statusKey || 'notStarted'}
        aria-label={openLabel}
        title={buttonTitle}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={!ready && !open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="material-icons" aria-hidden="true">search</span>
        <StatusLed state={OCR_STATUS_LED[statusKey] || 'off'} size="xs" title={statusText} className="odv-toolbar-runtime-led" />
      </button>
      <span className="sr-only" role="status" aria-live="polite" data-odv-ocr="status-text">{statusText}</span>
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
        <span className="toolbar-ocr-search-status" aria-live="polite">{statusLine}</span>
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
};
