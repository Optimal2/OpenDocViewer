// File: src/components/DocumentToolbar/PageNavigationButtons.jsx
/**
 * File: src/components/DocumentToolbar/PageNavigationButtons.jsx
 *
 * Page navigation controls with support for single-step clicks and
 * continuous stepping on press-and-hold (mouse/touch).
 *
 * The press-and-hold buttons trigger a leading-edge navigation step on pointer-down. The following
 * synthetic click is then consumed so a normal mouse press produces exactly one page step instead of
 * two. This keeps toolbar navigation deterministic while still allowing fast repeat on hold.
 *
 * Also includes an editable page field, grouped visually like the zoom control:
 *   [ « ][ ‹ ]  [  X / Y  ]  [ › ][ » ]
 * - When NOT focused, the field shows "X / Y".
 * - When focused, it shows only the current page "X" for editing.
 * - Enter/Blur applies (clamped 1..Y). Escape cancels and restores.
 * - During document loading the page field gets a warning-style background.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.prevPageDisabled - Disable "previous page".
 * @param {boolean} props.nextPageDisabled - Disable "next page".
 * @param {boolean} props.firstPageDisabled - Disable "first page".
 * @param {boolean} props.lastPageDisabled - Disable "last page".
 * @param {function(string, *=):void} props.startPrevPageTimer - Start the "prev" repeat timer.
 * @param {function():void} props.stopPrevPageTimer - Stop the "prev" repeat timer.
 * @param {function(string, *=):void} props.startNextPageTimer - Start the "next" repeat timer.
 * @param {function():void} props.stopNextPageTimer - Stop the "next" repeat timer.
 * @param {function(*=):void} props.handleFirstPage - Jump to first page.
 * @param {function(*=):void} props.handleLastPage - Jump to last page.
 * @param {function(*=):void} props.handlePrevPage - Single-step to previous page.
 * @param {function(*=):void} props.handleNextPage - Single-step to next page.
 * @param {number} props.pageNumber - Current page number (1-based).
 * @param {number} props.totalPages - Total pages.
 * @param {function(number):void} [props.onGoToPage] - Optional: apply a specific page number (1..totalPages).
 * @param {boolean} [props.isDocumentLoading=false] - Whether the document set is still loading.
 * @returns {JSX.Element}
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

function clampPage(n, total) {
  const t = Number.isFinite(total) && total > 0 ? Math.floor(total) : 1;
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.max(1, Math.min(t, v));
}

const PageNavigationButtons = ({
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
  startPrevPageTimer,
  stopPrevPageTimer,
  startNextPageTimer,
  stopNextPageTimer,
  handleFirstPage,
  handleLastPage,
  handlePrevPage,
  handleNextPage,
  pageNumber,
  totalPages,
  onGoToPage,
  isDocumentLoading = false,
}) => {
  const { t } = useTranslation();

  const suppressNextClickRef = useRef(false);
  const suppressResetTimerRef = useRef(/** @type {(number|null)} */ (null));
  const inputRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(String(pageNumber));

  useEffect(() => {
    const el = inputRef.current;
    const focused = !!(el && document.activeElement === el) || isFocused;
    if (!focused) setDraft(String(pageNumber));
  }, [pageNumber, isFocused]);

  /**
   * Stop every repeat timer but deliberately preserve click suppression until the follow-up click has
   * been seen. Otherwise a normal mouse press would fire once on pointer-down and once again on click.
   *
   * @returns {void}
   */
  const stopAllRepeatNavigation = useCallback(() => {
    stopPrevPageTimer();
    stopNextPageTimer();
    if (suppressResetTimerRef.current) {
      try { window.clearTimeout(suppressResetTimerRef.current); } catch {}
      suppressResetTimerRef.current = null;
    }
    if (suppressNextClickRef.current) {
      suppressResetTimerRef.current = window.setTimeout(() => {
        suppressNextClickRef.current = false;
        suppressResetTimerRef.current = null;
      }, 0);
    }
  }, [stopNextPageTimer, stopPrevPageTimer]);

  useEffect(() => {
    const handleRelease = () => {
      stopAllRepeatNavigation();
    };

    window.addEventListener('mouseup', handleRelease, { passive: true });
    window.addEventListener('touchend', handleRelease, { passive: true });
    window.addEventListener('touchcancel', handleRelease, { passive: true });
    window.addEventListener('blur', handleRelease, { passive: true });

    return () => {
      window.removeEventListener('mouseup', handleRelease);
      window.removeEventListener('touchend', handleRelease);
      window.removeEventListener('touchcancel', handleRelease);
      window.removeEventListener('blur', handleRelease);
    };
  }, [stopAllRepeatNavigation]);


  useEffect(() => () => {
    if (!suppressResetTimerRef.current) return;
    try { window.clearTimeout(suppressResetTimerRef.current); } catch {}
    suppressResetTimerRef.current = null;
  }, []);

  function applyDraft() {
    const next = clampPage(draft, totalPages);
    if (next == null) {
      setDraft(String(pageNumber));
      return;
    }
    if (typeof onGoToPage === 'function') onGoToPage(next);
    setDraft(String(next));
  }

  function cancelDraft() {
    setDraft(String(pageNumber));
  }

  /**
   * @param {*} event
   * @returns {void}
   */
  const beginPrevRepeat = useCallback((event) => {
    if (prevPageDisabled) return;
    event?.preventDefault?.();
    suppressNextClickRef.current = true;
    startPrevPageTimer('prev', event);
  }, [prevPageDisabled, startPrevPageTimer]);

  /**
   * @param {*} event
   * @returns {void}
   */
  const beginNextRepeat = useCallback((event) => {
    if (nextPageDisabled) return;
    event?.preventDefault?.();
    suppressNextClickRef.current = true;
    startNextPageTimer('next', event);
  }, [nextPageDisabled, startNextPageTimer]);

  /**
   * Consume the trailing click that naturally follows a leading-edge repeat press.
   *
   * @param {*} event
   * @param {function(*=):void} handler
   * @returns {void}
   */
  const handleSingleStepClick = useCallback((event, handler) => {
    if (suppressNextClickRef.current) {
      if (suppressResetTimerRef.current) {
        try { window.clearTimeout(suppressResetTimerRef.current); } catch {}
        suppressResetTimerRef.current = null;
      }
      suppressNextClickRef.current = false;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }
    handler?.(event);
  }, []);

  const displayValue = isFocused ? draft : `${pageNumber} / ${totalPages}`;
  const pageTitle = isDocumentLoading ? t('toolbar.pageLoadingTitle') : t('toolbar.page');

  return (
    <div
      className={`zoom-fixed-group${isDocumentLoading ? ' is-loading' : ''}`}
      role="group"
      aria-label={t('toolbar.page')}
      aria-busy={isDocumentLoading}
    >
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleFirstPage}
        aria-label={t('toolbar.firstPage')}
        title={t('toolbar.firstPage')}
        className="odv-btn"
        disabled={firstPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">first_page</span>
      </button>

      <button
        type="button"
        onClick={(event) => handleSingleStepClick(event, handlePrevPage)}
        onMouseDown={beginPrevRepeat}
        onMouseUp={stopAllRepeatNavigation}
        onMouseLeave={stopAllRepeatNavigation}
        onTouchStart={beginPrevRepeat}
        onTouchEnd={stopAllRepeatNavigation}
        aria-label={t('toolbar.previousPage')}
        title={t('toolbar.previousPage')}
        className="odv-btn"
        disabled={prevPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">chevron_left</span>
      </button>

      <input
        ref={inputRef}
        className={`page-number-input${isDocumentLoading ? ' is-loading' : ''}`}
        type="text"
        inputMode="numeric"
        value={displayValue}
        onFocus={(event) => {
          setIsFocused(true);
          setDraft(String(pageNumber));
          event.currentTarget.setSelectionRange(0, String(pageNumber).length);
        }}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => { applyDraft(); setIsFocused(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            applyDraft();
            setIsFocused(false);
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelDraft();
            setIsFocused(false);
            event.currentTarget.blur();
          }
        }}
        aria-label={pageTitle}
        role="spinbutton"
        aria-valuemin={1}
        aria-valuemax={Math.max(1, totalPages || 1)}
        aria-valuenow={pageNumber}
        aria-valuetext={t('toolbar.page') + ` ${pageNumber} / ${totalPages}`}
        aria-busy={isDocumentLoading}
        title={pageTitle}
      />

      <button
        type="button"
        onClick={(event) => handleSingleStepClick(event, handleNextPage)}
        onMouseDown={beginNextRepeat}
        onMouseUp={stopAllRepeatNavigation}
        onMouseLeave={stopAllRepeatNavigation}
        onTouchStart={beginNextRepeat}
        onTouchEnd={stopAllRepeatNavigation}
        aria-label={t('toolbar.nextPage')}
        title={t('toolbar.nextPage')}
        className="odv-btn"
        disabled={nextPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">chevron_right</span>
      </button>

      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleLastPage}
        aria-label={t('toolbar.lastPage')}
        title={t('toolbar.lastPage')}
        className="odv-btn"
        disabled={lastPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">last_page</span>
      </button>
    </div>
  );
};

PageNavigationButtons.propTypes = {
  prevPageDisabled: PropTypes.bool.isRequired,
  nextPageDisabled: PropTypes.bool.isRequired,
  firstPageDisabled: PropTypes.bool.isRequired,
  lastPageDisabled: PropTypes.bool.isRequired,
  startPrevPageTimer: PropTypes.func.isRequired,
  stopPrevPageTimer: PropTypes.func.isRequired,
  startNextPageTimer: PropTypes.func.isRequired,
  stopNextPageTimer: PropTypes.func.isRequired,
  handleFirstPage: PropTypes.func.isRequired,
  handleLastPage: PropTypes.func.isRequired,
  handlePrevPage: PropTypes.func.isRequired,
  handleNextPage: PropTypes.func.isRequired,
  pageNumber: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  onGoToPage: PropTypes.func,
  isDocumentLoading: PropTypes.bool,
};

export default React.memo(PageNavigationButtons);
