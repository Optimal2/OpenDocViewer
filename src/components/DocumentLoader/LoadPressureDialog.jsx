// File: src/components/DocumentLoader/LoadPressureDialog.jsx
import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { formatBytes, formatCount } from '../../utils/documentLoadingConfig.js';


/**
 * @typedef {Object} LoadPressureDialogSummary
 * @property {string=} phase
 * @property {number=} sourceCount
 * @property {number=} discoveredPageCount
 * @property {number=} estimatedPageCount
 * @property {number=} prefetchedBytes
 * @property {string=} tempStoreMode
 * @property {boolean=} tempStoreProtected
 * @property {number=} prefetchConcurrency
 * @property {boolean=} recommendStop
 */

/**
 * @typedef {Object} LoadPressureDialogProps
 * @property {boolean} open
 * @property {(LoadPressureDialogSummary|null)} summary
 * @property {function(): void} onStop
 * @property {function(): void} onContinue
 */

/**
 * Large-load warning dialog shown before / during very heavy loading runs.
 *
 * @param {LoadPressureDialogProps} props
 * @returns {React.ReactElement|null}
 */
export default function LoadPressureDialog({ open, summary, onStop, onContinue }) {
  const { t } = useTranslation('common');

  /**
   * @param {string} key
   * @param {string} fallback
   * @returns {string}
   */
  const tr = (key, fallback) => {
    const resolved = t(key, { defaultValue: fallback });
    return resolved === key ? fallback : resolved;
  };
  const stopButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    stopButtonRef.current?.focus?.();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onStop();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onStop]);

  const storageModeLabel = String(summary?.tempStoreMode || '').toLowerCase() === 'indexeddb'
    ? tr('viewer.loadPressure.storageModeIndexedDb', 'Browser disk cache')
    : tr('viewer.loadPressure.storageModeMemory', 'Memory');

  if (!open || !summary) return null;

  const discoveredPageCount = Math.max(0, Number(summary.discoveredPageCount) || 0);
  const estimatedPageCount = Math.max(0, Number(summary.estimatedPageCount) || 0);
  const showEstimated = estimatedPageCount > 0 && estimatedPageCount >= discoveredPageCount;
  const descriptionKey = summary.phase === 'analysis'
    ? 'viewer.loadPressure.descriptionAnalysis'
    : 'viewer.loadPressure.descriptionPreload';

  return (
    <div className="odv-pressure-backdrop" role="presentation">
      <div
        className="odv-pressure-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="odv-pressure-title"
        aria-describedby="odv-pressure-desc"
      >
        <h2 id="odv-pressure-title" className="odv-pressure-title">
          {tr('viewer.loadPressure.title', 'Large document batch detected')}
        </h2>
        <p id="odv-pressure-desc" className="odv-pressure-desc">
          {tr(descriptionKey, summary.phase === 'analysis' ? 'The loading run is larger than expected after analyzing the prefetched files. You can stop now and retry with a smaller batch or continue at your own risk.' : 'This loading run contains many source files. OpenDocViewer can prefetch them into temporary browser storage and render pages lazily, but the operation can still consume substantial memory, CPU, and local disk resources.')}
        </p>

        <dl className="odv-pressure-grid">
          <div className="odv-pressure-metric">
            <dt>{tr('viewer.loadPressure.sourcesLabel', 'Sources')}</dt>
            <dd>{formatCount(summary.sourceCount || 0)}</dd>
          </div>
          <div className="odv-pressure-metric">
            <dt>{tr('viewer.loadPressure.pagesDiscoveredLabel', 'Pages discovered')}</dt>
            <dd>{formatCount(discoveredPageCount)}</dd>
          </div>
          {showEstimated && (
            <div className="odv-pressure-metric">
              <dt>{tr('viewer.loadPressure.estimatedPagesLabel', 'Estimated total pages')}</dt>
              <dd>{formatCount(estimatedPageCount)}</dd>
            </div>
          )}
          <div className="odv-pressure-metric">
            <dt>{tr('viewer.loadPressure.prefetchedBytesLabel', 'Prefetched data')}</dt>
            <dd>{formatBytes(summary.prefetchedBytes || 0)}</dd>
          </div>
          <div className="odv-pressure-metric">
            <dt>{tr('viewer.loadPressure.storageModeLabel', 'Temp storage mode')}</dt>
            <dd>{storageModeLabel}</dd>
          </div>
          <div className="odv-pressure-metric">
            <dt>{tr('viewer.loadPressure.storageProtectedLabel', 'Temp storage protection')}</dt>
            <dd>
              {summary.tempStoreProtected
                ? tr('viewer.loadPressure.storageProtectedOn', 'Session-encrypted')
                : tr('viewer.loadPressure.storageProtectedOff', 'Disabled')}
            </dd>
          </div>
          <div className="odv-pressure-metric">
            <dt>{tr('viewer.loadPressure.prefetchConcurrencyLabel', 'Prefetch concurrency')}</dt>
            <dd>{formatCount(summary.prefetchConcurrency || 0)}</dd>
          </div>
        </dl>

        <p className={`odv-pressure-note ${summary.recommendStop ? 'recommend' : ''}`}>
          {summary.recommendStop
            ? tr('viewer.loadPressure.recommendStop', 'Recommendation: stop loading and retry with fewer files or lower concurrency if possible.')
            : tr('viewer.loadPressure.continueNote', 'Continuing is usually acceptable for moderate runs, but the browser may still become slow on very large batches.')}
        </p>

        <div className="odv-pressure-footer">
          <button
            ref={stopButtonRef}
            type="button"
            className="odv-pressure-btn secondary"
            onClick={onStop}
          >
            {tr('viewer.loadPressure.stop', 'Stop loading')}
          </button>
          <button
            type="button"
            className="odv-pressure-btn primary"
            onClick={onContinue}
          >
            {tr('viewer.loadPressure.continue', 'Continue anyway')}
          </button>
        </div>
      </div>
    </div>
  );
}

LoadPressureDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  summary: PropTypes.shape({
    phase: PropTypes.string,
    sourceCount: PropTypes.number,
    discoveredPageCount: PropTypes.number,
    estimatedPageCount: PropTypes.number,
    prefetchedBytes: PropTypes.number,
    tempStoreMode: PropTypes.string,
    tempStoreProtected: PropTypes.bool,
    prefetchConcurrency: PropTypes.number,
    recommendStop: PropTypes.bool,
  }),
  onStop: PropTypes.func.isRequired,
  onContinue: PropTypes.func.isRequired,
};
