// File: src/components/SignatureStatusBadge.jsx
/**
 * Small signature symbol shown next to a document's "DOK n" label (variant
 * `document`, aggregated over all files of the document) and on every page
 * thumbnail of a signed file (variant `thumbnail`). Colour and icon follow the
 * worst severity of the document's signatures (see utils/pdfSignatureStatus.js):
 * intact and not-checked-in-viewer = ok (not-checked becomes a warning with the
 * site switch `uncheckedSeverity: 'warning'`), indeterminate/modified-after-
 * signing or a signing time outside the certificate validity = warning, and
 * digest-mismatch/signature-invalid/unreadable = error. The tooltip names the
 * worst integrity status ("Not checked in the viewer" outranks "Intact"). The
 * badge is a native button, so
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
  getSigningTimeCheckLabel,
  getSigningTimeWarningSignature,
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
 * @param {*} props.report PdfSignatureReport (or any `{ signatures }` aggregate) to show;
 * null while pending.
 * @param {function(HTMLElement): void} props.onOpen Called with the badge element so the
 * dialog can return focus to it.
 * @param {'thumbnail'|'document'|'toolbar'} [props.variant] `document` also shows the count.
 * @param {('ok'|'warning'|'error'|null)} [props.severity] Precomputed severity (signed-document
 * entries already apply the site switch); computed from the report when absent.
 * @param {('ok'|'warning')} [props.uncheckedSeverity] Site switch used when `severity` is absent.
 * @returns {(React.ReactElement|null)}
 */
export default function SignatureStatusBadge({ report, onOpen, variant = 'toolbar', severity = null, uncheckedSeverity = 'ok' }) {
  const { t } = useTranslation('common');
  if (!reportHasSignatures(report)) return null;

  const count = getSignatureCount(report);
  const integrity = getWorstSignatureIntegrity(report?.signatures);
  // A precomputed severity may only be one of the three classes; anything else is recomputed.
  const shownSeverity = Object.hasOwn(ICON_BY_SEVERITY, String(severity))
    ? severity : getReportSignatureSeverity(report.signatures, { uncheckedSeverity });
  const timeWarning = getSigningTimeWarningSignature(report.signatures);
  const baseLabel = t('signatures.badge.ariaLabel', {
    count,
    defaultValue: `Signed document, ${count} ${count === 1 ? 'signature' : 'signatures'}`,
  });
  const label = integrity === 'not-checked-in-viewer'
    ? `${baseLabel} — ${getIntegrityLabel(t, integrity)}`
    : baseLabel;
  const tooltip = t('signatures.badge.tooltip', {
    count,
    defaultValue: `Signed document, ${count} ${count === 1 ? 'signature' : 'signatures'} – show signature details`,
  });

  return (
    <button
      type="button"
      className={`odv-signature-badge odv-signature-badge--${shownSeverity} odv-signature-badge--${variant}`}
      aria-label={label}
      title={[
        tooltip,
        getIntegrityLabel(t, integrity),
        timeWarning ? getSigningTimeCheckLabel(t, timeWarning.signingTimeCheck, timeWarning.signingTimeCode) : null,
      ].filter(Boolean).join(' — ')}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.(event.currentTarget);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="material-icons" aria-hidden="true">{ICON_BY_SEVERITY[shownSeverity]}</span>
      {variant === 'document' ? (
        <span className="odv-signature-badge-count" aria-hidden="true">{count}</span>
      ) : null}
    </button>
  );
}

SignatureStatusBadge.propTypes = {
  report: PropTypes.shape({
    signatures: PropTypes.arrayOf(PropTypes.object),
  }),
  onOpen: PropTypes.func.isRequired,
  variant: PropTypes.oneOf(['thumbnail', 'document', 'toolbar']),
  severity: PropTypes.oneOfType([PropTypes.string, PropTypes.oneOf([null])]),
  uncheckedSeverity: PropTypes.string,
};
