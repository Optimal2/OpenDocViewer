// File: src/components/DocumentToolbar/usePdfPrebuildAllPages.js
/**
 * Background prebuild/cache for configured "all pages" generated-PDF variants.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import logger from '../../logging/systemLogger.js';
import { getRuntimeConfig } from '../../utils/runtimeConfig.js';
import { collectPrintablePdfSources, createPrintPdfBlob } from '../../utils/printPdf.js';
import { createPdfPrebuildAllPagesVariants } from '../../utils/pdfPrebuildPlan.js';

const EMPTY_PREBUILD_STATUS = Object.freeze({
  state: 'off',
  completed: 0,
  total: 0,
  error: '',
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
 * @param {string} language
 * @returns {{full:string,base:string}}
 */
function normalizeLanguage(language) {
  const full = String(language || '').trim().toLowerCase();
  return { full, base: full.split('-')[0] || full };
}

/**
 * @param {string} variantLanguage
 * @param {string} activeLanguage
 * @returns {boolean}
 */
function matchesActiveLanguage(variantLanguage, activeLanguage) {
  const raw = String(variantLanguage || 'current').trim().toLowerCase();
  if (!raw || raw === 'current') return true;
  const variant = normalizeLanguage(raw);
  const active = normalizeLanguage(activeLanguage || 'current');
  return variant.full === active.full || (!!variant.base && variant.base === active.base);
}

/**
 * @param {*} detail
 * @returns {string}
 */
function getReasonValue(detail) {
  return String(detail?.reasonSelection?.value ?? detail?.reason ?? '').trim();
}

/**
 * @param {*} detail
 * @returns {boolean}
 */
function hasPrintFormat(detail) {
  return !!String(detail?.printFormatValue ?? detail?.printFormat ?? '').trim();
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
 * @returns {boolean}
 */
function isCacheableAllPagesRequest(detail) {
  return detail?.printBackend === 'pdf'
    && detail?.mode === 'all'
    && detail?.allScope !== 'selection'
    && !String(detail?.forWhom || '').trim();
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
 * @param {*} variant
 * @param {*} detail
 * @param {string} activeLanguage
 * @returns {boolean}
 */
function matchesVariant(variant, detail, activeLanguage) {
  if (!matchesActiveLanguage(variant?.language, activeLanguage)) return false;
  if (normalizePdfOrientation(variant?.pdfOrientation) !== normalizePdfOrientation(detail?.pdfOrientation)) return false;
  return getReasonValue(variant) === getReasonValue(detail)
    && hasPrintFormat(variant) === hasPrintFormat(detail);
}

/**
 * Run async work with bounded concurrency.
 * @template T
 * @param {Array<T>} items
 * @param {number} concurrency
 * @param {function(T, number): Promise<void>} runItem
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
      await runItem(list[itemIndex], itemIndex);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runLoop()));
}

/**
 * @param {Object} args
 * @param {boolean} args.printEnabled
 * @param {boolean} args.isDocumentLoading
 * @param {number} args.sessionTotalPages
 * @param {{current:*}} args.documentRenderRef
 * @param {function(Object): Object} args.makePrintOptions
 * @param {string=} args.language
 * @returns {{status:{state:string,completed:number,total:number,error:string}, getCachedBlob:function(Object): (Blob|null), cancel:function(): void}}
 */
export default function usePdfPrebuildAllPages({
  printEnabled,
  isDocumentLoading,
  sessionTotalPages,
  documentRenderRef,
  makePrintOptions,
  language = '',
}) {
  const [status, setStatus] = useState(EMPTY_PREBUILD_STATUS);
  const cacheRef = useRef(new Map());
  const variantsRef = useRef([]);
  const makePrintOptionsRef = useRef(makePrintOptions);
  const abortRef = useRef(/** @type {AbortController|null} */ (null));
  const timeoutRef = useRef(/** @type {number|null} */ (null));
  const runSeqRef = useRef(0);

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

  const getCachedBlob = useCallback((detail) => {
    if (!isCacheableAllPagesRequest(detail)) return null;
    const variants = variantsRef.current || [];
    const variant = variants.find((item) => matchesVariant(item, detail, language));
    if (!variant) return null;
    const entry = cacheRef.current.get(variant.key);
    return entry?.blob instanceof Blob ? entry.blob : null;
  }, [language]);

  useEffect(() => {
    const pageCount = Math.max(0, Math.floor(Number(sessionTotalPages) || 0));
    const cfg = getRuntimeConfig();
    const plan = createPdfPrebuildAllPagesVariants(cfg, language || 'current');
    const canPrebuild = !!printEnabled
      && !isDocumentLoading
      && !!documentRenderRef?.current
      && pageCount > 0
      && plan.enabled === true
      && pageCount <= plan.config.maxPages
      && plan.variants.length > 0;

    runSeqRef.current += 1;
    const runSeq = runSeqRef.current;
    variantsRef.current = canPrebuild ? plan.variants.slice() : [];
    cacheRef.current = new Map();

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;

    if (!canPrebuild) {
      setStatus(EMPTY_PREBUILD_STATUS);
      return undefined;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    setStatus(EMPTY_PREBUILD_STATUS);

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      (async () => {
        const signal = abortController.signal;
        let completed = 0;
        const errors = [];
        try {
          setStatus({ state: 'pending', completed: 0, total: plan.variants.length, error: '' });
          const pageNumbers = Array.from({ length: pageCount }, (_value, index) => index + 1);
          const urls = await collectPrintablePdfSources(documentRenderRef, pageNumbers, signal);
          throwIfAborted(signal);
          if (!Array.isArray(urls) || urls.length !== pageCount) {
            throw new Error(`Expected ${pageCount} printable page URLs for PDF prebuild, got ${Array.isArray(urls) ? urls.length : 0}.`);
          }

          await runLimited(plan.variants, plan.config.concurrency, async (variant) => {
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
              cacheRef.current.set(variant.key, { blob, variant, createdAt: Date.now() });
              completed += 1;
              if (runSeqRef.current === runSeq) {
                setStatus({ state: 'pending', completed, total: plan.variants.length, error: '' });
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
            });
            return;
          }
          setStatus({ state: 'ready', completed, total: plan.variants.length, error: '' });
        } catch (error) {
          if (isAbortError(error) || runSeqRef.current !== runSeq) return;
          logger.warn('PDF prebuild failed', { error: String(error?.message || error) });
          setStatus({
            state: 'error',
            completed,
            total: plan.variants.length,
            error: String(error?.message || error),
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
  }, [documentRenderRef, isDocumentLoading, language, printEnabled, sessionTotalPages]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    try { abortRef.current?.abort(); } catch {}
    cacheRef.current = new Map();
    variantsRef.current = [];
  }, []);

  return { status, getCachedBlob, cancel };
}
