// File: src/components/DocumentToolbar/PageNavigationButtons.jsx
/**
 * File: src/components/DocumentToolbar/PageNavigationButtons.jsx
 *
 * Page navigation controls with support for single-step clicks and
 * continuous stepping on press-and-hold (mouse/touch).
 *
 * Now also includes an editable page field, grouped visually like the zoom control:
 *   [ « ][ ‹ ]  [  X / Y  ]  [ › ][ » ]
 * - When NOT focused, the field shows "X / Y".
 * - When focused, it shows only the current page "X" for editing.
 * - Enter/Blur applies (clamped 1..Y). Escape cancels and restores.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.prevPageDisabled - Disable "previous page".
 * @param {boolean} props.nextPageDisabled - Disable "next page".
 * @param {boolean} props.firstPageDisabled - Disable "first page".
 * @param {boolean} props.lastPageDisabled - Disable "last page".
 * @param {function(string):void} props.startPrevPageTimer - Start the "prev" repeat timer.
 * @param {function():void} props.stopPrevPageTimer - Stop the "prev" repeat timer.
 * @param {function(string):void} props.startNextPageTimer - Start the "next" repeat timer.
 * @param {function():void} props.stopNextPageTimer - Stop the "next" repeat timer.
 * @param {function():void} props.handleFirstPage - Jump to first page.
 * @param {function():void} props.handleLastPage - Jump to last page.
 * @param {function():void} props.handlePrevPage - Single-step to previous page.
 * @param {function():void} props.handleNextPage - Single-step to next page.
 * @param {number} props.pageNumber - Current page number (1-based).
 * @param {number} props.totalPages - Total pages.
 * @param {function(number):void} [props.onGoToPage] - Optional: apply a specific page number (1..totalPages).
 * @returns {JSX.Element}
 */

import React, { useRef, useState, useEffect } from 'react';
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
}) => {
  const { t } = useTranslation();

  // Suppress the subsequent onClick if a pointer press already caused a leading-edge step.
  const suppressNextClickRef = useRef(false);

  // Local draft for the editable page input
  const inputRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(String(pageNumber));

  // Keep draft in sync with external page when the field is not focused.
  useEffect(() => {
    const el = inputRef.current;
    const focused = !!(el && document.activeElement === el) || isFocused;
    if (!focused) setDraft(String(pageNumber));
  }, [pageNumber, isFocused]);

  function applyDraft() {
    // Parse and clamp
    const next = clampPage(draft, totalPages);
    if (next == null) {
      // Revert if parse failed
      setDraft(String(pageNumber));
      return;
    }
    if (typeof onGoToPage === 'function') {
      onGoToPage(next);
    }
    setDraft(String(next));
  }

  function cancelDraft() {
    setDraft(String(pageNumber));
  }

  // Touch helpers so press-and-hold also works on touch devices without scrolling the page.
  const onTouchStartPrev = (e) => {
    if (!prevPageDisabled) {
      e.preventDefault();
      suppressNextClickRef.current = true; // leading-edge step will occur via timer
      startPrevPageTimer('prev');
    }
  };
  const onTouchStartNext = (e) => {
    if (!nextPageDisabled) {
      e.preventDefault();
      suppressNextClickRef.current = true;
      startNextPageTimer('next');
    }
  };

  // Click handlers that respect suppression (so a press that already stepped once won’t step again).
  const onClickPrev = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return; // skip duplicate step
    }
    handlePrevPage();
  };
  const onClickNext = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    handleNextPage();
  };

  // Unfocused display shows "X / Y"; focused shows just "X"
  const displayValue = isFocused ? draft : `${pageNumber} / ${totalPages}`;

  return (
    <div className="zoom-fixed-group" role="group" aria-label={t('toolbar.page')}>
      {/* First page */}
      <button
        type="button"
        onClick={handleFirstPage}
        aria-label={t('toolbar.firstPage')}
        title={t('toolbar.firstPage')}
        className="odv-btn"
        disabled={firstPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">first_page</span>
      </button>

      {/* Previous (click = single step; press & hold = continuous) */}
      <button
        type="button"
        onClick={onClickPrev}
        onMouseDown={() => {
          if (!prevPageDisabled) {
            suppressNextClickRef.current = true; // leading-edge step via timer
            startPrevPageTimer('prev');
          }
        }}
        onMouseUp={stopPrevPageTimer}
        onMouseLeave={() => {
          stopPrevPageTimer();
          // If the pointer left the button, a click won’t follow; clear suppression to avoid stickiness.
          suppressNextClickRef.current = false;
        }}
        onTouchStart={onTouchStartPrev}
        onTouchEnd={stopPrevPageTimer}
        aria-label={t('toolbar.previousPage')}
        title={t('toolbar.previousPage')}
        className="odv-btn"
        disabled={prevPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">chevron_left</span>
      </button>

      {/* Editable page number */}
      <input
        ref={inputRef}
        className="page-number-input"
        type="text"
        inputMode="numeric"
        pattern="[0-9\s/]*"
        value={displayValue}
        onFocus={(e) => {
          setIsFocused(true);
          setDraft(String(pageNumber));
          // Select number for quick replacement
          e.currentTarget.setSelectionRange(0, String(pageNumber).length);
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => { applyDraft(); setIsFocused(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            applyDraft();
            setIsFocused(false);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelDraft();
            setIsFocused(false);
            e.currentTarget.blur();
          }
        }}
        aria-label={t('toolbar.page')}
        role="spinbutton"
        aria-valuemin={1}
        aria-valuemax={Math.max(1, totalPages || 1)}
        aria-valuenow={pageNumber}
        aria-valuetext={t('toolbar.page') + ` ${pageNumber} / ${totalPages}`}
        title={t('toolbar.page')}
      />

      {/* Next (click = single step; press & hold = continuous) */}
      <button
        type="button"
        onClick={onClickNext}
        onMouseDown={() => {
          if (!nextPageDisabled) {
            suppressNextClickRef.current = true;
            startNextPageTimer('next');
          }
        }}
        onMouseUp={stopNextPageTimer}
        onMouseLeave={() => {
          stopNextPageTimer();
          suppressNextClickRef.current = false;
        }}
        onTouchStart={onTouchStartNext}
        onTouchEnd={stopNextPageTimer}
        aria-label={t('toolbar.nextPage')}
        title={t('toolbar.nextPage')}
        className="odv-btn"
        disabled={nextPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">chevron_right</span>
      </button>

      {/* Last page */}
      <button
        type="button"
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
  onGoToPage: PropTypes.func, // optional for backward-compat
};

export default React.memo(PageNavigationButtons);
