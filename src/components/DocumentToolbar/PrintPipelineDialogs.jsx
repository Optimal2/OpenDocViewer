// File: src/components/DocumentToolbar/PrintPipelineDialogs.jsx
/**
 * File: src/components/DocumentToolbar/PrintPipelineDialogs.jsx
 *
 * The dialogs of the ONE print pipeline (usePrintPipeline.js): the print dialog and the generated-PDF
 * progress (modal, or a dock while working in the background).
 *
 * DocumentViewer.jsx renders this host once, next to the toolbar and the compare views, so the
 * dialog and the progress stay available while a compare view replaces the toolbar.
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import PrintRangeDialog from './PrintRangeDialog.jsx';

/**
 * @param {function(string,Object=): string} t
 * @param {{ action:string, phase:string, current:number, progressValue:number, page:number, total:number }} progress
 * @returns {string}
 */
function formatPdfProgressBody(t, progress) {
  if (progress.phase === 'ready') {
    return progress.action === 'download'
      ? t('printDialog.pdfProgress.readyDownloadBody', { defaultValue: 'The export file is ready. Save it when you are ready.' })
      : t('printDialog.pdfProgress.readyPrintBody', { defaultValue: 'The print file is ready. Open print preview when you are ready.' });
  }
  const percent = getPdfProgressPercent(progress);
  return t('printDialog.pdfProgress.percent', {
    percent,
    defaultValue: `${percent}%`,
  });
}

/**
 * @param {{ current:number, progressValue:number, total:number }} progress
 * @returns {number}
 */
function getPdfProgressPercent(progress) {
  const total = Math.max(1, Number(progress.total) || 1);
  const rawValue = Number(progress.progressValue);
  const value = Number.isFinite(rawValue) ? rawValue : progress.current;
  return Math.max(4, Math.min(100, Math.round((Math.max(0, Math.min(total, value)) / total) * 100)));
}

/**
 * @param {Object} props
 * @param {Object} props.pipeline The instance returned by usePrintPipeline().
 * @returns {React.ReactElement}
 */
export default function PrintPipelineDialogs({ pipeline }) {
  const { t } = useTranslation('common');
  const {
    dialogProps,
    pdfProgress,
    resetPdfProgress,
    minimizePdfProgress,
    requestCancelPdfProgress,
    finishPendingPdfOutput,
  } = pipeline;
  const isPdfProgressCancelling = pdfProgress.phase === 'cancelling';
  const isPdfProgressCancelled = pdfProgress.phase === 'cancelled';
  const isPdfProgressReady = pdfProgress.phase === 'ready';

  return (
    <>
      {/* Modal for print selection + reason/forWhom */}
      <PrintRangeDialog {...dialogProps} />

      {pdfProgress.open && pdfProgress.minimized ? (
        <div
          className="odv-pdf-progress-dock"
          role="region"
          aria-live="polite"
          aria-label={pdfProgress.action === 'download'
            ? t('printDialog.pdfProgress.downloadTitle', { defaultValue: 'Creating PDF' })
            : t('printDialog.pdfProgress.printTitle', { defaultValue: 'Preparing PDF print' })}
        >
          <div className="odv-pdf-progress-dock-icon" aria-hidden="true">
            <span className="material-icons">picture_as_pdf</span>
          </div>
          <div className="odv-pdf-progress-dock-copy">
            <strong>{pdfProgress.action === 'download'
              ? t('printDialog.pdfProgress.downloadTitle', { defaultValue: 'Preparing export' })
              : t('printDialog.pdfProgress.printTitle', { defaultValue: 'Preparing print' })}</strong>
            <span>{pdfProgress.error
              ? t('printDialog.pdfProgress.error', { error: pdfProgress.error, defaultValue: `Output generation failed: ${pdfProgress.error}` })
              : isPdfProgressCancelled
                ? t('printDialog.pdfProgress.cancelled', { defaultValue: 'Generation was cancelled.' })
                : isPdfProgressCancelling
                  ? t('printDialog.pdfProgress.cancelling', { defaultValue: 'Cancelling generation…' })
                  : formatPdfProgressBody(t, pdfProgress)}</span>
            {!pdfProgress.error && !isPdfProgressCancelled ? (
              <div className="odv-pdf-progress-track" aria-hidden="true">
                <div
                  className="odv-pdf-progress-bar"
                  style={{ width: `${getPdfProgressPercent(pdfProgress)}%` }}
                />
              </div>
            ) : null}
          </div>
          <div className="odv-pdf-progress-dock-actions">
            {isPdfProgressReady ? (
              <button
                type="button"
                className="odv-print-preparing-close odv-pdf-progress-primary"
                onClick={finishPendingPdfOutput}
              >
                {pdfProgress.action === 'download'
                  ? t('printDialog.pdfProgress.readyDownloadAction', { defaultValue: 'Save' })
                  : t('printDialog.pdfProgress.readyPrintAction', { defaultValue: 'Open print' })}
              </button>
            ) : null}
            {pdfProgress.error || isPdfProgressReady ? (
              <button
                type="button"
                className="odv-print-preparing-close"
                onClick={resetPdfProgress}
              >
                {t('printDialog.preparing.dismiss', { defaultValue: 'Close' })}
              </button>
            ) : !isPdfProgressCancelled ? (
              <button
                type="button"
                className="odv-print-preparing-close"
                onClick={requestCancelPdfProgress}
                disabled={isPdfProgressCancelling}
              >
                {isPdfProgressCancelling
                  ? t('printDialog.pdfProgress.cancellingButton', { defaultValue: 'Cancelling…' })
                  : t('printDialog.pdfProgress.cancel', { defaultValue: 'Cancel' })}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {pdfProgress.open && !pdfProgress.minimized ? (
        <div
          className="odv-print-preparing-backdrop"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-labelledby="odv-pdf-progress-title"
        >
          <div className="odv-print-preparing-dialog odv-pdf-progress-dialog">
            <div className="odv-print-preparing-icon" aria-hidden="true">
              <span className="material-icons">picture_as_pdf</span>
            </div>
            <div className="odv-print-preparing-copy">
              <h3 id="odv-pdf-progress-title">{pdfProgress.action === 'download'
                ? t('printDialog.pdfProgress.downloadTitle', { defaultValue: 'Preparing export' })
                : t('printDialog.pdfProgress.printTitle', { defaultValue: 'Preparing print' })}</h3>
              <p>{pdfProgress.error
                ? t('printDialog.pdfProgress.error', { error: pdfProgress.error, defaultValue: `Output generation failed: ${pdfProgress.error}` })
                : isPdfProgressCancelled
                  ? t('printDialog.pdfProgress.cancelled', { defaultValue: 'Generation was cancelled.' })
                  : isPdfProgressCancelling
                    ? t('printDialog.pdfProgress.cancelling', { defaultValue: 'Cancelling generation…' })
                    : formatPdfProgressBody(t, pdfProgress)}</p>
              {!pdfProgress.error && !isPdfProgressCancelled ? (
                <div className="odv-pdf-progress-track" aria-hidden="true">
                  <div
                    className="odv-pdf-progress-bar"
                    style={{ width: `${getPdfProgressPercent(pdfProgress)}%` }}
                  />
                </div>
              ) : null}
            </div>
            <div className="odv-pdf-progress-modal-actions">
              {pdfProgress.error ? (
                <button
                  type="button"
                  className="odv-print-preparing-close"
                  onClick={resetPdfProgress}
                >
                  {t('printDialog.preparing.dismiss', { defaultValue: 'Close' })}
                </button>
              ) : !isPdfProgressCancelled ? (
                <>
                  {!isPdfProgressCancelling ? (
                    <button
                      type="button"
                      className="odv-print-preparing-close odv-pdf-progress-background"
                      onClick={minimizePdfProgress}
                    >
                      {t('printDialog.pdfProgress.backgroundAction', { defaultValue: 'Continue working' })}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="odv-print-preparing-close"
                    onClick={requestCancelPdfProgress}
                    disabled={isPdfProgressCancelling}
                  >
                    {isPdfProgressCancelling
                      ? t('printDialog.pdfProgress.cancellingButton', { defaultValue: 'Cancelling…' })
                      : t('printDialog.pdfProgress.cancel', { defaultValue: 'Cancel' })}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

PrintPipelineDialogs.propTypes = {
  pipeline: PropTypes.shape({
    dialogProps: PropTypes.object.isRequired,
    pdfProgress: PropTypes.object.isRequired,
    resetPdfProgress: PropTypes.func.isRequired,
    minimizePdfProgress: PropTypes.func.isRequired,
    requestCancelPdfProgress: PropTypes.func.isRequired,
    finishPendingPdfOutput: PropTypes.func.isRequired,
  }).isRequired,
};
