// File: src/components/SignatureOverviewButton.jsx
/**
 * Toolbar signature overview button.
 *
 * One button for the whole loaded set: the signature icon in the worst
 * severity colour across all loaded files plus the number of signed
 * documents. It is rendered only when at least one loaded file has
 * signatures, so unsigned sets see no change. It opens the signature overview
 * dialog (SignatureOverviewDialog.jsx). Viewer UI only; never part of printed
 * or exported output.
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/** Material Icons ligature per severity (same as SignatureStatusBadge).
 * @type {Object<string, string>} */
const ICON_BY_SEVERITY = {
  ok: 'verified',
  warning: 'warning',
  error: 'error',
};

/**
 * @param {Object} props
 * @param {({ documentCount:number, signatureCount:number, severity:('ok'|'warning'|'error') }|null)} props.summary
 * Totals from summarizeSignatureDocuments(); null renders nothing.
 * @param {function(HTMLElement): void} props.onOpen Called with the button so focus can return to it.
 * @returns {(React.ReactElement|null)}
 */
export default function SignatureOverviewButton({ summary, onOpen }) {
  const { t } = useTranslation('common');
  const documentCount = Math.max(0, Number(summary?.documentCount) || 0);
  if (!summary || documentCount <= 0) return null;
  const severity = ICON_BY_SEVERITY[summary.severity] ? summary.severity : 'error';
  const label = t('signatures.overview.buttonAriaLabel', {
    count: documentCount,
    defaultValue: `Signatures: ${documentCount} signed ${documentCount === 1 ? 'document' : 'documents'} – show overview`,
  });

  return (
    <button
      type="button"
      className={`odv-btn odv-signature-overview-button odv-signature-badge--${severity}`}
      aria-label={label}
      title={label}
      onClick={(event) => onOpen?.(event.currentTarget)}
    >
      <span className="material-icons" aria-hidden="true">{ICON_BY_SEVERITY[severity]}</span>
      <span className="odv-signature-overview-count" aria-hidden="true">{documentCount}</span>
    </button>
  );
}

SignatureOverviewButton.propTypes = {
  summary: PropTypes.shape({
    documentCount: PropTypes.number,
    signatureCount: PropTypes.number,
    severity: PropTypes.oneOf(['ok', 'warning', 'error']),
  }),
  onOpen: PropTypes.func.isRequired,
};
