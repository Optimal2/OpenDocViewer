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
 * Accessibility mirrors DocumentMetadataOverlayDialog: modal dialog semantics,
 * focus moves into the dialog on open, Tab is trapped inside, Escape closes,
 * and focus returns to the symbol that opened it.
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getIntegrityLabel } from '../utils/pdfSignatureStatus.js';

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
 * Generic trust renderer, ready for level 2: all four values have labels and
 * an optional trustReason is shown when present.
 * @param {Function} t
 * @param {(string|null|undefined)} trust
 * @returns {string}
 */
function getTrustLabel(t, trust) {
  switch (String(trust || 'not-checked')) {
    case 'valid':
      return t('signatures.trust.valid', { defaultValue: 'Valid' });
    case 'invalid':
      return t('signatures.trust.invalid', { defaultValue: 'Invalid' });
    case 'unknown':
      return t('signatures.trust.unknown', { defaultValue: 'Unknown' });
    case 'not-checked':
    default:
      return t('signatures.trust.notChecked', { defaultValue: 'Not checked' });
  }
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @param {*} props.report PdfSignatureReport for the document.
 * @param {(number|null|undefined)} [props.documentNumber]
 * @param {(number|null|undefined)} [props.totalDocuments]
 * @param {{ current:(HTMLElement|null) }} [props.returnFocusRef] Element (the signature
 * symbol) that receives focus when the dialog closes.
 * @returns {(React.ReactElement|null)}
 */
export default function SignatureDetailsDialog({
  isOpen,
  onClose,
  report,
  documentNumber = null,
  totalDocuments = null,
  returnFocusRef = undefined,
}) {
  const { t } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const wasOpenRef = useRef(false);

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

  const signatures = Array.isArray(report?.signatures) ? report.signatures : [];
  if (!isOpen || signatures.length <= 0) return null;

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

  const subtitle = Number(documentNumber) > 0 && Number(totalDocuments) > 0
    ? t('signatures.dialog.subtitleDocumentPosition', {
        document: Number(documentNumber),
        total: Number(totalDocuments),
        defaultValue: `Document ${Number(documentNumber)} of ${Number(totalDocuments)}`,
      })
    : t('signatures.dialog.subtitle', {
        count: signatures.length,
        defaultValue: `${signatures.length} ${signatures.length === 1 ? 'signature' : 'signatures'} in this document.`,
      });

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
          {signatures.map((signature, index) => {
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
                <h3 className="odv-signature-entry-title">
                  {t('signatures.dialog.signatureHeading', {
                    index: index + 1,
                    defaultValue: `Signature ${index + 1}`,
                  })}
                </h3>
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
  documentNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  totalDocuments: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  returnFocusRef: PropTypes.shape({ current: PropTypes.any }),
};
