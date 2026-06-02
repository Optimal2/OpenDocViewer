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
 * @param {Object=} [props.pageLoadState]
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
import useAcceleratingHoldRepeat from '../../hooks/useAcceleratingHoldRepeat.js';

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
  pageLoadState = null,
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

  const inputRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const hasPages = Math.max(0, Number(totalPagesDisplay) || 0) > 0;
  const [draft, setDraft] = useState(hasPages ? String(pageNumberDisplay) : '0');
  const previousRepeat = useAcceleratingHoldRepeat({
    action: handlePrevPage,
    disabled: prevPageDisabled,
  });
  const nextRepeat = useAcceleratingHoldRepeat({
    action: handleNextPage,
    disabled: nextPageDisabled,
  });

  useEffect(() => {
    const el = inputRef.current;
    const focused = !!(el && document.activeElement === el) || isFocused;
    if (!focused) setDraft(hasPages ? String(pageNumberDisplay) : '0');
  }, [hasPages, pageNumberDisplay, isFocused]);

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
  const loadProgress = useMemo(() => {
    const total = Math.max(0, Number(pageLoadState?.expectedPages) || Number(totalPagesDisplay) || 0);
    const ready = Math.max(0, Number(pageLoadState?.readyPages) || 0);
    const failed = Math.max(0, Number(pageLoadState?.failedPages) || 0);
    const pending = Math.max(0, Number(pageLoadState?.pendingPages) || Math.max(0, total - ready - failed));
    const completed = Math.max(0, Math.min(total, ready + failed));
    const ratio = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;
    return {
      total,
      ready,
      failed,
      pending,
      completed,
      ratio,
      visible: isDocumentLoading && total > 0,
    };
  }, [
    isDocumentLoading,
    pageLoadState?.expectedPages,
    pageLoadState?.failedPages,
    pageLoadState?.pendingPages,
    pageLoadState?.readyPages,
    totalPagesDisplay,
  ]);
  const loadProgressText = loadProgress.visible
    ? t('toolbar.navigation.loadProgressShort', {
        completed: loadProgress.completed,
        total: loadProgress.total,
        defaultValue: `${loadProgress.completed}/${loadProgress.total}`,
      })
    : '';
  const loadProgressTitle = loadProgress.visible
    ? t('toolbar.navigation.loadProgressTitle', {
        ready: loadProgress.ready,
        failed: loadProgress.failed,
        pending: loadProgress.pending,
        total: loadProgress.total,
        defaultValue: `Loading pages: ${loadProgress.ready} ready, ${loadProgress.failed} failed, ${loadProgress.pending} remaining of ${loadProgress.total}.`,
      })
    : '';

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
        onClick={previousRepeat.onClick}
        onPointerDown={previousRepeat.onPointerDown}
        onMouseDown={previousRepeat.onMouseDown}
        onTouchStart={previousRepeat.onTouchStart}
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

      {loadProgress.visible ? (
        <span
          className="page-load-progress-badge"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={loadProgress.total}
          aria-valuenow={loadProgress.completed}
          aria-valuetext={loadProgressText}
          title={loadProgressTitle}
          style={{ '--odv-page-load-progress-ratio': String(loadProgress.ratio) }}
        >
          <span className="page-load-progress-track" aria-hidden="true">
            <span className="page-load-progress-fill" />
          </span>
          <span className="sr-only">{loadProgressText}</span>
        </span>
      ) : null}

      <button
        type="button"
        onClick={nextRepeat.onClick}
        onPointerDown={nextRepeat.onPointerDown}
        onMouseDown={nextRepeat.onMouseDown}
        onTouchStart={nextRepeat.onTouchStart}
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
  pageLoadState: PropTypes.shape({
    readyPages: PropTypes.number,
    expectedPages: PropTypes.number,
    failedPages: PropTypes.number,
    pendingPages: PropTypes.number,
  }),
  navigationTarget: PropTypes.oneOf(['primary', 'compare']),
  navigationScope: PropTypes.oneOf(['page', 'document']),
  navigationGroupTitle: PropTypes.string,
  firstButtonTitle: PropTypes.string,
  previousButtonTitle: PropTypes.string,
  nextButtonTitle: PropTypes.string,
  lastButtonTitle: PropTypes.string,
};

export default React.memo(PageNavigationButtons);
