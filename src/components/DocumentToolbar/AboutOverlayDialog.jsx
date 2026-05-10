// File: src/components/DocumentToolbar/AboutOverlayDialog.jsx
/**
 * Small About dialog for version/build/support information.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getRuntimeConfig } from '../../utils/runtimeConfig.js';
import { collectSupportDiagnostics, downloadJsonFile, loadLatestPdfBenchmarkResult, loadLatestRenderDecodeBenchmarkResult } from '../../utils/supportDiagnostics.js';

/**
 * @returns {{ version:string, buildId:string, githubUrl:string, contactEmail:string }}
 */
function resolveAboutInfo() {
  const cfg = getRuntimeConfig();
  const version = String(
    (typeof window !== 'undefined' && (window.__ODV_APP_VERSION__ || window.__APP_VERSION__))
      || (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env.VITE_APP_VERSION || import.meta.env.APP_VERSION))
      || 'unknown'
  );
  const buildId = String(
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.ODV_BUILD_ID)
      || ''
  ).trim();
  return {
    version,
    buildId,
    githubUrl: String(cfg?.help?.about?.githubUrl || 'https://github.com/Optimal2/OpenDocViewer').trim(),
    contactEmail: String(cfg?.help?.about?.contactEmail || 'dev@optimal2.se').trim(),
  };
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {boolean=} props.benchmarkEnabled
 * @param {function(Object=): Promise<Object>=} props.onRunPdfBenchmark
 * @param {boolean=} props.renderBenchmarkEnabled
 * @param {function(Object=): Promise<Object>=} props.onRunRenderBenchmark
 * @returns {(React.ReactElement|null)}
 */
export default function AboutOverlayDialog({
  isOpen,
  onClose,
  benchmarkEnabled = false,
  onRunPdfBenchmark,
  renderBenchmarkEnabled = false,
  onRunRenderBenchmark,
}) {
  const { t } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const aboutInfo = useMemo(() => resolveAboutInfo(), []);
  const [latestBenchmark, setLatestBenchmark] = useState(() => loadLatestPdfBenchmarkResult());
  const [latestRenderBenchmark, setLatestRenderBenchmark] = useState(() => loadLatestRenderDecodeBenchmarkResult());
  const [benchmarkState, setBenchmarkState] = useState(/** @type {{status:string,message:string}} */ ({ status: 'idle', message: '' }));
  const [renderBenchmarkState, setRenderBenchmarkState] = useState(/** @type {{status:string,message:string}} */ ({ status: 'idle', message: '' }));

  useEffect(() => {
    if (!isOpen) return undefined;
    setLatestBenchmark(loadLatestPdfBenchmarkResult());
    setLatestRenderBenchmark(loadLatestRenderDecodeBenchmarkResult());
    dialogRef.current?.focus?.();

    /** @param {KeyboardEvent} event */
    const handleEscape = (event) => {
      if (String(event?.key || '') !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    };

    document.addEventListener('keydown', handleEscape, true);
    window.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('keydown', handleEscape, true);
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [isOpen, onClose]);

  const diagnostics = useMemo(() => collectSupportDiagnostics({
    latestPdfBenchmark: latestBenchmark,
    latestRenderDecodeBenchmark: latestRenderBenchmark,
  }), [latestBenchmark, latestRenderBenchmark]);

  const downloadDiagnostics = useCallback(() => {
    downloadJsonFile('opendocviewer-diagnostics.json', collectSupportDiagnostics({
      latestPdfBenchmark: latestBenchmark,
      latestRenderDecodeBenchmark: latestRenderBenchmark,
    }));
  }, [latestBenchmark, latestRenderBenchmark]);

  const downloadBenchmark = useCallback(() => {
    if (!latestBenchmark) return;
    downloadJsonFile('opendocviewer-pdf-benchmark.json', latestBenchmark);
  }, [latestBenchmark]);

  const downloadRenderBenchmark = useCallback(() => {
    if (!latestRenderBenchmark) return;
    downloadJsonFile('opendocviewer-render-decode-benchmark.json', latestRenderBenchmark);
  }, [latestRenderBenchmark]);

  const runBenchmark = useCallback(async () => {
    if (!benchmarkEnabled || typeof onRunPdfBenchmark !== 'function') return;
    setBenchmarkState({
      status: 'running',
      message: t('about.diagnostics.benchmarkRunning', { defaultValue: 'Running PDF benchmark…' }),
    });
    try {
      const result = await onRunPdfBenchmark({
        onProgress: (event) => {
          const completed = Math.max(0, Number(event?.completedRuns || 0));
          const total = Math.max(1, Number(event?.totalRuns || 1));
          if (event?.phase === 'running') {
            const scenario = String(event?.scenarioLabel || '').trim();
            setBenchmarkState({
              status: 'running',
              message: t('about.diagnostics.benchmarkProgress', {
                current: completed + 1,
                total,
                scenario,
                defaultValue: scenario
                  ? `Running benchmark ${completed + 1} of ${total}: ${scenario}…`
                  : `Running benchmark ${completed + 1} of ${total}…`,
              }),
            });
          }
        },
      });
      setLatestBenchmark(result);
      setBenchmarkState({
        status: 'done',
        message: t('about.diagnostics.benchmarkDone', { defaultValue: 'Benchmark completed.' }),
      });
    } catch (error) {
      setBenchmarkState({
        status: 'error',
        message: t('about.diagnostics.benchmarkError', {
          error: String(error?.message || error),
          defaultValue: `Benchmark failed: ${String(error?.message || error)}`,
        }),
      });
    }
  }, [benchmarkEnabled, onRunPdfBenchmark, t]);

  const runRenderBenchmark = useCallback(async () => {
    if (!renderBenchmarkEnabled || typeof onRunRenderBenchmark !== 'function') return;
    setRenderBenchmarkState({
      status: 'running',
      message: t('about.diagnostics.renderBenchmarkRunning', { defaultValue: 'Running render/decode benchmark…' }),
    });
    try {
      const result = await onRunRenderBenchmark({
        onProgress: (event) => {
          const completed = Math.max(0, Number(event?.completedRuns || 0));
          const total = Math.max(1, Number(event?.totalRuns || 1));
          if (event?.phase === 'running') {
            const scenario = String(event?.scenarioLabel || '').trim();
            setRenderBenchmarkState({
              status: 'running',
              message: t('about.diagnostics.renderBenchmarkProgress', {
                current: completed + 1,
                total,
                scenario,
                defaultValue: scenario
                  ? `Running render/decode benchmark ${completed + 1} of ${total}: ${scenario}…`
                  : `Running render/decode benchmark ${completed + 1} of ${total}…`,
              }),
            });
          }
        },
      });
      setLatestRenderBenchmark(result);
      setRenderBenchmarkState({
        status: 'done',
        message: t('about.diagnostics.renderBenchmarkDone', { defaultValue: 'Render/decode benchmark completed.' }),
      });
    } catch (error) {
      setRenderBenchmarkState({
        status: 'error',
        message: t('about.diagnostics.renderBenchmarkError', {
          error: String(error?.message || error),
          defaultValue: `Render/decode benchmark failed: ${String(error?.message || error)}`,
        }),
      });
    }
  }, [onRunRenderBenchmark, renderBenchmarkEnabled, t]);

  const benchmarkSummary = latestBenchmark?.best
    ? t('about.diagnostics.benchmarkSummary', {
        ms: latestBenchmark.best.durationMs,
        pages: latestBenchmark.pageCount,
        batch: latestBenchmark.best.scenarioLabel || latestBenchmark.best.batchSizeLabel,
        defaultValue: `Best run: ${latestBenchmark.best.durationMs} ms, ${latestBenchmark.pageCount} pages, ${latestBenchmark.best.scenarioLabel || `batch ${latestBenchmark.best.batchSizeLabel}`}.`,
      })
    : t('about.diagnostics.noBenchmark', { defaultValue: 'No PDF benchmark result has been recorded.' });

  const renderBenchmarkSummary = latestRenderBenchmark?.best
    ? t('about.diagnostics.renderBenchmarkSummary', {
        ms: latestRenderBenchmark.best.durationMs,
        pages: latestRenderBenchmark.pageCount,
        scenario: latestRenderBenchmark.best.scenarioLabel,
        defaultValue: `Best render/decode run: ${latestRenderBenchmark.best.durationMs} ms, ${latestRenderBenchmark.pageCount} pages, ${latestRenderBenchmark.best.scenarioLabel}.`,
      })
    : t('about.diagnostics.noRenderBenchmark', { defaultValue: 'No render/decode benchmark result has been recorded.' });

  if (!isOpen) return null;

  return (
    <div
      className="odv-help-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-about-title"
      data-odv-shortcuts="off"
      onKeyDownCapture={(event) => {
        if (String(event?.key || '') !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className="odv-help-dialog odv-about-dialog"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="odv-help-header">
          <div>
            <h2 id="odv-about-title" className="odv-help-title">
              {t('about.title', { defaultValue: 'About OpenDocViewer' })}
            </h2>
            <p className="odv-help-subtitle">
              {t('about.subtitle', { defaultValue: 'Version, project links, and support contact.' })}
            </p>
          </div>
          <button
            type="button"
            className="odv-help-close-icon"
            onClick={onClose}
            aria-label={t('about.close', { defaultValue: 'Close' })}
            title={t('about.close', { defaultValue: 'Close' })}
          >
            <span className="material-icons" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="odv-help-body odv-about-body">
          <div className="odv-about-grid">
            <div className="odv-about-row">
              <div className="odv-about-label">{t('about.version', { defaultValue: 'Version' })}</div>
              <div className="odv-about-value"><code>{aboutInfo.version}</code></div>
            </div>
            {aboutInfo.buildId ? (
              <div className="odv-about-row">
                <div className="odv-about-label">{t('about.buildId', { defaultValue: 'Build id' })}</div>
                <div className="odv-about-value"><code>{aboutInfo.buildId}</code></div>
              </div>
            ) : null}
            <div className="odv-about-row">
              <div className="odv-about-label">{t('about.project', { defaultValue: 'Project' })}</div>
              <div className="odv-about-value">
                <a href={aboutInfo.githubUrl} target="_blank" rel="noopener noreferrer">{aboutInfo.githubUrl}</a>
              </div>
            </div>
            <div className="odv-about-row">
              <div className="odv-about-label">{t('about.contact', { defaultValue: 'Contact' })}</div>
              <div className="odv-about-value">
                <a href={`mailto:${aboutInfo.contactEmail}`}>{aboutInfo.contactEmail}</a>
              </div>
            </div>
          </div>
          <details className="odv-about-diagnostics">
            <summary>{t('about.diagnostics.summary', { defaultValue: 'Diagnostics' })}</summary>
            <div className="odv-about-diagnostics-actions">
              <button type="button" className="odv-help-close-button" onClick={downloadDiagnostics}>
                {t('about.diagnostics.download', { defaultValue: 'Download diagnostics JSON' })}
              </button>
              {benchmarkEnabled ? (
                <button
                  type="button"
                  className="odv-help-close-button"
                  onClick={runBenchmark}
                  disabled={benchmarkState.status === 'running' || renderBenchmarkState.status === 'running'}
                >
                  {benchmarkState.status === 'running'
                    ? t('about.diagnostics.benchmarkRunningShort', { defaultValue: 'Running…' })
                    : t('about.diagnostics.runBenchmark', { defaultValue: 'Run PDF benchmark' })}
                </button>
              ) : null}
              {latestBenchmark ? (
                <button type="button" className="odv-help-close-button" onClick={downloadBenchmark}>
                  {t('about.diagnostics.downloadBenchmark', { defaultValue: 'Download benchmark JSON' })}
                </button>
              ) : null}
              {renderBenchmarkEnabled ? (
                <button
                  type="button"
                  className="odv-help-close-button"
                  onClick={runRenderBenchmark}
                  disabled={benchmarkState.status === 'running' || renderBenchmarkState.status === 'running'}
                >
                  {renderBenchmarkState.status === 'running'
                    ? t('about.diagnostics.renderBenchmarkRunningShort', { defaultValue: 'Running…' })
                    : t('about.diagnostics.runRenderBenchmark', { defaultValue: 'Run render/decode benchmark' })}
                </button>
              ) : null}
              {latestRenderBenchmark ? (
                <button type="button" className="odv-help-close-button" onClick={downloadRenderBenchmark}>
                  {t('about.diagnostics.downloadRenderBenchmark', { defaultValue: 'Download render/decode JSON' })}
                </button>
              ) : null}
            </div>
            {benchmarkEnabled || latestBenchmark ? (
              <p className={`odv-about-diagnostics-status is-${benchmarkState.status}`}>
                {benchmarkState.message || benchmarkSummary}
              </p>
            ) : null}
            {renderBenchmarkEnabled || latestRenderBenchmark ? (
              <p className={`odv-about-diagnostics-status is-${renderBenchmarkState.status}`}>
                {renderBenchmarkState.message || renderBenchmarkSummary}
              </p>
            ) : null}
            <pre className="odv-about-diagnostics-json">
              {JSON.stringify({
                app: diagnostics.app,
                navigator: diagnostics.navigator,
                config: diagnostics.config,
                latestPdfBenchmark: latestBenchmark ? {
                  createdUtc: latestBenchmark.createdUtc,
                  pageCount: latestBenchmark.pageCount,
                  testedStrategies: latestBenchmark.testedStrategies,
                  testedWorkerCounts: latestBenchmark.testedWorkerCounts,
                  testedBatchSizes: latestBenchmark.testedBatchSizes,
                  testedImageLoadConcurrencies: latestBenchmark.testedImageLoadConcurrencies,
                  scenarioCount: latestBenchmark.scenarioCount,
                  best: latestBenchmark.best,
                  bestTimings: latestBenchmark.best?.timings || null,
                } : null,
                latestRenderDecodeBenchmark: latestRenderBenchmark ? {
                  createdUtc: latestRenderBenchmark.createdUtc,
                  pageCount: latestRenderBenchmark.pageCount,
                  testedVariants: latestRenderBenchmark.testedVariants,
                  testedWorkerCounts: latestRenderBenchmark.testedWorkerCounts,
                  scenarioCount: latestRenderBenchmark.scenarioCount,
                  best: latestRenderBenchmark.best,
                } : null,
              }, null, 2)}
            </pre>
          </details>
        </div>

        <div className="odv-help-footer">
          <button type="button" className="odv-help-close-button" onClick={onClose}>
            {t('about.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}

AboutOverlayDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  benchmarkEnabled: PropTypes.bool,
  onRunPdfBenchmark: PropTypes.func,
  renderBenchmarkEnabled: PropTypes.bool,
  onRunRenderBenchmark: PropTypes.func,
};
