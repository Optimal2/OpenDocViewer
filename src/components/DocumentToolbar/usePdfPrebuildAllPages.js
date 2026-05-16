// File: src/components/DocumentToolbar/usePdfPrebuildAllPages.js
/**
 * Background prebuild/cache for configured "all pages" generated-PDF variants.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logger from '../../logging/systemLogger.js';
import { getRuntimeConfig } from '../../utils/runtimeConfig.js';
import { collectPrintablePdfSources, createPrintPdfBlob } from '../../utils/printPdf.js';
import {
  createPdfPrebuildAllPagesVariants,
  getPdfPrebuildAllPagesLanguageDependency,
} from '../../utils/pdfPrebuildPlan.js';
import { getPdfPrintCacheKey, isFullSessionPageSequence } from '../../utils/pdfPrintCacheKey.js';

const EMPTY_PREBUILD_STATUS = Object.freeze({
  state: 'off',
  completed: 0,
  total: 0,
  error: '',
  paused: false,
});

/**
 * @param {AbortSignal|undefined} signal
 * @returns {void}
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('PDF prebuild was cancelled.');
  error.name = 'AbortError';
  throw error;
}

/**
 * @param {*} error
 * @returns {boolean}
 */
function isAbortError(error) {
  return String(error?.name || '') === 'AbortError';
}

/**
 * @param {*} value
 * @returns {'auto'|'portrait'|'landscape'}
 */
function normalizePdfOrientation(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'portrait' || mode === 'landscape') return mode;
  return 'auto';
}

/**
 * @param {*} detail
 * @param {Array<number>} pageNumbers
 * @param {number} sessionTotalPages
 * @returns {boolean}
 */
function isCacheableAllPagesRequest(detail, pageNumbers, sessionTotalPages) {
  if (detail?.printBackend !== 'pdf' || detail?.mode !== 'all') return false;
  if (String(detail?.forWhom || '').trim()) return false;
  if (detail?.allScope === 'selection') {
    // A saved selection can still resolve to the complete original page sequence.
    // In that case the prebuilt session PDF bytes are identical and may be reused.
    return isFullSessionPageSequence(pageNumbers, sessionTotalPages);
  }
  return true;
}

/**
 * @param {*} variant
 * @returns {Object}
 */
function createVariantDetail(variant) {
  return {
    mode: 'all',
    allScope: 'session',
    printBackend: 'pdf',
    printAction: 'print',
    reason: variant?.reason || null,
    reasonSelection: variant?.reasonSelection || null,
    forWhom: null,
    printFormat: variant?.printFormat || null,
    printFormatValue: variant?.printFormatValue || null,
    printFormatSelection: variant?.printFormatSelection || null,
    pdfOrientation: normalizePdfOrientation(variant?.pdfOrientation),
  };
}

/**
 * Run async work with bounded concurrency.
 * @template T
 * @param {Array<T>} items
 * @param {number} concurrency
 * @param {function(T): Promise<void>} runItem
 * @param {AbortSignal|undefined} signal
 * @returns {Promise<void>}
 */
async function runLimited(items, concurrency, runItem, signal) {
  const list = Array.isArray(items) ? items : [];
  const workerCount = Math.max(1, Math.min(list.length || 1, Math.floor(Number(concurrency) || 1)));
  let nextIndex = 0;

  const runLoop = async () => {
    while (true) {
      throwIfAborted(signal);
      const itemIndex = nextIndex;
      nextIndex += 1;
      if (itemIndex >= list.length) return;
      await runItem(list[itemIndex]);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runLoop()));
}

/**
 * @param {number} pageCount
 * @returns {Array<number>}
 */
function createSessionPageNumbers(pageCount) {
  return Array.from({ length: Math.max(0, Math.floor(Number(pageCount) || 0)) }, (_value, index) => index + 1);
}

/**
 * @param {Object} args
 * @param {boolean} args.printEnabled
 * @param {boolean} args.isDocumentLoading
 * @param {number} args.sessionTotalPages
 * @param {{current:*}} args.documentRenderRef
 * @param {function(Object): Object} args.makePrintOptions
 * @param {string=} args.language
 * @param {boolean=} args.paused
 * @returns {{status:{state:string,completed:number,total:number,error:string,paused:boolean}, getCachedBlob:function(Object, Array<number>=, number=): (Blob|null), cancel:function(): void}}
 */
export default function usePdfPrebuildAllPages({
  printEnabled,
  isDocumentLoading,
  sessionTotalPages,
  documentRenderRef,
  makePrintOptions,
  language = '',
  paused = false,
}) {
  const [status, setStatus] = useState(EMPTY_PREBUILD_STATUS);
  const cacheRef = useRef(new Map());
  const variantsRef = useRef([]);
  const makePrintOptionsRef = useRef(makePrintOptions);
  const abortRef = useRef(/** @type {AbortController|null} */ (null));
  const timeoutRef = useRef(/** @type {number|null} */ (null));
  const runSeqRef = useRef(0);
  const planKeyRef = useRef('');
  // Explicit prebuild languages describe fixed print output. Only "current"
  // variants should be invalidated when the user changes the UI language.
  const prebuildLanguageDependency = useMemo(
    () => getPdfPrebuildAllPagesLanguageDependency(getRuntimeConfig(), language || 'current'),
    [language]
  );
  const prebuildLanguageContext = prebuildLanguageDependency === 'fixed'
    ? 'current'
    : (language || 'current');

  useEffect(() => {
    makePrintOptionsRef.current = makePrintOptions;
  }, [makePrintOptions]);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;
    setStatus((current) => (current.state === 'ready' ? current : EMPTY_PREBUILD_STATUS));
  }, []);

  const getCachedBlob = useCallback((detail, pageNumbers = [], sessionPageCount = sessionTotalPages) => {
    const pageCount = Math.max(0, Math.floor(Number(sessionPageCount) || 0));
    const resolvedPageNumbers = Array.isArray(pageNumbers) && pageNumbers.length
      ? pageNumbers
      : createSessionPageNumbers(pageCount);
    if (!isCacheableAllPagesRequest(detail, resolvedPageNumbers, pageCount)) return null;

    const cacheKey = getPdfPrintCacheKey(detail, resolvedPageNumbers);
    for (const entry of cacheRef.current.values()) {
      if (entry?.printCacheKey !== cacheKey) continue;
      if (entry?.languageDependency !== prebuildLanguageDependency) continue;
      return entry?.blob instanceof Blob ? entry.blob : null;
    }
    return null;
  }, [prebuildLanguageDependency, sessionTotalPages]);

  useEffect(() => {
    const pageCount = Math.max(0, Math.floor(Number(sessionTotalPages) || 0));
    const cfg = getRuntimeConfig();
    const plan = createPdfPrebuildAllPagesVariants(cfg, prebuildLanguageContext);
    const canPrebuild = !!printEnabled
      && !isDocumentLoading
      && !!documentRenderRef?.current
      && pageCount > 0
      && plan.enabled === true
      && pageCount <= plan.config.maxPages
      && plan.variants.length > 0;

    runSeqRef.current += 1;
    const runSeq = runSeqRef.current;

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;

    if (!canPrebuild) {
      variantsRef.current = [];
      cacheRef.current = new Map();
      planKeyRef.current = '';
      setStatus(EMPTY_PREBUILD_STATUS);
      return undefined;
    }

    const planKey = JSON.stringify({
      pageCount,
      language: prebuildLanguageDependency,
      variants: plan.variants.map((variant) => variant?.key || ''),
    });
    if (planKeyRef.current !== planKey) {
      cacheRef.current = new Map();
      planKeyRef.current = planKey;
    }
    variantsRef.current = plan.variants.slice();

    if (paused) {
      const completed = plan.variants.filter((variant) => cacheRef.current.get(variant?.key)?.blob instanceof Blob).length;
      setStatus(completed >= plan.variants.length
        ? { state: 'ready', completed, total: plan.variants.length, error: '', paused: false }
        : { state: 'pending', completed, total: plan.variants.length, error: '', paused: true });
      return undefined;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      (async () => {
        const signal = abortController.signal;
        let completed = plan.variants.filter((variant) => cacheRef.current.get(variant?.key)?.blob instanceof Blob).length;
        const errors = [];
        try {
          if (completed >= plan.variants.length) {
            setStatus({ state: 'ready', completed, total: plan.variants.length, error: '', paused: false });
            return;
          }
          setStatus({ state: 'pending', completed, total: plan.variants.length, error: '', paused: false });
          const pageNumbers = createSessionPageNumbers(pageCount);
          const urls = await collectPrintablePdfSources(documentRenderRef, pageNumbers, signal);
          throwIfAborted(signal);
          if (!Array.isArray(urls) || urls.length !== pageCount) {
            throw new Error(`Expected ${pageCount} printable page URLs for PDF prebuild, got ${Array.isArray(urls) ? urls.length : 0}.`);
          }

          const pendingVariants = plan.variants.filter((variant) => !(cacheRef.current.get(variant?.key)?.blob instanceof Blob));
          await runLimited(pendingVariants, plan.config.concurrency, async (variant) => {
            try {
              const detail = createVariantDetail(variant);
              const options = {
                ...makePrintOptionsRef.current(detail),
                deferOutput: true,
                signal,
              };
              const blob = await createPrintPdfBlob(urls, options);
              throwIfAborted(signal);
              if (!(blob instanceof Blob)) throw new Error('Prebuilt PDF generation did not return a Blob.');
              cacheRef.current.set(variant.key, {
                blob,
                variant,
                languageDependency: prebuildLanguageDependency,
                printCacheKey: getPdfPrintCacheKey(detail, pageNumbers),
                createdAt: Date.now(),
              });
              completed += 1;
              if (runSeqRef.current === runSeq) {
                setStatus({ state: 'pending', completed, total: plan.variants.length, error: '', paused: false });
              }
            } catch (error) {
              throwIfAborted(signal);
              errors.push(error);
              logger.warn('PDF prebuild variant failed', {
                key: variant?.key,
                error: String(error?.message || error),
              });
            }
          }, signal);

          throwIfAborted(signal);
          if (runSeqRef.current !== runSeq) return;
          if (errors.length > 0) {
            setStatus({
              state: completed > 0 ? 'warning' : 'error',
              completed,
              total: plan.variants.length,
              error: String(errors[0]?.message || errors[0] || 'PDF prebuild failed.'),
              paused: false,
            });
            return;
          }
          setStatus({ state: 'ready', completed, total: plan.variants.length, error: '', paused: false });
        } catch (error) {
          if (isAbortError(error) || runSeqRef.current !== runSeq) return;
          logger.warn('PDF prebuild failed', { error: String(error?.message || error) });
          setStatus({
            state: 'error',
            completed,
            total: plan.variants.length,
            error: String(error?.message || error),
            paused: false,
          });
        }
      })();
    }, plan.config.startDelayMs);

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      try { abortController.abort(); } catch {}
    };
  }, [
    documentRenderRef,
    isDocumentLoading,
    paused,
    prebuildLanguageContext,
    prebuildLanguageDependency,
    printEnabled,
    sessionTotalPages,
  ]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    try { abortRef.current?.abort(); } catch {}
    cacheRef.current = new Map();
    variantsRef.current = [];
  }, []);

  return { status, getCachedBlob, cancel };
}
