// File: src/components/DocumentMetadataOverlayDialog.jsx
/**
 * Document metadata overlay shown from viewer-owned context menus.
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {*} props.metadataView
 * @param {(number|null|undefined)} [props.documentNumber]
 * @param {(number|null|undefined)} [props.totalDocuments]
 * @param {boolean} [props.canOpenMatrix]
 * @param {function(): void} [props.onOpenMatrix]
 * @returns {(React.ReactElement|null)}
 */
export default function DocumentMetadataOverlayDialog({
  isOpen,
  onClose,
  metadataView,
  documentNumber = null,
  totalDocuments = null,
  canOpenMatrix = false,
  onOpenMatrix = undefined,
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

  if (!isOpen || !metadataView || !Array.isArray(metadataView.rows) || metadataView.rows.length <= 0) return null;

  const subtitle = Number(documentNumber) > 0 && Number(totalDocuments) > 0
    ? t('metadataOverlay.subtitleDocumentPosition', {
        document: Number(documentNumber),
        total: Number(totalDocuments),
        defaultValue: `Document ${Number(documentNumber)} of ${Number(totalDocuments)}`,
      })
    : t('metadataOverlay.subtitle', {
        count: Number(metadataView.metadataRowCount) || metadataView.rows.length,
        defaultValue: `${Number(metadataView.metadataRowCount) || metadataView.rows.length} metadata rows available for this document.`,
      });

  return (
    <div
      className="odv-metadata-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-metadata-title"
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
        className="odv-metadata-dialog"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="odv-metadata-header">
          <div>
            <h2 id="odv-metadata-title" className="odv-metadata-title">
              {t('metadataOverlay.title', { defaultValue: 'Document metadata' })}
            </h2>
            <p className="odv-metadata-subtitle">{subtitle}</p>
          </div>
          <button
            type="button"
            className="odv-metadata-close-icon"
            onClick={onClose}
            aria-label={t('metadataOverlay.close', { defaultValue: 'Close' })}
            title={t('metadataOverlay.close', { defaultValue: 'Close' })}
          >
            <span className="material-icons" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="odv-metadata-body">
          <table className="odv-metadata-table">
            <thead>
              <tr>
                <th scope="col">{t('metadataOverlay.columns.field', { defaultValue: 'Field' })}</th>
                <th scope="col">{t('metadataOverlay.columns.value', { defaultValue: 'Value' })}</th>
                <th scope="col">{t('metadataOverlay.columns.id', { defaultValue: 'Id' })}</th>
              </tr>
            </thead>
            <tbody>
              {metadataView.rows.map((row) => (
                <tr key={String(row?.key || row?.fieldId || row?.label || 'row')}>
                  <th scope="row">
                    <div className="odv-metadata-label">{String(row?.label || row?.fieldId || '—')}</div>
                    {row?.alias && String(row.alias) !== String(row?.label || '') ? (
                      <div className="odv-metadata-secondary">
                        {t('metadataOverlay.alias', {
                          alias: String(row.alias),
                          defaultValue: `Alias: ${String(row.alias)}`,
                        })}
                      </div>
                    ) : null}
                  </th>
                  <td>
                    <div className="odv-metadata-value">{String(row?.displayValue || '—')}</div>
                    {row?.secondaryValue ? (
                      <div className="odv-metadata-secondary">
                        {t('metadataOverlay.rawValue', {
                          value: String(row.secondaryValue),
                          defaultValue: `Raw value: ${String(row.secondaryValue)}`,
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <code className="odv-metadata-code">{String(row?.fieldId || '—')}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="odv-metadata-footer">
          {canOpenMatrix ? (
            <button
              type="button"
              className="odv-metadata-close-button secondary"
              onClick={onOpenMatrix}
            >
              {t('metadataMatrix.open', { defaultValue: 'Metadata table' })}
            </button>
          ) : null}
          <button type="button" className="odv-metadata-close-button" onClick={onClose}>
            {t('metadataOverlay.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}

DocumentMetadataOverlayDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  metadataView: PropTypes.shape({
    documentId: PropTypes.string,
    metadataRowCount: PropTypes.number,
    rows: PropTypes.arrayOf(PropTypes.shape({
      key: PropTypes.string,
      fieldId: PropTypes.string,
      label: PropTypes.string,
      displayValue: PropTypes.string,
      secondaryValue: PropTypes.string,
      alias: PropTypes.string,
    })),
  }),
  documentNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  totalDocuments: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  canOpenMatrix: PropTypes.bool,
  onOpenMatrix: PropTypes.func,
};
