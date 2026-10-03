// File: src/components/SignatureOverviewDialog.jsx
/**
 * Signature overview dialog, opened from the toolbar overview button.
 *
 * Lists every signed document of the loaded set: "DOK n", file name(s),
 * signature count, the worst integrity and trust status (shared status
 * helpers), and the signer and signing time of the newest signature. The
 * active document's row is marked. Activating a row navigates the viewer to
 * the document's first page and keeps the dialog open; the secondary
 * "Details" action opens the per-document SignatureDetailsDialog on top.
 *
 * Accessibility mirrors SignatureDetailsDialog: modal dialog semantics, focus
 * moves into the dialog (the active or first row), Tab is trapped inside,
 * ArrowUp/ArrowDown/Home/End move between rows, Escape closes, and focus
 * returns to the toolbar button.
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getIntegrityLabel, getTrustLabel } from '../utils/pdfSignatureStatus.js';
import { getSignatureFileHeading } from '../utils/pdfSignatureDocuments.js';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** @type {Object<string, string>} */
const ICON_BY_SEVERITY = {
  ok: 'verified',
  warning: 'warning',
  error: 'error',
};

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {Array<*>} props.documents Signed documents from buildSignatureDocuments().
 * @param {string} [props.activeDocumentKey] Key of the document shown in the viewer.
 * @param {function(*): void} props.onNavigate Navigate to a document's first page.
 * @param {function(*, HTMLElement): void} props.onOpenDetails Open the details dialog for a document.
 * @param {boolean} [props.suspended] True while the details dialog is open on top; the
 * overview then ignores Escape so only the top dialog closes.
 * @param {{ current:(HTMLElement|null) }} [props.returnFocusRef] Toolbar button that gets focus back.
 * @returns {(React.ReactElement|null)}
 */
export default function SignatureOverviewDialog({
  isOpen,
  onClose,
  documents,
  activeDocumentKey = '',
  onNavigate,
  onOpenDetails,
  suspended = false,
  returnFocusRef = undefined,
}) {
  const { t } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const wasOpenRef = useRef(false);
  const suspendedRef = useRef(suspended);
  const list = Array.isArray(documents) ? documents : [];

  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  useEffect(() => {
    if (!isOpen) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const opener = returnFocusRef?.current;
        if (opener && typeof opener.focus === 'function' && opener.isConnected !== false) {
          opener.focus();
        }
      }
      return undefined;
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      const dialogNode = dialogRef.current;
      const initial = dialogNode?.querySelector('.odv-signature-overview-row.is-active .odv-signature-overview-go')
        || dialogNode?.querySelector('.odv-signature-overview-go')
        || dialogNode;
      initial?.focus?.();
    }

    /** @param {KeyboardEvent} event */
    const handleEscape = (event) => {
      if (String(event?.key || '') !== 'Escape' || suspendedRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    };

    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [isOpen, onClose, returnFocusRef]);

  if (!isOpen || list.length <= 0) return null;

  /** Keep Tab navigation inside the dialog while it is open. */
  const handleKeyDown = (event) => {
    const key = String(event?.key || '');
    const dialogNode = dialogRef.current;
    if (!dialogNode) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      const rows = Array.from(dialogNode.querySelectorAll('.odv-signature-overview-go'));
      const index = rows.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = key === 'Home' ? 0
        : key === 'End' ? rows.length - 1
          : key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
      rows[next]?.focus();
      return;
    }
    if (key !== 'Tab') return;
    const focusable = Array.from(dialogNode.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((element) => !element.disabled && element.offsetParent !== null || element === document.activeElement);
    if (focusable.length <= 0) {
      event.preventDefault();
      dialogNode.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogNode.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogNode.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const closeLabel = t('signatures.dialog.close', { defaultValue: 'Close' });
  const emptyValue = t('signatures.dialog.notAvailable', { defaultValue: '—' });
  const detailsLabel = t('signatures.overview.details', { defaultValue: 'Details' });

  return (
    <div
      className="odv-signature-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-signature-overview-title"
      data-odv-shortcuts="off"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || suspendedRef.current) return;
        onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className="odv-signature-dialog odv-signature-overview-dialog"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="odv-signature-header">
          <div>
            <h2 id="odv-signature-overview-title" className="odv-signature-title">
              {t('signatures.overview.title', { defaultValue: 'Signed documents' })}
            </h2>
            <p className="odv-signature-subtitle">
              {t('signatures.overview.subtitle', {
                count: list.length,
                defaultValue: `${list.length} signed ${list.length === 1 ? 'document' : 'documents'}`,
              })}
            </p>
          </div>
          <button
            type="button"
            className="odv-signature-close-icon"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <span className="material-icons" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="odv-signature-body">
          <ul
            className="odv-signature-overview-list"
            aria-label={t('signatures.overview.listLabel', { defaultValue: 'Signed documents' })}
          >
            {list.map((doc, rowIndex) => {
              const isActive = doc.key === activeDocumentKey;
              const documentLabel = t('thumbnails.documentBoundaryStartShort', {
                document: doc.documentNumber,
                total: doc.totalDocuments,
                defaultValue: `Doc ${doc.documentNumber}`,
              });
              const fileNames = doc.signedFiles
                .map((file) => file.fileName || getSignatureFileHeading(t, file))
                .join(', ');
              const statusText = `${getIntegrityLabel(t, doc.worstIntegrity)} · ${t('signatures.fields.trust', { defaultValue: 'Trust' })}: ${getTrustLabel(t, doc.worstTrust)}`;
              const signer = String(doc.newestSignature?.signer || '').trim() || emptyValue;
              const signingTime = String(doc.newestSignature?.signingTime || '').trim() || emptyValue;
              const countText = t('signatures.overview.signatureCount', {
                count: doc.signatureCount,
                defaultValue: `${doc.signatureCount} ${doc.signatureCount === 1 ? 'signature' : 'signatures'}`,
              });
              return (
                <li
                  key={doc.key}
                  className={`odv-signature-overview-row${isActive ? ' is-active' : ''}`}
                  aria-current={isActive ? 'true' : undefined}
                  data-document-key={doc.key}
                >
                  <button
                    type="button"
                    className="odv-signature-overview-go"
                    aria-label={t('signatures.overview.goToDocumentAria', {
                      document: doc.documentNumber,
                      count: doc.signatureCount,
                      defaultValue: `Go to document ${doc.documentNumber}, ${countText}`,
                    }) + (isActive ? ` (${t('signatures.overview.activeDocument', { defaultValue: 'current document' })})` : '')}
                    aria-describedby={`odv-signature-overview-desc-${rowIndex}`}
                    title={t('signatures.overview.goToDocument', { defaultValue: 'Go to document' })}
                    onClick={() => onNavigate?.(doc)}
                  >
                    <span className={`material-icons odv-signature-badge--${doc.severity}`} aria-hidden="true">
                      {ICON_BY_SEVERITY[doc.severity] || 'error'}
                    </span>
                    <span className="odv-signature-overview-main" id={`odv-signature-overview-desc-${rowIndex}`}>
                      <span className="odv-signature-overview-doc">
                        {documentLabel}
                        {isActive ? (
                          <span className="odv-signature-overview-active">
                            {t('signatures.overview.activeDocument', { defaultValue: 'current document' })}
                          </span>
                        ) : null}
                      </span>
                      <span className="odv-signature-overview-files">{fileNames}</span>
                      <span className="odv-signature-overview-meta">{`${countText} · ${statusText}`}</span>
                      <span className="odv-signature-overview-signer">{`${signer} · ${signingTime}`}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="odv-signature-overview-details"
                    aria-label={t('signatures.overview.detailsAria', {
                      document: doc.documentNumber,
                      defaultValue: `Show signature details for document ${doc.documentNumber}`,
                    })}
                    title={t('signatures.overview.detailsTitle', { defaultValue: 'Show signature details' })}
                    onClick={(event) => onOpenDetails?.(doc, event.currentTarget)}
                  >
                    {detailsLabel}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="odv-signature-footer">
          <button type="button" className="odv-signature-close-button" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

SignatureOverviewDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  documents: PropTypes.arrayOf(PropTypes.object),
  activeDocumentKey: PropTypes.string,
  onNavigate: PropTypes.func.isRequired,
  onOpenDetails: PropTypes.func.isRequired,
  suspended: PropTypes.bool,
  returnFocusRef: PropTypes.shape({ current: PropTypes.any }),
};
