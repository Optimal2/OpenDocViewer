// File: src/components/DocumentToolbar/PageNavigationButtons.jsx
/**
 * Page navigation controls with support for single-step clicks and continuous stepping on press-and-hold.
 *
 * The press-and-hold buttons trigger a leading-edge navigation step on pointer-down. The following
 * synthetic click is then consumed so a normal mouse press produces exactly one step instead of
 * two. The group can also expose the currently active navigation target/scope so the toolbar may
 * visually indicate whether actions affect the primary pane, the compare pane, pages, or documents.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.prevPageDisabled
 * @param {boolean} props.nextPageDisabled
 * @param {boolean} props.firstPageDisabled
 * @param {boolean} props.lastPageDisabled
 * @param {function():void} props.stopPrevPageTimer
 * @param {function():void} props.stopNextPageTimer
 * @param {function(*=):void} props.handleFirstPage
 * @param {function(*=):void} props.handleLastPage
 * @param {function(*=):void} props.handlePrevPage
 * @param {function(*=):void} props.handleNextPage
 * @param {number} props.pageNumber
 * @param {number} [props.pageNumberDisplay]
 * @param {number} props.totalPages
 * @param {number} [props.totalPagesDisplay]
 * @param {function(number):void} [props.onGoToPage]
 * @param {boolean} [props.isDocumentLoading=false]
 * @param {'primary'|'compare'} [props.navigationTarget='primary']
 * @param {'page'|'document'} [props.navigationScope='page']
 * @param {string} [props.navigationGroupTitle]
 * @param {string} [props.firstButtonTitle]
 * @param {string} [props.previousButtonTitle]
 * @param {string} [props.nextButtonTitle]
 * @param {string} [props.lastButtonTitle]
 * @returns {JSX.Element}
 */

import React, { useRef, useState, useEffect, useCallback, useId, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

function clampPage(n, total) {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 1;
  const value = Math.floor(Number(n));
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.min(safeTotal, value));
}

const PageNavigationButtons = ({
  prevPageDisabled,
  nextPageDisabled,
  firstPageDisabled,
  lastPageDisabled,
  stopPrevPageTimer,
  stopNextPageTimer,
  handleFirstPage,
  handleLastPage,
  handlePrevPage,
  handleNextPage,
  pageNumber,
  pageNumberDisplay = pageNumber,
  totalPages,
  totalPagesDisplay = totalPages,
  onGoToPage,
  isDocumentLoading = false,
  navigationTarget = 'primary',
  navigationScope = 'page',
  navigationGroupTitle = '',
  firstButtonTitle,
  previousButtonTitle,
  nextButtonTitle,
  lastButtonTitle,
}) => {
  const { t } = useTranslation();
  const groupId = useId();

  const SUPPRESS_CLICK_WINDOW_MS = 400;
  const REPEAT_INITIAL_DELAY_MS = 500;
  const REPEAT_INTERVAL_MS = 50;
  const DUPLICATE_REPEAT_START_WINDOW_MS = 120;
  const suppressClickUntilRef = useRef({ prev: 0, next: 0 });
  const activeRepeatButtonRef = useRef(/** @type {('prev'|'next'|null)} */ (null));
  const repeatStartStateRef = useRef({ key: null, until: 0 });
  const repeatDelayTimerRef = useRef(null);
  const repeatIntervalRef = useRef(null);
  const inputRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const hasPages = Math.max(0, Number(totalPagesDisplay) || 0) > 0;
  const [draft, setDraft] = useState(hasPages ? String(pageNumberDisplay) : '0');

  useEffect(() => {
    const el = inputRef.current;
    const focused = !!(el && document.activeElement === el) || isFocused;
    if (!focused) setDraft(hasPages ? String(pageNumberDisplay) : '0');
  }, [hasPages, pageNumberDisplay, isFocused]);

  /**
   * @param {'prev'|'next'} key
   * @returns {void}
   */
  const markSuppressedClick = useCallback((key) => {
    const now = typeof performance !== 'undefined' && Number.isFinite(performance.now())
      ? performance.now()
      : Date.now();
    suppressClickUntilRef.current[key] = now + SUPPRESS_CLICK_WINDOW_MS;
  }, []);

  /**
   * @returns {void}
   */
  const clearLocalRepeatTimers = useCallback(() => {
    if (repeatDelayTimerRef.current != null) {
      window.clearTimeout(repeatDelayTimerRef.current);
      repeatDelayTimerRef.current = null;
    }
    if (repeatIntervalRef.current != null) {
      window.clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
  }, []);

  /**
   * @returns {void}
   */
  const stopAllRepeatNavigation = useCallback(() => {
    clearLocalRepeatTimers();
    stopPrevPageTimer();
    stopNextPageTimer();
    const activeKey = activeRepeatButtonRef.current;
    if (activeKey === 'prev' || activeKey === 'next') {
      markSuppressedClick(activeKey);
    }
    activeRepeatButtonRef.current = null;
    repeatStartStateRef.current = { key: null, until: 0 };
  }, [clearLocalRepeatTimers, markSuppressedClick, stopNextPageTimer, stopPrevPageTimer]);

  useEffect(() => {
    const handleRelease = () => {
      stopAllRepeatNavigation();
    };

    window.addEventListener('pointerup', handleRelease, { passive: true });
    window.addEventListener('mouseup', handleRelease, { passive: true });
    window.addEventListener('touchend', handleRelease, { passive: true });
    window.addEventListener('touchcancel', handleRelease, { passive: true });
    window.addEventListener('blur', handleRelease, { passive: true });

    return () => {
      window.removeEventListener('pointerup', handleRelease);
      window.removeEventListener('mouseup', handleRelease);
      window.removeEventListener('touchend', handleRelease);
      window.removeEventListener('touchcancel', handleRelease);
      window.removeEventListener('blur', handleRelease);
      clearLocalRepeatTimers();
    };
  }, [clearLocalRepeatTimers, stopAllRepeatNavigation]);

  const applyDraft = useCallback(() => {
    if (!hasPages) {
      setDraft('0');
      return;
    }
    const next = clampPage(draft, totalPagesDisplay);
    if (next == null) {
      setDraft(String(pageNumberDisplay));
      return;
    }
    if (typeof onGoToPage === 'function') onGoToPage(next);
    setDraft(String(next));
  }, [draft, hasPages, onGoToPage, pageNumberDisplay, totalPagesDisplay]);

  const cancelDraft = useCallback(() => {
    setDraft(hasPages ? String(pageNumberDisplay) : '0');
  }, [hasPages, pageNumberDisplay]);

  /**
   * @param {*} event
   * @returns {{shiftKey:boolean,ctrlKey:boolean,altKey:boolean,metaKey:boolean,preventDefault:function():void,stopPropagation:function():void}}
   */
  const createRepeatEventSnapshot = useCallback((event) => ({
    shiftKey: !!event?.shiftKey,
    ctrlKey: !!event?.ctrlKey,
    altKey: !!event?.altKey,
    metaKey: !!event?.metaKey,
    preventDefault() {},
    stopPropagation() {},
  }), []);

  /**
   * @param {'prev'|'next'} key
   * @param {*} event
   * @param {function(*=):void} handler
   * @returns {void}
   */
  const startLocalRepeatNavigation = useCallback((key, event, handler) => {
    const now = typeof performance !== 'undefined' && Number.isFinite(performance.now())
      ? performance.now()
      : Date.now();
    const repeatStartState = repeatStartStateRef.current || {};
    if (repeatStartState.key === key && Number(repeatStartState.until || 0) > now) {
      event?.preventDefault?.();
      return;
    }
    repeatStartStateRef.current = {
      key,
      until: now + DUPLICATE_REPEAT_START_WINDOW_MS,
    };

    clearLocalRepeatTimers();
    event?.preventDefault?.();
    activeRepeatButtonRef.current = key;
    markSuppressedClick(key);

    const eventSnapshot = createRepeatEventSnapshot(event);
    handler?.(eventSnapshot);

    repeatDelayTimerRef.current = window.setTimeout(() => {
      repeatDelayTimerRef.current = null;
      repeatIntervalRef.current = window.setInterval(() => {
        if (activeRepeatButtonRef.current !== key) return;
        handler?.(eventSnapshot);
      }, REPEAT_INTERVAL_MS);
    }, REPEAT_INITIAL_DELAY_MS);
  }, [clearLocalRepeatTimers, createRepeatEventSnapshot, markSuppressedClick]);

  /**
   * @param {*} event
   * @returns {void}
   */
  const beginPrevRepeat = useCallback((event) => {
    if (prevPageDisabled) return;
    if (typeof event?.button === 'number' && event.button !== 0) return;
    startLocalRepeatNavigation('prev', event, handlePrevPage);
  }, [handlePrevPage, prevPageDisabled, startLocalRepeatNavigation]);

  /**
   * @param {*} event
   * @returns {void}
   */
  const beginNextRepeat = useCallback((event) => {
    if (nextPageDisabled) return;
    if (typeof event?.button === 'number' && event.button !== 0) return;
    startLocalRepeatNavigation('next', event, handleNextPage);
  }, [handleNextPage, nextPageDisabled, startLocalRepeatNavigation]);

  /**
   * @param {*} event
   * @param {'prev'|'next'} key
   * @param {function(*=):void} handler
   * @returns {void}
   */
  const handleSingleStepClick = useCallback((event, key, handler) => {
    const now = typeof performance !== 'undefined' && Number.isFinite(performance.now())
      ? performance.now()
      : Date.now();
    const suppressUntil = Number(suppressClickUntilRef.current[key] || 0);
    if (suppressUntil > now) {
      suppressClickUntilRef.current[key] = 0;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }
    suppressClickUntilRef.current[key] = 0;
    handler?.(event);
  }, []);

  const groupTitle = navigationGroupTitle || t('toolbar.page');
  const pageTitle = !hasPages
    ? t('toolbar.navigation.noPagesTitle', { defaultValue: 'No visible pages available' })
    : (isDocumentLoading ? t('toolbar.pageLoadingTitle') : t('toolbar.page'));
  const resolvedFirstButtonTitle = firstButtonTitle || t('toolbar.firstPage');
  const resolvedPreviousButtonTitle = previousButtonTitle || t('toolbar.previousPage');
  const resolvedNextButtonTitle = nextButtonTitle || t('toolbar.nextPage');
  const resolvedLastButtonTitle = lastButtonTitle || t('toolbar.lastPage');
  const displayValue = hasPages
    ? (isFocused ? draft : `${pageNumberDisplay} / ${totalPagesDisplay}`)
    : '0 / 0';
  const navigationTargetClass = navigationTarget === 'compare'
    ? 'navigation-target-compare'
    : 'navigation-target-primary';
  const navigationScopeClass = navigationScope === 'document'
    ? 'navigation-scope-document'
    : 'navigation-scope-page';
  const descriptionId = `${groupId}-description`;
  const statusId = `${groupId}-status`;
  const scopeDescription = navigationScope === 'document'
    ? t('toolbar.navigation.scopeDocument', { defaultValue: 'Document navigation' })
    : t('toolbar.navigation.scopePage', { defaultValue: 'Page navigation' });
  const targetDescription = navigationTarget === 'compare'
    ? t('toolbar.navigation.targetCompare', { defaultValue: 'right compare pane' })
    : t('toolbar.navigation.targetPrimary', { defaultValue: 'primary / left pane' });
  const navigationDescription = useMemo(() => t('toolbar.navigation.groupDescription', {
    scope: scopeDescription,
    target: targetDescription,
    defaultValue: `${scopeDescription} for ${targetDescription}.`,
  }), [scopeDescription, t, targetDescription]);
  const loadingAnnouncement = !hasPages
    ? t('toolbar.navigation.noPagesAnnounce', { defaultValue: 'No visible pages are currently available.' })
    : (isDocumentLoading
      ? t('toolbar.navigation.loadingAnnounce', { defaultValue: 'Page navigation is still loading.' })
      : t('toolbar.navigation.readyAnnounce', { defaultValue: 'Page navigation is ready.' }));

  return (
    <div
      className={`zoom-fixed-group page-navigation-group ${navigationTargetClass} ${navigationScopeClass}${isDocumentLoading ? ' is-loading' : ''}`}
      role="group"
      aria-label={groupTitle}
      aria-describedby={`${descriptionId} ${statusId}`}
      title={groupTitle}
      aria-busy={isDocumentLoading}
    >
      <span id={descriptionId} className="sr-only">{navigationDescription}</span>
      <span id={statusId} className="sr-only" role="status" aria-live="polite">{loadingAnnouncement}</span>

      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleFirstPage}
        aria-label={resolvedFirstButtonTitle}
        title={resolvedFirstButtonTitle}
        className="odv-btn"
        disabled={firstPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">first_page</span>
      </button>

      <button
        type="button"
        onClick={(event) => handleSingleStepClick(event, 'prev', handlePrevPage)}
        onPointerDown={beginPrevRepeat}
        onMouseDown={beginPrevRepeat}
        onMouseUp={stopAllRepeatNavigation}
        onTouchStart={beginPrevRepeat}
        onTouchEnd={stopAllRepeatNavigation}
        aria-label={resolvedPreviousButtonTitle}
        title={resolvedPreviousButtonTitle}
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
        disabled={!hasPages}
        onFocus={(event) => {
          setIsFocused(true);
          setDraft(hasPages ? String(pageNumberDisplay) : '0');
          event.currentTarget.setSelectionRange(0, String(hasPages ? pageNumberDisplay : 0).length);
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
        aria-valuemin={hasPages ? 1 : 0}
        aria-valuemax={Math.max(0, totalPagesDisplay || 0)}
        aria-valuenow={hasPages ? pageNumberDisplay : 0}
        aria-valuetext={hasPages
          ? `${t('toolbar.page')} ${pageNumberDisplay} / ${totalPagesDisplay}`
          : t('toolbar.navigation.noPagesTitle', { defaultValue: 'No visible pages available' })}
        aria-busy={isDocumentLoading}
        aria-describedby={`${descriptionId} ${statusId}`}
        title={groupTitle}
      />

      <button
        type="button"
        onClick={(event) => handleSingleStepClick(event, 'next', handleNextPage)}
        onPointerDown={beginNextRepeat}
        onMouseDown={beginNextRepeat}
        onMouseUp={stopAllRepeatNavigation}
        onTouchStart={beginNextRepeat}
        onTouchEnd={stopAllRepeatNavigation}
        aria-label={resolvedNextButtonTitle}
        title={resolvedNextButtonTitle}
        className="odv-btn"
        disabled={nextPageDisabled}
      >
        <span className="material-icons" aria-hidden="true">chevron_right</span>
      </button>

      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleLastPage}
        aria-label={resolvedLastButtonTitle}
        title={resolvedLastButtonTitle}
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
  stopPrevPageTimer: PropTypes.func.isRequired,
  stopNextPageTimer: PropTypes.func.isRequired,
  handleFirstPage: PropTypes.func.isRequired,
  handleLastPage: PropTypes.func.isRequired,
  handlePrevPage: PropTypes.func.isRequired,
  handleNextPage: PropTypes.func.isRequired,
  pageNumber: PropTypes.number.isRequired,
  pageNumberDisplay: PropTypes.number,
  totalPages: PropTypes.number.isRequired,
  totalPagesDisplay: PropTypes.number,
  onGoToPage: PropTypes.func,
  isDocumentLoading: PropTypes.bool,
  navigationTarget: PropTypes.oneOf(['primary', 'compare']),
  navigationScope: PropTypes.oneOf(['page', 'document']),
  navigationGroupTitle: PropTypes.string,
  firstButtonTitle: PropTypes.string,
  previousButtonTitle: PropTypes.string,
  nextButtonTitle: PropTypes.string,
  lastButtonTitle: PropTypes.string,
};

export default React.memo(PageNavigationButtons);
