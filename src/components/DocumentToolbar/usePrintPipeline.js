// File: src/components/DocumentToolbar/usePrintPipeline.js
/**
 * File: src/components/DocumentToolbar/usePrintPipeline.js
 *
 * The ONE print pipeline of the viewer: print dialog target, print options, user print log, the
 * direct-versus-generated-PDF decision, the PDF caches and the PDF progress state.
 *
 * DocumentViewer.jsx owns the single instance, so it stays mounted while a compare view (overlay or
 * curtain) replaces the toolbar. The toolbar, the overlay view and the curtain view all open the
 * same dialog (rendered by PrintPipelineDialogs.jsx) and submit through the same path:
 *
 * - The toolbar opens the dialog without a target: the existing page/range/selection/side-by-side
 *   prints.
 * - A compare view opens it with a target `{ view, primaryRenderRef, compareRenderRef, getView }`;
 *   the dialog then offers only the composed page, and on submit the view's CURRENT state is read
 *   through `getView()` and printed as ONE page (printCore.js / printPdf.js). The user log row has
 *   the same shape as the side-by-side compare print, with pageCount 1.
 *
 * @module usePrintPipeline
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import userLog from '../../logging/userLogger.js';
import logger from '../../logging/systemLogger.js';
import { handlePrint, handlePrintAll, handlePrintCurrentComparison, handlePrintCompareOverlay, handlePrintCompareCurtain, handlePrintRange, handlePrintSequence, handlePdfOutput, handlePdfCurrent, handlePdfCurrentComparison, handlePdfCompareOverlay, handlePdfCompareCurtain, downloadPdfBlob, printPdfBlob } from '../../utils/printUtils.js';
import usePdfPrebuildAllPages from './usePdfPrebuildAllPages.js';
import { getRuntimeConfig, isCompareOverlayEnabled, isCompareCurtainEnabled, isCompareOverlayPrintEnabled, isCompareCurtainPrintEnabled } from '../../utils/runtimeConfig.js';
import {
  canReuseGeneratedPdfPrint,
  getPdfPrintCacheKey,
  getPdfPrintCacheKeyOptions,
} from '../../utils/pdfPrintCacheKey.js';

export const EMPTY_PDF_PROGRESS = Object.freeze({ open: false, action: '', phase: '', current: 0, progressValue: 0, page: 0, total: 0, error: '', minimized: false });

/**
 * Compare views that print as one composed page, with their print helpers.
 * @type {Readonly<Record<string, { print: Function, pdf: Function }>>}
 */
const COMPOSED_VIEW_PRINTERS = Object.freeze({
  overlay: { print: handlePrintCompareOverlay, pdf: handlePdfCompareOverlay },
  curtain: { print: handlePrintCompareCurtain, pdf: handlePdfCompareCurtain },
});

/** Read capability at use time, including delayed submits from a stale dialog. */
function canPrintComposedView(view) {
  return view === 'overlay' ? isCompareOverlayEnabled() && isCompareOverlayPrintEnabled()
    : view === 'curtain' && isCompareCurtainEnabled() && isCompareCurtainPrintEnabled();
}

/**
 * @param {*} error
 * @returns {boolean}
 */
function isPdfAbortError(error) {
  return String(error?.name || '') === 'AbortError';
}

/**
 * True for the dialog detail of a compare-view print (`activeScope` `compare-overlay` /
 * `compare-curtain`): both compared pages composed onto one page.
 * @param {*} detail
 * @returns {boolean}
 */
export function isComposedCompareDetail(detail) {
  return detail?.mode === 'active'
    && (detail?.activeScope === 'compare-overlay' || detail?.activeScope === 'compare-curtain');
}

/**
 * Clamp a page number to the visible page range.
 * @param {*} value
 * @param {number} totalPages
 * @param {number=} fallbackPage
 * @returns {number}
 */
export function normalizeToolbarPageNumber(value, totalPages, fallbackPage = 1) {
  const total = Math.max(1, Number(totalPages) || 1);
  const fallback = Math.max(1, Math.min(total, Math.floor(Number(fallbackPage) || 1)));
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(total, numeric));
}

/**
 * Detail payload emitted by the print dialog.
 * @typedef {Object} PrintSubmitDetail
 * @property {'active'|'all'|'range'|'advanced'} mode
 * @property {number=} from
 * @property {number=} to
 * @property {Array<number>=} sequence
 * @property {'selection'|'session'=} allScope
 * @property {'primary'|'compare-both'|'compare-overlay'|'compare-curtain'=} activeScope
 * @property {string=} reason
 * @property {string=} forWhom
 * @property {string=} printFormat
 * @property {string=} printFormatValue
 * @property {Object=} reasonSelection
 * @property {Object=} printFormatSelection
 * @property {'auto'|'portrait'|'landscape'=} pdfOrientation
 * @property {'html'|'pdf'=} printBackend
 * @property {'print'|'download'=} printAction
 */

/**
 * A compare view asking the shared dialog to print it as one page.
 * @typedef {Object} ComposedPrintTarget
 * @property {'overlay'|'curtain'} view
 * @property {{ current:* }} primaryRenderRef Page A (left) render handle of the view.
 * @property {{ current:* }} compareRenderRef Page B (right) render handle of the view.
 * @property {function(): Object} getView The view's current print state (read at submit time).
 */

/**
 * @typedef {Object} PrintPipelineParams
 * @property {boolean=} printEnabled
 * @property {boolean=} isDocumentLoading
 * @property {'normal'|'soft'|'hard'=} memoryPressureStage
 * @property {number} pageNumber Current visible page ordinal.
 * @property {number=} pageNumberDisplay Current original session page number.
 * @property {number} totalPages Total visible pages.
 * @property {number=} totalPagesDisplay Total original session pages.
 * @property {(number|null)=} comparePageNumber
 * @property {(number|null)=} comparePageNumberDisplay
 * @property {Function=} setComparePageNumber
 * @property {boolean=} isComparing
 * @property {number=} sessionTotalPages
 * @property {Array<*>=} allPages
 * @property {(Object|null)=} bundle
 * @property {boolean=} hasActiveSelection
 * @property {Array<number>=} visibleOriginalPageNumbers
 * @property {number=} selectionIncludedCount
 * @property {boolean=} printSelectionSequenceLocked
 * @property {{ current:* }} documentRenderRef
 * @property {{ current:* }} compareRef
 * @property {{ current:* }} viewerContainerRef
 * @property {boolean=} isPrintDialogOpen
 * @property {function(): void=} openPrintDialog
 * @property {function(): void=} closePrintDialog
 */

/**
 * The single print pipeline shared by the toolbar and the compare views.
 *
 * @param {PrintPipelineParams} params
 * @returns {Object} Dialog props, submit/open actions, PDF progress state and toolbar print state.
 */
export default function usePrintPipeline({
  printEnabled = true,
  isDocumentLoading = false,
  memoryPressureStage = 'normal',
  pageNumber,
  pageNumberDisplay = pageNumber,
  totalPages,
  totalPagesDisplay = totalPages,
  comparePageNumber = null,
  comparePageNumberDisplay = null,
  setComparePageNumber,
  isComparing = false,
  sessionTotalPages = totalPagesDisplay,
  allPages = [],
  bundle = null,
  hasActiveSelection = false,
  visibleOriginalPageNumbers = [],
  selectionIncludedCount = 0,
  printSelectionSequenceLocked = false,
  documentRenderRef,
  compareRef,
  viewerContainerRef,
  isPrintDialogOpen = false,
  openPrintDialog,
  closePrintDialog,
}) {
  const { t, i18n } = useTranslation('common');
  const [pdfProgress, setPdfProgress] = useState(/** @type {{ open:boolean, action:string, phase:string, current:number, progressValue:number, page:number, total:number, error:string, minimized:boolean }} */ (EMPTY_PDF_PROGRESS));
  const pdfAbortControllerRef = useRef(/** @type {AbortController|null} */ (null));
  const pdfStartTimeoutRef = useRef(/** @type {number|null} */ (null));
  const pdfRunSeqRef = useRef(0);
  const pdfBackgroundModeRef = useRef(false);
  const pendingPdfOutputRef = useRef(/** @type {{ blob:Blob, action:string, filename:string, total:number, detail:Object, pageNumbers:Array<number> }|null} */ (null));
  // Generated PDF blobs are kept for the current loaded document session. Active-page
  // output is intentionally excluded because it includes transient visual edit state.
  const pdfPrintCacheRef = useRef(/** @type {Map<string, { blob:Blob, detail:Object, filename:string, total:number, createdAt:number }>} */ (new Map()));
  const [lastPdfPrintInfo, setLastPdfPrintInfo] = useState(/** @type {{ total:number, createdAt:number, detail:Object }|null} */ (null));
  // The compare view the open dialog prints (null: the toolbar's own print).
  const composedTargetRef = useRef(/** @type {(ComposedPrintTarget|null)} */ (null));
  const [composedView, setComposedView] = useState(/** @type {(null|'overlay'|'curtain')} */ (null));

  const compareTargetAvailable = typeof setComparePageNumber === 'function' && totalPages > 0;
  const comparePaneVisible = compareTargetAvailable && isComparing && Number.isFinite(comparePageNumber);
  const compareNavigationPage = useMemo(
    () => normalizeToolbarPageNumber(comparePageNumber, totalPages, pageNumber),
    [comparePageNumber, pageNumber, totalPages]
  );
  const compareNavigationPageDisplay = useMemo(
    () => (Number.isFinite(comparePageNumberDisplay)
      ? Math.max(1, Number(comparePageNumberDisplay))
      : compareNavigationPage),
    [compareNavigationPage, comparePageNumberDisplay]
  );

  /**
   * Build a compact "pages" descriptor for logging.
   * @param {PrintSubmitDetail} detail
   * @returns {(string|null)} A string like "all", "3", "2-5", or "7,6,5".
   */
  const toPagesString = useCallback((detail) => {
    if (!detail) return null;
    if (detail.mode === 'all') return detail.allScope === 'selection' ? 'selection' : 'all';
    if (detail.mode === 'active') return detail.activeScope === 'compare-both' || isComposedCompareDetail(detail)
      ? `${pageNumberDisplay},${compareNavigationPageDisplay ?? pageNumberDisplay}`
      : String(pageNumberDisplay);
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      return `${detail.from}-${detail.to}`;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence) && detail.sequence.length) {
      return detail.sequence.join(',');
    }
    return null;
  }, [compareNavigationPageDisplay, pageNumberDisplay]);

  /**
   * Estimate the number of pages the user is about to print. A compare-view print composes both
   * compared pages onto one page.
   * @param {PrintSubmitDetail} detail
   * @returns {(number|null)}
   */
  const resolvePrintPageCount = useCallback((detail) => {
    if (!detail) return 1;
    if (detail.mode === 'active') return detail.activeScope === 'compare-both' ? 2 : 1;
    if (detail.mode === 'all') {
      if (detail.allScope === 'selection' && hasActiveSelection) return visibleOriginalPageNumbers.length;
      return Math.max(0, Number(sessionTotalPages) || 0);
    }
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      return Math.abs(Math.floor(detail.to) - Math.floor(detail.from)) + 1;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence)) {
      return detail.sequence.length;
    }
    return null;
  }, [hasActiveSelection, sessionTotalPages, visibleOriginalPageNumbers]);

  /**
   * Resolve page metadata objects aligned with the printed page sequence.
   * Page numbers are 1-based original session page numbers.
   * @param {Array<number>} pageNumbers
   * @returns {Array<*>}
   */
  const resolvePrintPageContexts = useCallback((pageNumbers) => {
    if (!Array.isArray(pageNumbers) || !pageNumbers.length) return [];
    const pages = Array.isArray(allPages) ? allPages : [];
    return pageNumbers.map((pageNumber) => {
      const index = Math.floor(Number(pageNumber) || 0) - 1;
      const page = index >= 0 ? (pages[index] || null) : null;
      return page ? { ...page, originalPageNumber: index + 1 } : { originalPageNumber: index + 1 };
    });
  }, [allPages]);

  /**
   * @param {PrintSubmitDetail} detail
   * @returns {Array<number>}
   */
  const resolvePrintPageNumbers = useCallback((detail) => {
    if (!detail || detail.mode === 'active') {
      if ((detail?.activeScope === 'compare-both' || isComposedCompareDetail(detail)) && isComparing) {
        return [pageNumberDisplay, compareNavigationPageDisplay]
          .map((value) => Math.floor(Number(value) || 0))
          .filter((value) => value > 0);
      }
      const active = Math.floor(Number(pageNumberDisplay) || 0);
      return active > 0 ? [active] : [];
    }
    if (detail.mode === 'all') {
      if (detail.allScope === 'selection' && Array.isArray(visibleOriginalPageNumbers) && visibleOriginalPageNumbers.length) {
        return visibleOriginalPageNumbers.slice();
      }
      return Array.from({ length: Math.max(0, Math.floor(Number(sessionTotalPages) || 0)) }, (_value, index) => index + 1);
    }
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      const total = Math.max(0, Math.floor(Number(sessionTotalPages) || 0));
      const from = Math.max(1, Math.min(total, Math.floor(Number(detail.from) || 1)));
      const to = Math.max(1, Math.min(total, Math.floor(Number(detail.to) || 1)));
      const out = [];
      if (from <= to) {
        for (let n = from; n <= to; n += 1) out.push(n);
      } else {
        for (let n = from; n >= to; n -= 1) out.push(n);
      }
      return out;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence)) return detail.sequence.slice();
    return [];
  }, [compareNavigationPageDisplay, isComparing, pageNumberDisplay, sessionTotalPages, visibleOriginalPageNumbers]);

  /**
   * @param {PrintSubmitDetail} detail
   * @returns {Object}
   */
  const makePrintOptions = useCallback((detail) => {
    const pageNumbers = resolvePrintPageNumbers(detail);
    return {
      viewerContainerRef,
      documentRenderRef,
      reason: detail?.reason || '',
      forWhom: detail?.forWhom || '',
      printFormat: detail?.printFormat || '',
      reasonSelection: detail?.reasonSelection || null,
      printFormatSelection: detail?.printFormatSelection || null,
      bundle: bundle || null,
      pageNumbers,
      pageContexts: resolvePrintPageContexts(pageNumbers),
      printHeaderCfg: getRuntimeConfig().printHeader || {},
      printFooterCfg: getRuntimeConfig().printFooter || {},
      printFormatCfg: getRuntimeConfig().print?.format || {},
      pdfCfg: getRuntimeConfig().print?.pdf || {},
      pdfOrientation: detail?.pdfOrientation || '',
      action: detail?.printAction === 'download' ? 'download' : 'print',
      filename: getRuntimeConfig().print?.pdf?.filename || 'opendocviewer-print.pdf',
    };
  }, [bundle, documentRenderRef, resolvePrintPageContexts, resolvePrintPageNumbers, viewerContainerRef]);

  /**
   * Fire-and-forget user print log. Must never block the print action.
   * @param {PrintSubmitDetail} detail
   * @returns {void}
   */
  const submitUserPrintLog = useCallback((detail) => {
    try {
      userLog.submitPrint({
        action: detail?.printAction === 'download' ? 'download-pdf' : (detail?.printBackend === 'pdf' ? 'print-pdf' : 'print'),
        reason: detail?.reason ?? null,
        forWhom: detail?.forWhom ?? null,
        printFormat: detail?.printFormat ?? null,
        printFormatValue: detail?.printFormatValue ?? null,
        docId: null,
        fileName: null,
        pageCount: resolvePrintPageCount(detail),
        pages: toPagesString(detail),
        copies: 1
      });
    } catch { /* never throw */ }
  }, [resolvePrintPageCount, toPagesString]);

  const pdfPrintSessionKey = useMemo(() => {
    const pages = Array.isArray(allPages) ? allPages : [];
    const first = pages[0] || null;
    const last = pages.length ? pages[pages.length - 1] : null;
    const firstKey = String(first?.documentId || first?.id || first?.src || first?.url || '');
    const lastKey = String(last?.documentId || last?.id || last?.src || last?.url || '');
    return `${pages.length}:${firstKey}:${lastKey}`;
  }, [allPages]);

  useEffect(() => {
    pdfPrintCacheRef.current = new Map();
    setLastPdfPrintInfo(null);
  }, [pdfPrintSessionKey]);

  useEffect(() => {
    if (String(memoryPressureStage || 'normal').toLowerCase() === 'hard') {
      pdfPrintCacheRef.current = new Map();
    }
  }, [memoryPressureStage]);

  const pdfPrintCacheKeyOptions = useMemo(
    () => getPdfPrintCacheKeyOptions(getRuntimeConfig()),
    []
  );

  const rememberLastPdfPrint = useCallback((detail, blob, total, filename, pageNumbers = null) => {
    if (!(blob instanceof Blob) || detail?.printBackend !== 'pdf') return;
    const pageTotal = Math.max(1, Math.floor(Number(total) || resolvePrintPageCount(detail) || 1));
    const createdAt = Date.now();
    const settingsDetail = { ...(detail || {}) };
    if (canReuseGeneratedPdfPrint(detail)) {
      const cachePageNumbers = Array.isArray(pageNumbers) ? pageNumbers : resolvePrintPageNumbers(detail);
      const cacheKey = getPdfPrintCacheKey(detail, cachePageNumbers, pdfPrintCacheKeyOptions);
      pdfPrintCacheRef.current.set(cacheKey, {
        blob,
        detail: settingsDetail,
        filename: filename || 'opendocviewer-print.pdf',
        total: pageTotal,
        createdAt,
      });
      settingsDetail.restoredPageNumbers = cachePageNumbers.slice();
    }
    setLastPdfPrintInfo({
      total: pageTotal,
      createdAt,
      detail: settingsDetail,
    });
  }, [pdfPrintCacheKeyOptions, resolvePrintPageCount, resolvePrintPageNumbers]);

  const getLastPdfPrintBlob = useCallback((detail, pageNumbers) => {
    if (!canReuseGeneratedPdfPrint(detail)) return null;
    const cacheKey = getPdfPrintCacheKey(detail, pageNumbers, pdfPrintCacheKeyOptions);
    const entry = pdfPrintCacheRef.current.get(cacheKey);
    return entry?.blob instanceof Blob ? entry.blob : null;
  }, [pdfPrintCacheKeyOptions]);


  const {
    status: pdfPrebuildStatus,
    getCachedBlob: getCachedPrebuiltPdfBlob,
  } = usePdfPrebuildAllPages({
    printEnabled,
    isDocumentLoading,
    sessionTotalPages,
    documentRenderRef,
    makePrintOptions,
    language: i18n?.language || '',
    paused: pdfProgress.open && !pdfProgress.error && pdfProgress.phase !== 'cancelled',
  });

  const toolbarPrintEnabled = printEnabled && !isDocumentLoading;

  const resetPdfProgress = useCallback(() => {
    pendingPdfOutputRef.current = null;
    pdfBackgroundModeRef.current = false;
    setPdfProgress(EMPTY_PDF_PROGRESS);
  }, []);

  const minimizePdfProgress = useCallback(() => {
    pdfBackgroundModeRef.current = true;
    setPdfProgress((current) => (current.open && !current.error && current.phase !== 'cancelled'
      ? { ...current, minimized: true }
      : current));
  }, []);

  const executePreparedPdfOutput = useCallback(async ({
    action,
    blob,
    detail,
    filename,
    pageNumbers,
    total,
    minimized = false,
  }) => {
    try {
      if (action === 'download') {
        setPdfProgress({ open: true, action, phase: 'downloading', current: total, progressValue: total, page: 0, total, error: '', minimized });
        rememberLastPdfPrint(detail, blob, total, filename, pageNumbers);
        downloadPdfBlob(blob, filename);
      } else {
        setPdfProgress({ open: true, action, phase: 'opening-preview', current: total, progressValue: total, page: 0, total, error: '', minimized });
        rememberLastPdfPrint(detail, blob, total, filename, pageNumbers);
        await printPdfBlob(blob);
      }
      window.setTimeout(resetPdfProgress, 1800);
      return true;
    } catch (error) {
      logger.warn('Prepared PDF output failed', { error: String(error?.message || error) });
      setPdfProgress({ open: true, action, phase: 'error', current: 0, progressValue: 0, page: 0, total, error: String(error?.message || error), minimized });
      return false;
    }
  }, [rememberLastPdfPrint, resetPdfProgress]);

  const finishPendingPdfOutput = useCallback(() => {
    const pending = pendingPdfOutputRef.current;
    if (!pending) return;
    pendingPdfOutputRef.current = null;
    pdfBackgroundModeRef.current = false;
    void executePreparedPdfOutput({ ...pending, minimized: true });
  }, [executePreparedPdfOutput]);

  const requestCancelPdfProgress = useCallback(() => {
    if (!pdfProgress.open || pdfProgress.error || pdfProgress.phase === 'cancelled' || pdfProgress.phase === 'cancelling') return;
    if (pdfProgress.phase === 'ready') {
      resetPdfProgress();
      return;
    }
    const confirmed = window.confirm(t('printDialog.pdfProgress.cancelConfirm', {
      defaultValue: 'Cancel generation?',
    }));
    if (!confirmed) return;

    const hadPendingStart = pdfStartTimeoutRef.current !== null;
    if (hadPendingStart) {
      window.clearTimeout(pdfStartTimeoutRef.current);
      pdfStartTimeoutRef.current = null;
    }
    try { pdfAbortControllerRef.current?.abort(); } catch {}
    setPdfProgress((current) => current.open
      ? { ...current, phase: hadPendingStart ? 'cancelled' : 'cancelling', error: '' }
      : current);
    if (hadPendingStart) window.setTimeout(resetPdfProgress, 900);
  }, [pdfProgress.error, pdfProgress.open, pdfProgress.phase, resetPdfProgress, t]);

  useEffect(() => {
    if (!pdfProgress.open || pdfProgress.minimized || pdfProgress.error || pdfProgress.phase === 'cancelled' || pdfProgress.phase === 'cancelling') return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      requestCancelPdfProgress();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pdfProgress.error, pdfProgress.minimized, pdfProgress.open, pdfProgress.phase, requestCancelPdfProgress]);

  useEffect(() => () => {
    if (pdfStartTimeoutRef.current !== null) {
      window.clearTimeout(pdfStartTimeoutRef.current);
      pdfStartTimeoutRef.current = null;
    }
    try { pdfAbortControllerRef.current?.abort(); } catch {}
    pendingPdfOutputRef.current = null;
  }, []);

  const isPdfProgressTerminal = !!pdfProgress.error
    || pdfProgress.phase === 'cancelled'
    || pdfProgress.phase === 'downloaded'
    || pdfProgress.phase === 'opening-preview';
  const isPdfOutputLocked = pdfProgress.open && !isPdfProgressTerminal;

  /**
   * Execute the actual print helper after the dialog has resolved the user's choices.
   * @param {PrintSubmitDetail} detail
   * @param {({ target:ComposedPrintTarget, view:Object }|null)=} composed Compare-view print: the view and its state at submit time.
   * @returns {void}
   */
  const dispatchPrintRequest = useCallback((detail, composed = null) => {
    if (composed && !canPrintComposedView(composed.target.view)) return;
    if (isComposedCompareDetail(detail) && !composed) return;
    const commonOpts = makePrintOptions(detail);
    const pageNumbers = Array.isArray(commonOpts.pageNumbers) ? commonOpts.pageNumbers : resolvePrintPageNumbers(detail);
    const composedPrinter = composed ? COMPOSED_VIEW_PRINTERS[composed.target.view] : null;

    if (detail?.printBackend === 'pdf') {
      const total = composedPrinter
        ? 1
        : Math.max(1, Array.isArray(pageNumbers) && pageNumbers.length ? pageNumbers.length : resolvePrintPageCount(detail));
      const action = detail?.printAction === 'download' ? 'download' : 'print';
      // A composed compare page is never cached: it depends on the view's transient state.
      const cachedBlob = composedPrinter ? null : getCachedPrebuiltPdfBlob(detail, pageNumbers, sessionTotalPages);
      if (cachedBlob instanceof Blob) {
        void executePreparedPdfOutput({
          action,
          blob: cachedBlob,
          detail,
          filename: commonOpts.filename || 'opendocviewer-print.pdf',
          pageNumbers,
          total,
        });
        return;
      }
      const lastPdfBlob = composedPrinter ? null : getLastPdfPrintBlob(detail, pageNumbers);
      if (lastPdfBlob instanceof Blob) {
        void executePreparedPdfOutput({
          action,
          blob: lastPdfBlob,
          detail,
          filename: commonOpts.filename || 'opendocviewer-print.pdf',
          pageNumbers,
          total,
        });
        return;
      }
      const runSeq = pdfRunSeqRef.current + 1;
      pdfRunSeqRef.current = runSeq;
      pendingPdfOutputRef.current = null;
      pdfBackgroundModeRef.current = false;
      try { pdfAbortControllerRef.current?.abort(); } catch {}
      const abortController = new AbortController();
      pdfAbortControllerRef.current = abortController;
      setPdfProgress({ open: true, action, phase: 'starting', current: 0, progressValue: 0, page: 0, total, error: '', minimized: false });
      const pdfOpts = {
        ...commonOpts,
        deferOutput: true,
        signal: abortController.signal,
        onProgress: (event) => {
          if (pdfRunSeqRef.current !== runSeq) return;
          const nextTotal = Math.max(1, Math.floor(Number(event?.total) || total));
          const current = Math.max(0, Math.min(nextTotal, Math.floor(Number(event?.current) || 0)));
          const rawProgressValue = Number(event?.progressValue);
          const progressValue = Math.max(0, Math.min(nextTotal, Number.isFinite(rawProgressValue) ? rawProgressValue : current));
          const rawPage = Number(event?.page);
          const page = Number.isFinite(rawPage) ? Math.max(0, Math.min(nextTotal, Math.floor(rawPage))) : 0;
          setPdfProgress((currentProgress) => ({
            open: true,
            action,
            phase: String(event?.phase || 'generating'),
            current,
            progressValue,
            page,
            total: nextTotal,
            error: '',
            minimized: !!currentProgress.minimized,
          }));
        },
      };
      // Give React/the browser one paint opportunity before PDF generation starts. On fast
      // machines the dynamic import may already be cached, and jsPDF work can otherwise begin
      // before the progress overlay becomes visible.
      pdfStartTimeoutRef.current = window.setTimeout(() => {
        pdfStartTimeoutRef.current = null;
        if (abortController.signal.aborted || pdfRunSeqRef.current !== runSeq) return;
        const pdfTask = composedPrinter
          ? composedPrinter.pdf(composed.target.primaryRenderRef, composed.target.compareRenderRef, composed.view, pdfOpts)
          : detail?.mode === 'active'
            ? (detail?.activeScope === 'compare-both' && isComparing
                ? handlePdfCurrentComparison(documentRenderRef, compareRef, pdfOpts)
                : handlePdfCurrent(documentRenderRef, pdfOpts))
            : handlePdfOutput(documentRenderRef, pageNumbers, pdfOpts);
        pdfTask
          .then((blob) => {
            if (pdfRunSeqRef.current !== runSeq) return;
            if (!(blob instanceof Blob)) {
              throw new Error('PDF generation completed without a printable PDF file.');
            }
            if (pdfBackgroundModeRef.current) {
              pendingPdfOutputRef.current = {
                blob,
                action,
                detail: { ...(detail || {}) },
                filename: commonOpts.filename || 'opendocviewer-print.pdf',
                pageNumbers,
                total,
              };
              setPdfProgress({
                open: true,
                action,
                phase: 'ready',
                current: total,
                progressValue: total,
                page: 0,
                total,
                error: '',
                minimized: true,
              });
              return;
            }
            if (action === 'download') {
              void executePreparedPdfOutput({
                action,
                blob,
                detail,
                filename: commonOpts.filename || 'opendocviewer-print.pdf',
                pageNumbers,
                total,
              });
            } else {
              void executePreparedPdfOutput({
                action,
                blob,
                detail,
                filename: commonOpts.filename || 'opendocviewer-print.pdf',
                pageNumbers,
                total,
              });
            }
          })
          .catch((error) => {
            if (pdfRunSeqRef.current !== runSeq) return;
            if (isPdfAbortError(error)) {
              pendingPdfOutputRef.current = null;
              setPdfProgress((currentProgress) => ({ open: true, action, phase: 'cancelled', current: 0, progressValue: 0, page: 0, total, error: '', minimized: !!currentProgress.minimized }));
              window.setTimeout(resetPdfProgress, 900);
              return;
            }
            logger.warn('Generated PDF print failed', { error: String(error?.message || error) });
            setPdfProgress((currentProgress) => ({ open: true, action, phase: 'error', current: 0, progressValue: 0, page: 0, total, error: String(error?.message || error), minimized: !!currentProgress.minimized }));
          });
      }, 50);
      return;
    }

    if (composedPrinter) {
      composedPrinter.print(composed.target.primaryRenderRef, composed.target.compareRenderRef, composed.view, commonOpts);
      return;
    }
    if (!detail || detail.mode === 'active') {
      if (detail?.activeScope === 'compare-both' && isComparing) {
        handlePrintCurrentComparison(documentRenderRef, compareRef, commonOpts);
        return;
      }
      handlePrint(documentRenderRef, commonOpts);
      return;
    }
    if (detail.mode === 'all') {
      if (detail.allScope === 'selection' && Array.isArray(visibleOriginalPageNumbers) && visibleOriginalPageNumbers.length) {
        handlePrintSequence(documentRenderRef, visibleOriginalPageNumbers, commonOpts);
        return;
      }
      handlePrintAll(documentRenderRef, commonOpts);
      return;
    }
    if (detail.mode === 'range' && Number.isFinite(detail.from) && Number.isFinite(detail.to)) {
      handlePrintRange(documentRenderRef, detail.from, detail.to, commonOpts);
      return;
    }
    if (detail.mode === 'advanced' && Array.isArray(detail.sequence) && detail.sequence.length) {
      handlePrintSequence(documentRenderRef, detail.sequence, commonOpts);
    }
  }, [compareRef, documentRenderRef, executePreparedPdfOutput, getCachedPrebuiltPdfBlob, getLastPdfPrintBlob, isComparing, makePrintOptions, resetPdfProgress, resolvePrintPageCount, resolvePrintPageNumbers, sessionTotalPages, visibleOriginalPageNumbers]);

  const clearComposedTarget = useCallback(() => {
    composedTargetRef.current = null;
    setComposedView(null);
  }, []);

  useEffect(() => {
    if (!isDocumentLoading) return;
    if (isPrintDialogOpen) closePrintDialog?.();
  }, [closePrintDialog, isDocumentLoading, isPrintDialogOpen]);

  // Whichever way the dialog closes, the next open starts without a compare-view target.
  useEffect(() => {
    if (!isPrintDialogOpen) clearComposedTarget();
  }, [clearComposedTarget, isPrintDialogOpen]);

  /**
   * Handle the dialog submit event and dispatch the correct print action. A compare-view print is
   * tagged as one composed page and its view state is read now, while the view is still open.
   * @param {PrintSubmitDetail} detail
   * @returns {void}
   */
  const handlePrintSubmit = useCallback((detail) => {
    const target = composedTargetRef.current;
    if (target && !canPrintComposedView(target.view)) {
      closePrintDialog?.();
      return;
    }
    const composed = target ? { target, view: target.getView() } : null;
    const submitted = composed
      ? { ...(detail || {}), mode: 'active', activeScope: `compare-${target.view}` }
      : detail;
    closePrintDialog?.();

    submitUserPrintLog(submitted);

    window.setTimeout(() => {
      dispatchPrintRequest(submitted, composed);
    }, 30);
  }, [closePrintDialog, dispatchPrintRequest, submitUserPrintLog]);

  /** Toolbar entry: the dialog for the viewer's own pages. */
  const openToolbarPrintDialog = useCallback(() => {
    clearComposedTarget();
    openPrintDialog?.();
  }, [clearComposedTarget, openPrintDialog]);

  /**
   * Compare-view entry: the same dialog, printing the view as one composed page.
   * @param {ComposedPrintTarget} target
   * @returns {boolean} False when printing is unavailable or the target is unknown.
   */
  const openComposedPrintDialog = useCallback((target) => {
    if (!toolbarPrintEnabled || isPdfOutputLocked) return false;
    if (!target || !COMPOSED_VIEW_PRINTERS[target.view] || typeof target.getView !== 'function') return false;
    if (!canPrintComposedView(target.view)) return false;
    composedTargetRef.current = target;
    setComposedView(target.view);
    openPrintDialog?.();
    return true;
  }, [isPdfOutputLocked, openPrintDialog, toolbarPrintEnabled]);

  const closeDialog = useCallback(() => {
    closePrintDialog?.();
  }, [closePrintDialog]);

  const dialogProps = useMemo(() => ({
    isOpen: !!isPrintDialogOpen,
    onClose: closeDialog,
    onSubmit: handlePrintSubmit,
    composedView,
    // Reusing the last generated PDF's settings does not apply to a composed compare page.
    lastPdfPrintAvailable: !composedView && !!lastPdfPrintInfo,
    lastPdfPrintDetail: lastPdfPrintInfo?.detail || null,
    lastPdfPrintPageCount: lastPdfPrintInfo?.total || 0,
    totalPages: totalPagesDisplay,
    isDocumentLoading,
    activePageNumber: pageNumberDisplay,
    comparePageNumber: comparePaneVisible ? compareNavigationPageDisplay : null,
    isComparing,
    hasActiveSelection,
    selectionSequenceLocked: printSelectionSequenceLocked,
    selectionIncludedCount,
    sessionTotalPages,
  }), [closeDialog, compareNavigationPageDisplay, comparePaneVisible, composedView, handlePrintSubmit, hasActiveSelection, isComparing, isDocumentLoading, isPrintDialogOpen, lastPdfPrintInfo, pageNumberDisplay, printSelectionSequenceLocked, selectionIncludedCount, sessionTotalPages, totalPagesDisplay]);

  return {
    dialogProps,
    handlePrintSubmit,
    openPrintDialog: openToolbarPrintDialog,
    openComposedPrintDialog,
    toolbarPrintEnabled,
    isPdfOutputLocked,
    pdfPrebuildStatus,
    makePrintOptions,
    resolvePrintPageNumbers,
    pdfProgress,
    resetPdfProgress,
    minimizePdfProgress,
    requestCancelPdfProgress,
    finishPendingPdfOutput,
  };
}
