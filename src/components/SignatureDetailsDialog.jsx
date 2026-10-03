// File: src/components/SignatureDetailsDialog.jsx
/**
 * Signature details dialog (browser integrity and optional gateway trust).
 *
 * Lists every signature of a document with the phase 1 data contract fields:
 * signer and organisation, issuer, signing time and its source, reason,
 * location, kind (approval/certification/timestamp), the integrity status in
 * plain words with its integrityReason, whether the signature covers the
 * whole document, and the certificate validity period. Unchecked signatures
 * show the level-1 trust explanation. Gateway verdicts include the trust
 * reason and validation time; verified timestamps label their time source.
 *
 * The dialog works per document: when a document consists of several files
 * with signatures, a file selector (tabs) sits above the groups and each file
 * gets a heading followed by its own signatures. A document with one signed
 * file looks like a plain signature list.
 *
 * Accessibility mirrors DocumentMetadataOverlayDialog: modal dialog semantics,
 * focus moves into the dialog on open, Tab is trapped inside, Escape closes,
 * and focus returns to the symbol that opened it.
 */

import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getIntegrityLabel, getTrustLabel } from '../utils/pdfSignatureStatus.js';
import { getSignatureFileHeading } from '../utils/pdfSignatureDocuments.js';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * @param {Function} t
 * @param {(string|null|undefined)} kind
 * @returns {string}
 */
function getKindLabel(t, kind) {
  switch (String(kind || '')) {
    case 'certification':
      return t('signatures.kind.certification', { defaultValue: 'Certification' });
    case 'timestamp':
      return t('signatures.kind.timestamp', { defaultValue: 'Timestamp' });
    case 'approval':
    default:
      return t('signatures.kind.approval', { defaultValue: 'Approval' });
  }
}

/**
 * @param {Function} t
 * @param {(string|null|undefined)} source
 * @returns {string}
 */
function getSigningTimeSourceLabel(t, source) {
  switch (String(source || '')) {
    case 'timestamp':
      return t('signatures.timeSource.timestamp', { defaultValue: 'Verified timestamp' });
    case 'signed-attribute':
      return t('signatures.timeSource.signedAttribute', { defaultValue: 'From the signed attributes' });
    case 'pdf-M':
      return t('signatures.timeSource.pdfM', { defaultValue: 'From the PDF signature dictionary (/M)' });
    case 'none':
    default:
      return t('signatures.timeSource.none', { defaultValue: 'No signing time recorded' });
  }
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {*} [props.report] PdfSignatureReport of a single file (used when no document is given).
 * @param {*} [props.document] Per-document entry from utils/pdfSignatureDocuments.js; its signed
 * files become the file tabs.
 * @param {string} [props.initialSourceKey] File tab to preselect; defaults to the first signed file.
 * @param {(number|null|undefined)} [props.documentNumber]
 * @param {(number|null|undefined)} [props.totalDocuments]
 * @param {{ current:(HTMLElement|null) }} [props.returnFocusRef] Element (the signature
 * symbol) that receives focus when the dialog closes.
 * @returns {(React.ReactElement|null)}
 */
export default function SignatureDetailsDialog({
  isOpen,
  onClose,
  report = null,
  document: signatureDocument = null,
  initialSourceKey = '',
  documentNumber = null,
  totalDocuments = null,
  returnFocusRef = undefined,
}) {
  const { t } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const tabRefs = useRef(/** @type {Object<string, (HTMLButtonElement|null)>} */ ({}));
  const wasOpenRef = useRef(false);
  const signedFiles = Array.isArray(signatureDocument?.signedFiles) ? signatureDocument.signedFiles : [];
  const preselectedSourceKey = signedFiles.some((file) => file.sourceKey === initialSourceKey)
    ? initialSourceKey
    : String(signedFiles[0]?.sourceKey || '');
  const [selectedSourceKey, setSelectedSourceKey] = useState(preselectedSourceKey);

  // Every opening (and every switch of document or requested file) starts on the requested tab.
  useEffect(() => {
    if (isOpen) setSelectedSourceKey(preselectedSourceKey);
  }, [isOpen, preselectedSourceKey, signatureDocument?.key]);

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
    wasOpenRef.current = true;
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
  }, [isOpen, onClose, returnFocusRef]);

  const signatures = signatureDocument
    ? signedFiles.flatMap((file) => file.report?.signatures || [])
    : (Array.isArray(report?.signatures) ? report.signatures : []);
  if (!isOpen || signatures.length <= 0) return null;
  const showFileTabs = signedFiles.length > 1;
  const selectedFile = signedFiles.find((file) => file.sourceKey === selectedSourceKey) || signedFiles[0] || null;
  const listedSignatures = showFileTabs ? (selectedFile?.report?.signatures || []) : signatures;
  const positionNumber = Number(signatureDocument?.documentNumber ?? documentNumber);
  const positionTotal = Number(signatureDocument?.totalDocuments ?? totalDocuments);

  /** Arrow keys, Home and End move between file tabs (automatic activation). */
  const handleTabKeyDown = (event) => {
    const key = String(event?.key || '');
    const index = signedFiles.findIndex((file) => file.sourceKey === selectedFile?.sourceKey);
    let next = -1;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (index + 1) % signedFiles.length;
    else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (index - 1 + signedFiles.length) % signedFiles.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = signedFiles.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const nextKey = signedFiles[next].sourceKey;
    setSelectedSourceKey(nextKey);
    tabRefs.current[nextKey]?.focus?.();
  };

  /** Keep Tab navigation inside the dialog while it is open. */
  const handleTabTrap = (event) => {
    if (String(event?.key || '') !== 'Tab') return;
    const dialogNode = dialogRef.current;
    if (!dialogNode) return;
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

  const subtitle = positionNumber > 0 && positionTotal > 1
    ? t('signatures.dialog.subtitleDocumentPosition', {
        document: positionNumber,
        total: positionTotal,
        defaultValue: `Document ${positionNumber} of ${positionTotal}`,
      })
    : t('signatures.dialog.subtitle', {
        count: signatures.length,
        defaultValue: `${signatures.length} ${signatures.length === 1 ? 'signature' : 'signatures'} in this document.`,
      });

  // Signature headings sit one level below the file heading when file tabs are shown.
  const EntryHeading = showFileTabs ? 'h4' : 'h3';
  const closeLabel = t('signatures.dialog.close', { defaultValue: 'Close' });
  const emptyValue = t('signatures.dialog.notAvailable', { defaultValue: '—' });

  /** @param {*} value @returns {string} */
  const orEmpty = (value) => {
    const text = String(value ?? '').trim();
    return text || emptyValue;
  };

  return (
    <div
      className="odv-signature-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-signature-title"
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
        className="odv-signature-dialog"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleTabTrap}
      >
        <div className="odv-signature-header">
          <div>
            <h2 id="odv-signature-title" className="odv-signature-title">
              {t('signatures.dialog.title', { defaultValue: 'Signatures' })}
            </h2>
            <p className="odv-signature-subtitle">{subtitle}</p>
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
          {showFileTabs ? (
            <div
              className="odv-signature-file-tabs"
              role="tablist"
              aria-label={t('signatures.dialog.fileTabsLabel', { defaultValue: 'Files with signatures' })}
            >
              {signedFiles.map((file) => {
                const selected = file.sourceKey === selectedFile?.sourceKey;
                return (
                  <button
                    key={file.sourceKey}
                    ref={(node) => { tabRefs.current[file.sourceKey] = node; }}
                    type="button"
                    role="tab"
                    id={`odv-signature-tab-${file.fileNumber}`}
                    className={`odv-signature-file-tab${selected ? ' is-selected' : ''}`}
                    aria-selected={selected}
                    aria-controls="odv-signature-file-panel"
                    tabIndex={selected ? 0 : -1}
                    title={getSignatureFileHeading(t, file)}
                    onClick={() => setSelectedSourceKey(file.sourceKey)}
                    onKeyDown={handleTabKeyDown}
                  >
                    {file.fileName || getSignatureFileHeading(t, file)}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div
            className="odv-signature-file-group"
            {...(showFileTabs ? {
              id: 'odv-signature-file-panel',
              role: 'tabpanel',
              'aria-labelledby': `odv-signature-tab-${selectedFile?.fileNumber}`,
            } : {})}
          >
            {showFileTabs && selectedFile ? (
              <h3 className="odv-signature-file-heading">{getSignatureFileHeading(t, selectedFile)}</h3>
            ) : null}
            {listedSignatures.map((signature, index) => {
              const integrityLabel = getIntegrityLabel(t, signature?.integrity);
              const trustLabel = getTrustLabel(t, signature?.trust);
              const rawTrustReason = String(signature?.trustReason ?? '').trim();
              const trustReason = signature?.serverValidationUnavailable === true
                ? t('signatures.trust.unavailable', { defaultValue: 'Server validation unavailable' }) : rawTrustReason;
              const trustChecked = ['valid', 'invalid', 'unknown'].includes(signature?.trust);
              return (
                <section
                  className="odv-signature-entry"
                  key={`signature-${index}`}
                  aria-label={t('signatures.dialog.signatureHeading', {
                    index: index + 1,
                    defaultValue: `Signature ${index + 1}`,
                  })}
                >
                  <EntryHeading className="odv-signature-entry-title">
                    {t('signatures.dialog.signatureHeading', {
                      index: index + 1,
                      defaultValue: `Signature ${index + 1}`,
                    })}
                  </EntryHeading>
                  {!trustChecked ? (
                    <p className="odv-signature-trust-line" role="note">
                      {t('signatures.dialog.trustLine', {
                        defaultValue: 'Trust not checked – shows who signed and whether the document is unchanged, not whether the signature is valid.',
                      })}
                    </p>
                  ) : null}
                  <dl className="odv-signature-fields">
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.signer', { defaultValue: 'Signer' })}</dt>
                      <dd>{orEmpty(signature?.signer)}</dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.organization', { defaultValue: 'Organisation' })}</dt>
                      <dd>{orEmpty(signature?.signerOrganization)}</dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.issuer', { defaultValue: 'Issuer' })}</dt>
                      <dd>{orEmpty(signature?.issuer)}</dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.signingTime', { defaultValue: 'Signing time' })}</dt>
                      <dd>
                        {orEmpty(signature?.signingTime)}
                        <span className="odv-signature-secondary">
                          {getSigningTimeSourceLabel(t, signature?.signingTimeSource)}
                        </span>
                      </dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.reason', { defaultValue: 'Reason' })}</dt>
                      <dd>{orEmpty(signature?.reason)}</dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.location', { defaultValue: 'Location' })}</dt>
                      <dd>{orEmpty(signature?.location)}</dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.kind', { defaultValue: 'Kind' })}</dt>
                      <dd>{getKindLabel(t, signature?.kind)}</dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.integrity', { defaultValue: 'Integrity' })}</dt>
                      <dd>
                        {integrityLabel}
                        {signature?.integrityReason ? (
                          <span className="odv-signature-secondary">{String(signature.integrityReason)}</span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.coversWholeFile', { defaultValue: 'Covers the whole document' })}</dt>
                      <dd>
                        {signature?.coversWholeFile === true
                          ? t('signatures.coversWhole.yes', { defaultValue: 'Yes' })
                          : signature?.coversWholeFile === false
                            ? t('signatures.coversWhole.no', { defaultValue: 'No' })
                            : emptyValue}
                      </dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.certificateValidity', { defaultValue: 'Certificate valid' })}</dt>
                      <dd>
                        {signature?.notBefore || signature?.notAfter
                          ? t('signatures.dialog.validityRange', {
                              from: orEmpty(signature?.notBefore),
                              to: orEmpty(signature?.notAfter),
                              defaultValue: `${orEmpty(signature?.notBefore)} – ${orEmpty(signature?.notAfter)}`,
                            })
                          : emptyValue}
                      </dd>
                    </div>
                    <div className="odv-signature-field">
                      <dt>{t('signatures.fields.trust', { defaultValue: 'Trust' })}</dt>
                      <dd>
                        {trustLabel}
                        {trustReason ? (
                          <span className="odv-signature-secondary">{trustReason}</span>
                        ) : null}
                      </dd>
                    </div>
                    {trustChecked && signature?.validationTime ? (
                      <div className="odv-signature-field">
                        <dt>{t('signatures.fields.validationTime', { defaultValue: 'Validation time' })}</dt>
                        <dd>{orEmpty(signature.validationTime)}</dd>
                      </div>
                    ) : null}
                    {String(signature?.subFilter || '').trim() ? (
                      <div className="odv-signature-field">
                        <dt>{t('signatures.fields.format', { defaultValue: 'Format' })}</dt>
                        <dd><code className="odv-signature-code">{String(signature.subFilter)}</code></dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              );
            })}
          </div>
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

SignatureDetailsDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  report: PropTypes.shape({
    signatures: PropTypes.arrayOf(PropTypes.object),
  }),
  document: PropTypes.shape({
    key: PropTypes.string,
    documentNumber: PropTypes.number,
    totalDocuments: PropTypes.number,
    signedFiles: PropTypes.arrayOf(PropTypes.object),
  }),
  initialSourceKey: PropTypes.string,
  documentNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  totalDocuments: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  returnFocusRef: PropTypes.shape({ current: PropTypes.any }),
};
