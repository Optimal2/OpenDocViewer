// File: src/components/DocumentToolbar/PageNavigationButtons.jsx
/**
 * File: src/components/DocumentToolbar/PageNavigationButtons.jsx
 *
 * Page navigation controls with support for single-step clicks and
 * continuous stepping on press-and-hold (mouse/touch).
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
 * @param {boolean} [props.isDocumentLoading=false] - Whether the document set is still loading.
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
  isDocumentLoading = false,
}) => {
  const { t } = useTranslation();

  const suppressNextClickRef = useRef(false);
  const inputRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(String(pageNumber));

  useEffect(() => {
    const el = inputRef.current;
    const focused = !!(el && document.activeElement === el) || isFocused;
    if (!focused) setDraft(String(pageNumber));
  }, [pageNumber, isFocused]);

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

  const onTouchStartPrev = (e) => {
    if (!prevPageDisabled) {
      e.preventDefault();
      suppressNextClickRef.current = true;
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

  const onClickPrev = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
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
        onClick={onClickPrev}
        onMouseDown={() => {
          if (!prevPageDisabled) {
            suppressNextClickRef.current = true;
            startPrevPageTimer('prev');
          }
        }}
        onMouseUp={stopPrevPageTimer}
        onMouseLeave={() => {
          stopPrevPageTimer();
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

      <input
        ref={inputRef}
        className={`page-number-input${isDocumentLoading ? ' is-loading' : ''}`}
        type="text"
        inputMode="numeric"
        pattern="[0-9 /]*"
        value={displayValue}
        onFocus={(e) => {
          setIsFocused(true);
          setDraft(String(pageNumber));
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
  onGoToPage: PropTypes.func,
  isDocumentLoading: PropTypes.bool,
};

export default React.memo(PageNavigationButtons);
