// File: src/components/SignatureStatusBadge.jsx
/**
 * Small signature symbol shown on a document's thumbnail and in the toolbar
 * when the document has at least one signature. Colour and icon follow the
 * worst integrity or trust status of the document's signatures (see
 * utils/pdfSignatureStatus.js): intact = neutral/positive,
 * modified-after-signing/unsupported = warning, digest-mismatch/
 * signature-invalid/unreadable or invalid trust = error; unknown trust = warning.
 * The badge is a native button, so
 * Enter/Space activate it; it opens the signature details dialog. It lives in
 * the viewer UI only and is never part of printed or exported output (print
 * and export build their own output documents, not the app DOM).
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import {
  getSignatureCount,
  getIntegrityLabel,
  getReportSignatureSeverity,
  getWorstSignatureIntegrity,
  reportHasSignatures,
} from '../utils/pdfSignatureStatus.js';

/** Material Icons ligature per severity.
 * @type {Object<string, string>} */
const ICON_BY_SEVERITY = {
  ok: 'verified',
  warning: 'warning',
  error: 'error',
};

/**
 * @param {Object} props
 * @param {*} props.report PdfSignatureReport for the document (or null while pending).
 * @param {function(HTMLElement): void} props.onOpen Called with the badge element so the
 * dialog can return focus to it.
 * @param {'thumbnail'|'toolbar'} [props.variant]
 * @returns {(React.ReactElement|null)}
 */
export default function SignatureStatusBadge({ report, onOpen, variant = 'toolbar' }) {
  const { t } = useTranslation('common');
  if (!reportHasSignatures(report)) return null;

  const count = getSignatureCount(report);
  const integrity = getWorstSignatureIntegrity(report?.signatures);
  const severity = getReportSignatureSeverity(report.signatures);
  const trustWarning = report.signatures.some((signature) => signature?.trust === 'invalid')
    ? t('signatures.badge.invalidTrust', { defaultValue: 'Invalid signature' })
    : report.signatures.some((signature) => signature?.trust === 'unknown')
      ? t('signatures.badge.unknownTrust', { defaultValue: 'Signature trust unknown' }) : null;
  const label = t('signatures.badge.ariaLabel', {
    count,
    defaultValue: `Signed document, ${count} ${count === 1 ? 'signature' : 'signatures'}`,
  });
  const tooltip = t('signatures.badge.tooltip', {
    count,
    defaultValue: `Signed document, ${count} ${count === 1 ? 'signature' : 'signatures'} – show signature details`,
  });

  return (
    <button
      type="button"
      className={`odv-signature-badge odv-signature-badge--${severity} odv-signature-badge--${variant}`}
      aria-label={label}
      title={[tooltip, getIntegrityLabel(t, integrity), trustWarning].filter(Boolean).join(' — ')}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.(event.currentTarget);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="material-icons" aria-hidden="true">{ICON_BY_SEVERITY[severity]}</span>
    </button>
  );
}

SignatureStatusBadge.propTypes = {
  report: PropTypes.shape({
    signatures: PropTypes.arrayOf(PropTypes.object),
  }),
  onOpen: PropTypes.func.isRequired,
  variant: PropTypes.oneOf(['thumbnail', 'toolbar']),
};
