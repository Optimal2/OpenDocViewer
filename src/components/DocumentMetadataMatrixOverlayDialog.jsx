// File: src/components/DocumentMetadataMatrixOverlayDialog.jsx
/**
 * Session-wide document metadata matrix overlay.
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {*} props.matrixView
 * @returns {(React.ReactElement|null)}
 */
export default function DocumentMetadataMatrixOverlayDialog({
  isOpen,
  onClose,
  matrixView,
}) {
  const { t } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));

  useEffect(() => {
    if (!isOpen) return undefined;
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

  if (!isOpen || !matrixView || !Array.isArray(matrixView.columns) || matrixView.columns.length <= 0 || !Array.isArray(matrixView.documents) || matrixView.documents.length <= 0) {
    return null;
  }

  return (
    <div
      className="odv-metadata-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-metadata-matrix-title"
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
        className="odv-metadata-dialog odv-metadata-dialog-matrix"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="odv-metadata-header">
          <div>
            <h2 id="odv-metadata-matrix-title" className="odv-metadata-title">
              {t('metadataMatrix.title', { defaultValue: 'Document metadata overview' })}
            </h2>
            <p className="odv-metadata-subtitle">
              {t('metadataMatrix.subtitle', {
                documents: matrixView.documents.length,
                fields: matrixView.columns.length,
                defaultValue: `${matrixView.documents.length} documents and ${matrixView.columns.length} metadata fields are included in this overview.`,
              })}
            </p>
          </div>
          <button
            type="button"
            className="odv-metadata-close-icon"
            onClick={onClose}
            aria-label={t('metadataMatrix.close', { defaultValue: 'Close' })}
            title={t('metadataMatrix.close', { defaultValue: 'Close' })}
          >
            <span className="material-icons" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="odv-metadata-body odv-metadata-body-matrix">
          <table className="odv-metadata-table odv-metadata-table-matrix">
            <thead>
              <tr>
                <th scope="col">{t('metadataMatrix.columns.document', { defaultValue: 'Document' })}</th>
                {matrixView.columns.map((column) => (
                  <th key={column.fieldId} scope="col">
                    <div className="odv-metadata-label">{String(column.label || column.fieldId)}</div>
                    <div className="odv-metadata-secondary">{String(column.fieldId || '—')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixView.documents.map((document) => (
                <tr key={document.documentId || `document-${document.documentNumber}`}>
                  <th scope="row">
                    <div className="odv-metadata-label">
                      {t('metadataMatrix.documentLabel', {
                        document: document.documentNumber,
                        defaultValue: `Document ${document.documentNumber}`,
                      })}
                    </div>
                    <div className="odv-metadata-secondary">
                      {t('metadataMatrix.documentMeta', {
                        pages: Number(document.pageCount) || 0,
                        defaultValue: `${Number(document.pageCount) || 0} pages`,
                      })}
                    </div>
                  </th>
                  {matrixView.columns.map((column) => {
                    const cell = document.cells?.[column.fieldId] || null;
                    return (
                      <td key={`${document.documentId || document.documentNumber}:${column.fieldId}`}>
                        <div className="odv-metadata-value">{String(cell?.displayValue || '—')}</div>
                        {cell?.secondaryValue ? (
                          <div className="odv-metadata-secondary">
                            {t('metadataOverlay.rawValue', {
                              value: String(cell.secondaryValue),
                              defaultValue: `Raw value: ${String(cell.secondaryValue)}`,
                            })}
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="odv-metadata-footer">
          <button type="button" className="odv-metadata-close-button" onClick={onClose}>
            {t('metadataMatrix.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}

DocumentMetadataMatrixOverlayDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  matrixView: PropTypes.shape({
    columns: PropTypes.arrayOf(PropTypes.shape({
      fieldId: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })),
    documents: PropTypes.arrayOf(PropTypes.shape({
      documentId: PropTypes.string,
      documentNumber: PropTypes.number.isRequired,
      totalDocuments: PropTypes.number,
      pageCount: PropTypes.number,
      cells: PropTypes.object,
    })),
  }),
};
