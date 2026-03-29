// File: src/components/DocumentLoader/DocumentLoader.js
/**
 * OpenDocViewer — Document loader orchestrator.
 *
 * WHAT CHANGED
 *   The legacy pipeline fetched, decoded, and rasterized everything up front. That works for small
 *   batches but becomes very expensive when users open thousands of pages at once.
 *
 *   The new loader now:
 *     1. resolves the ordered list of source URLs,
 *     2. optionally warns when the run looks too large,
 *     3. prefetches original source files into a temp store (memory or IndexedDB),
 *     4. analyzes page counts from the temp store in stable source order,
 *     5. inserts lightweight page placeholders, and
 *     6. lets the viewer lazily render full pages / thumbnails on demand.
 */

import React, { useEffect, useContext, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fileTypeFromBlob } from 'file-type';
import ViewerContext from '../../contexts/viewerContext.js';
import logger from '../../logging/systemLogger.js';
import { generateDocumentList, generateDemoList, getTotalPages } from './documentLoaderUtils.js';
import {
  getDocumentLoadingConfig,
  shouldRecommendStopping,
} from '../../utils/documentLoadingConfig.js';
import LoadPressureDialog from './LoadPressureDialog.jsx';

/**
 * @typedef {Object} DocumentSourceItem
 * @property {string} url
 * @property {string=} ext
 * @property {number=} fileIndex
 */

/**
 * @typedef {Object} DocumentLoaderProps
 * @property {string=} folder
 * @property {string=} extension
 * @property {number=} endNumber
 * @property {Array.<DocumentSourceItem>=} sourceList
 * @property {boolean=} sameBlob
 * @property {boolean=} demoMode
 * @property {'repeat'|'mix'=} demoStrategy
 * @property {number=} demoCount
 * @property {Array.<string>=} demoFormats
 * @property {*} children
 */


/**
 * @typedef {Object} PagePlaceholderInput
 * @property {number} fileIndex
 * @property {string} sourceKey
 * @property {string} fileExtension
 * @property {number} pageCount
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {number} startIndex
 */

/**
 * @typedef {Object} FailedPlaceholderInput
 * @property {number} fileIndex
 * @property {number} startIndex
 */

/**
 * @typedef {Object} ResolvedEntry
 * @property {string} url
 * @property {number} fileIndex
 * @property {string} ext
 */

/**
 * @typedef {Object} LoadPressureSummary
 * @property {'preload'|'analysis'} phase
 * @property {number} sourceCount
 * @property {number} discoveredPageCount
 * @property {number} estimatedPageCount
 * @property {number} prefetchedBytes
 * @property {string} tempStoreMode
 * @property {boolean} tempStoreProtected
 * @property {boolean} recommendStop
 * @property {number=} prefetchConcurrency
 */

/**
 * @typedef {Object} PrefetchResult
 * @property {boolean} ok
 * @property {string=} sourceKey
 * @property {string=} fileExtension
 * @property {string=} mimeType
 * @property {number=} sizeBytes
 * @property {number} fileIndex
 * @property {string} url
 * @property {*=} stats
 * @property {(Blob|undefined)} analysisBlob
 * @property {(number|undefined)} pageCountHint
 * @property {boolean=} aborted
 * @property {*=} error
 */

/**
 * @param {number} concurrency
 * @returns {function(function(): Promise<any>): Promise<any>}
 */
function createLimiter(concurrency) {
  const limit = Math.max(1, Number(concurrency) || 1);
  let activeCount = 0;
  /** @type {Array<{ task:function():Promise<any>, resolve:function(any):void, reject:function(*):void }>} */
  const queue = [];

  const pump = () => {
    while (activeCount < limit && queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      activeCount += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          activeCount = Math.max(0, activeCount - 1);
          pump();
        });
    }
  };

  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

/**
 * @param {string} url
 * @returns {string}
 */
function inferUrlExtension(url) {
  const match = String(url || '').toLowerCase().match(/\.([a-z0-9]+)(?:$|\?|#)/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeExtension(value) {
  const ext = String(value || '').toLowerCase().replace(/^\./, '');
  if (ext === 'jpeg') return 'jpg';
  if (ext === 'tif') return 'tiff';
  return ext;
}

/**
 * @param {string} mimeType
 * @returns {string}
 */
function mimeToExtension(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('tif')) return 'tiff';
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('gif')) return 'gif';
  if (type.includes('bmp')) return 'bmp';
  if (type.includes('webp')) return 'webp';
  return '';
}

/**
 * @param {number} fileIndex
 * @param {number} orderIndex
 * @returns {string}
 */
function createSourceKey(fileIndex, orderIndex) {
  try {
    return `src_${String(fileIndex)}_${String(orderIndex)}_${Math.random().toString(36).slice(2, 8)}`;
  } catch {
    return `src_${String(fileIndex)}_${String(orderIndex)}_${Date.now()}`;
  }
}

/**
 * @param {PagePlaceholderInput} input
 * @returns {Array<Object>}
 */
function createPagePlaceholders(input) {
  const pages = [];
  for (let pageIndex = 0; pageIndex < input.pageCount; pageIndex += 1) {
    pages.push({
      sourceKey: input.sourceKey,
      status: 1,
      fullSizeStatus: 0,
      thumbnailStatus: 0,
      fullSizeUrl: '',
      thumbnailUrl: '',
      thumbnailUsesFullAsset: false,
      loaded: false,
      fileExtension: input.fileExtension,
      fileIndex: input.fileIndex,
      pageIndex,
      allPagesIndex: input.startIndex + pageIndex,
      sourceMimeType: input.mimeType,
      sourceSizeBytes: input.sizeBytes,
    });
  }
  return pages;
}

/**
 * @param {FailedPlaceholderInput} input
 * @returns {Array<Object>}
 */
function createFailedPlaceholder(input) {
  return [{
    sourceKey: `failed_${input.fileIndex}_${input.startIndex}`,
    status: -1,
    fullSizeStatus: -1,
    thumbnailStatus: -1,
    fullSizeUrl: 'lost.png',
    thumbnailUrl: 'lost.png',
    thumbnailUsesFullAsset: false,
    loaded: false,
    fileExtension: 'png',
    fileIndex: input.fileIndex,
    pageIndex: 0,
    allPagesIndex: input.startIndex,
  }];
}

/**
 * @param {Array<DocumentSourceItem>|null|undefined} sourceList
 * @param {boolean|undefined} demoMode
 * @param {'repeat'|'mix'|undefined} demoStrategy
 * @param {number|undefined} demoCount
 * @param {Array<string>|undefined} demoFormats
 * @param {string|undefined} folder
 * @param {string|undefined} extension
 * @param {number|undefined} endNumber
 * @returns {Array<ResolvedEntry>}
 */
function resolveEntries(sourceList, demoMode, demoStrategy, demoCount, demoFormats, folder, extension, endNumber) {
  if (Array.isArray(sourceList) && sourceList.length > 0) {
    return sourceList
      .map((item, index) => ({
        url: String(item?.url || ''),
        fileIndex: Number.isFinite(item?.fileIndex) ? Number(item.fileIndex) : index,
        ext: normalizeExtension(item?.ext || inferUrlExtension(item?.url || '')),
      }))
      .filter((item) => !!item.url);
  }

  if (demoMode) {
    const urls = generateDemoList({
      strategy: demoStrategy || 'repeat',
      count: Math.max(1, Number(demoCount) || 1),
      formats: demoFormats,
    });
    return urls.map((url, index) => ({
      url,
      fileIndex: index,
      ext: normalizeExtension(inferUrlExtension(url)),
    }));
  }

  const urls = generateDocumentList(folder, extension, endNumber);
  return urls.map((url, index) => ({
    url,
    fileIndex: index,
    ext: normalizeExtension(extension || inferUrlExtension(url)),
  }));
}

/**
 * @param {string} text
 * @returns {string}
 */
function safeMessage(text) {
  return String(text || '').trim();
}

/**
 * @param {DocumentLoaderProps} props
 * @returns {React.ReactElement}
 */
const DocumentLoader = ({
  folder,
  extension,
  children,
  endNumber,
  sourceList,
  demoMode,
  demoStrategy = 'repeat',
  demoCount,
  demoFormats,
}) => {
  const { t } = useTranslation('common');
  const {
    insertPagesAtIndex,
    ensurePageAsset,
    setError,
    setWorkerCount,
    setLoadingRunActive,
    setPlannedPageCount,
    initializeDocumentSession,
    storeSourceBlob,
    registerSourceDescriptor,
    addMessage,
  } = useContext(ViewerContext);

  const isMountedRef = useRef(true);
  const activeControllersRef = useRef(new Set());
  const promptResolverRef = useRef(null);
  const [pressureSummary, setPressureSummary] = useState(null);

  /**
   * @param {*} summary
   * @returns {Promise<boolean>}
   */
  const promptForPressure = useCallback((summary) => new Promise((resolve) => {
    promptResolverRef.current = resolve;
    setPressureSummary(summary);
  }), []);

  /**
   * @param {boolean} accepted
   * @returns {void}
   */
  const resolvePressurePrompt = useCallback((accepted) => {
    const resolver = promptResolverRef.current;
    promptResolverRef.current = null;
    setPressureSummary(null);
    resolver?.(!!accepted);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const resolver = promptResolverRef.current;
      promptResolverRef.current = null;
      if (resolver) resolver(false);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const config = getDocumentLoadingConfig();
    const entries = resolveEntries(
      sourceList,
      demoMode,
      demoStrategy,
      demoCount,
      demoFormats,
      folder,
      extension,
      endNumber
    );

    logger.info('DocumentLoader run started', {
      sourceCount: entries.length,
      mode: Array.isArray(sourceList) && sourceList.length > 0 ? 'explicit-list' : (demoMode ? 'demo' : 'pattern'),
    });

    const abortAllFetches = () => {
      const controllers = Array.from(activeControllersRef.current.values());
      activeControllersRef.current.clear();
      controllers.forEach((controller) => {
        try { controller.abort(); } catch {}
      });
    };

    /**
     * @param {LoadPressureSummary} summary
     * @returns {Promise<boolean>}
     */
    const maybePrompt = async (summary) => {
      if (cancelled || !isMountedRef.current) return false;
      return promptForPressure({
        ...summary,
        prefetchConcurrency: config.fetch.prefetchConcurrency,
      });
    };

    const prefetchLimiter = createLimiter(config.fetch.prefetchConcurrency);

    /**
     * @param {ResolvedEntry} entry
     * @param {number} orderIndex
     * @returns {Promise<PrefetchResult>}
     */
    const prefetchSource = (entry, orderIndex) => prefetchLimiter(async () => {
      const controller = new AbortController();
      activeControllersRef.current.add(controller);

      try {
        const response = await fetch(entry.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Failed to fetch ${entry.url} (status ${response.status})`);

        const blob = await response.blob();
        if (!(blob instanceof Blob) || blob.size <= 0) {
          throw new Error(`Fetched source ${entry.url} is empty or invalid.`);
        }

        let detectedType = null;
        try { detectedType = await fileTypeFromBlob(blob); } catch {}

        const mimeType = String(
          detectedType?.mime
          || response.headers.get('content-type')
          || blob.type
          || 'application/octet-stream'
        );

        const fileExtension = normalizeExtension(
          detectedType?.ext
          || mimeToExtension(mimeType)
          || entry.ext
          || inferUrlExtension(entry.url)
          || 'png'
        );

        const sourceKey = createSourceKey(entry.fileIndex, orderIndex);
        const stored = await storeSourceBlob({
          sourceKey,
          blob,
          fileExtension,
          mimeType,
          originalUrl: entry.url,
          fileIndex: entry.fileIndex,
        });

        return {
          ok: true,
          sourceKey,
          fileExtension,
          mimeType,
          sizeBytes: Number(blob.size || 0),
          fileIndex: entry.fileIndex,
          url: entry.url,
          stats: stored?.stats || null,
          analysisBlob: blob,
          pageCountHint: fileExtension === 'pdf' || fileExtension === 'tiff' ? undefined : 1,
        };
      } catch (error) {
        if (controller.signal.aborted || cancelled) {
          return {
            ok: false,
            aborted: true,
            fileIndex: entry.fileIndex,
            url: entry.url,
          };
        }
        logger.error('Prefetch failed', {
          url: entry.url,
          fileIndex: entry.fileIndex,
          error: String(error?.message || error),
        });
        return {
          ok: false,
          error,
          fileIndex: entry.fileIndex,
          url: entry.url,
        };
      } finally {
        activeControllersRef.current.delete(controller);
      }
    });

    const run = async () => {
      setError(null);
      setWorkerCount(0);

      if (!entries.length) {
        setLoadingRunActive(false);
        setPlannedPageCount(0);
        return;
      }

      const sourceWarningThreshold = Math.max(0, Number(config.warning.sourceCountThreshold) || 0);
      if (sourceWarningThreshold > 0 && entries.length >= sourceWarningThreshold) {
        const accepted = await maybePrompt({
          phase: 'preload',
          sourceCount: entries.length,
          discoveredPageCount: 0,
          estimatedPageCount: 0,
          prefetchedBytes: 0,
          tempStoreMode: config.sourceStore.mode === 'indexeddb' ? 'indexeddb' : 'memory',
          tempStoreProtected: config.sourceStore.protection === 'aes-gcm-session',
          recommendStop: shouldRecommendStopping({
            sourceCount: entries.length,
            pageCount: 0,
            config,
          }),
        });

        if (!accepted || cancelled || !isMountedRef.current) {
          const msg = safeMessage(t('viewer.loadPressure.stoppedMessage'));
          if (msg) addMessage(msg);
          setLoadingRunActive(false);
          return;
        }
      }

      await initializeDocumentSession({
        expectedSourceCount: entries.length,
        config,
      });

      if (cancelled || !isMountedRef.current) return;

      setLoadingRunActive(true);
      setPlannedPageCount(0);

      const prefetchTasks = entries.map((entry, orderIndex) => prefetchSource(entry, orderIndex));
      let nextPageIndex = 0;
      let processedSourceCount = 0;
      let prefetchedBytes = 0;
      let pageWarningShown = false;
      let activeTempStoreMode = config.sourceStore.mode === 'indexeddb' ? 'indexeddb' : 'memory';
      const tempStoreProtected = config.sourceStore.protection === 'aes-gcm-session';

      for (let i = 0; i < prefetchTasks.length; i += 1) {
        if (cancelled || !isMountedRef.current) break;

        const result = await prefetchTasks[i];
        if (cancelled || !isMountedRef.current) break;

        if (!result.ok) {
          if (result.aborted) break;
          const failedPages = createFailedPlaceholder({
            fileIndex: result.fileIndex,
            startIndex: nextPageIndex,
          });
          insertPagesAtIndex(failedPages, nextPageIndex);
          nextPageIndex += failedPages.length;
          processedSourceCount += 1;
          setPlannedPageCount(nextPageIndex);
          continue;
        }

        prefetchedBytes += Number(result.sizeBytes || 0);
        if (result.stats?.mode) activeTempStoreMode = result.stats.mode;

        let pageCount = Math.max(1, Number(result.pageCountHint) || 1);
        if (!result.pageCountHint) {
          try {
            const analysisBlob = result.analysisBlob instanceof Blob ? result.analysisBlob : null;
            const arrayBuffer = analysisBlob
              ? await analysisBlob.arrayBuffer()
              : null;
            if (!arrayBuffer) throw new Error(`Prefetched source is missing analysis bytes for ${result.sourceKey}`);
            pageCount = Math.max(1, Number(await getTotalPages(arrayBuffer, result.fileExtension)) || 1);
          } catch (error) {
            logger.warn('Failed to determine page count; falling back to 1 page', {
              sourceKey: result.sourceKey,
              url: result.url,
              error: String(error?.message || error),
            });
            pageCount = 1;
          }
        }
        result.analysisBlob = undefined;

        processedSourceCount += 1;

        registerSourceDescriptor({
          sourceKey: result.sourceKey,
          fileExtension: result.fileExtension,
          fileIndex: result.fileIndex,
          pageCount,
          mimeType: result.mimeType,
          sourceUrl: result.url,
          sizeBytes: result.sizeBytes,
        });

        const placeholders = createPagePlaceholders({
          fileIndex: result.fileIndex,
          sourceKey: result.sourceKey,
          fileExtension: result.fileExtension,
          pageCount,
          mimeType: result.mimeType,
          sizeBytes: Number(result.sizeBytes || 0),
          startIndex: nextPageIndex,
        });

        insertPagesAtIndex(placeholders, nextPageIndex);
        nextPageIndex += placeholders.length;
        setPlannedPageCount(nextPageIndex);

        if (processedSourceCount === 1 && nextPageIndex > 0) {
          try { void ensurePageAsset(0, 'thumbnail', { priority: 'high' }); } catch {}
          try { void ensurePageAsset(0, 'full', { priority: 'critical' }); } catch {}
        }

        const estimatedTotalPages = processedSourceCount >= config.warning.probePageThresholdSources
          ? Math.max(nextPageIndex, Math.round((nextPageIndex / processedSourceCount) * entries.length))
          : nextPageIndex;

        const pageWarningThreshold = Math.max(0, Number(config.warning.pageCountThreshold) || 0);
        const exceedsPageThreshold = pageWarningThreshold > 0
          && !pageWarningShown
          && processedSourceCount < entries.length
          && (
            nextPageIndex >= pageWarningThreshold
            || estimatedTotalPages >= pageWarningThreshold
          );

        if (exceedsPageThreshold) {
          pageWarningShown = true;
          const accepted = await maybePrompt({
            phase: 'analysis',
            sourceCount: entries.length,
            discoveredPageCount: nextPageIndex,
            estimatedPageCount: estimatedTotalPages,
            prefetchedBytes,
            tempStoreMode: activeTempStoreMode,
            tempStoreProtected,
            recommendStop: shouldRecommendStopping({
              sourceCount: entries.length,
              pageCount: estimatedTotalPages,
              config,
            }),
          });

          if (!accepted || cancelled || !isMountedRef.current) {
            abortAllFetches();
            const msg = safeMessage(t('viewer.loadPressure.stoppedMessage'));
            if (msg) addMessage(msg);
            setLoadingRunActive(false);
            setPlannedPageCount(nextPageIndex);
            return;
          }
        }
      }

      if (!cancelled && isMountedRef.current) {
        setLoadingRunActive(false);
        setPlannedPageCount(nextPageIndex);

        if (nextPageIndex > 0) {
          try { void ensurePageAsset(0, 'thumbnail', { priority: 'high' }); } catch {}
          try { void ensurePageAsset(0, 'full', { priority: 'critical' }); } catch {}
        }
      }
    };

    run().catch((error) => {
      if (!cancelled && isMountedRef.current) {
        logger.error('DocumentLoader run failed', { error: String(error?.message || error) });
        setError(String(error?.message || error));
        setLoadingRunActive(false);
      }
    });

    return () => {
      cancelled = true;
      abortAllFetches();
      const resolver = promptResolverRef.current;
      promptResolverRef.current = null;
      if (resolver) resolver(false);
      setPressureSummary(null);
      setLoadingRunActive(false);
      setWorkerCount(0);
    };
  }, [
    addMessage,
    demoCount,
    demoFormats,
    demoMode,
    demoStrategy,
    endNumber,
    ensurePageAsset,
    extension,
    folder,
    initializeDocumentSession,
    insertPagesAtIndex,
    promptForPressure,
    registerSourceDescriptor,
    setError,
    setLoadingRunActive,
    setPlannedPageCount,
    setWorkerCount,
    sourceList,
    storeSourceBlob,
    t,
  ]);

  return React.createElement(
    React.Fragment,
    null,
    children,
    React.createElement(LoadPressureDialog, {
      open: !!pressureSummary,
      summary: pressureSummary,
      onStop: () => resolvePressurePrompt(false),
      onContinue: () => resolvePressurePrompt(true),
    })
  );
};

export default DocumentLoader;
