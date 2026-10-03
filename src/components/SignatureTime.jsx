// File: src/components/SignatureTime.jsx
/**
 * Local-time rendering of a signature-related ISO time (signing, validation, certificate
 * validity) for the signature dialogs: "2022-04-27 19:55" as text, the exact UTC ISO value in
 * the title attribute and `dateTime`. See formatSignatureTime() in utils/pdfSignatureStatus.js.
 */

import React from 'react';
import PropTypes from 'prop-types';
import { formatSignatureTime } from '../utils/pdfSignatureStatus.js';

/**
 * @param {Object} props
 * @param {*} props.value ISO 8601 time, or empty.
 * @param {string} [props.fallback] Text shown when there is no value.
 * @returns {React.ReactElement}
 */
export default function SignatureTime({ value, fallback = '—' }) {
  const formatted = formatSignatureTime(value);
  if (!formatted) return <>{fallback}</>;
  if (!formatted.iso) return <>{formatted.text}</>;
  return (
    <time className="odv-signature-time" dateTime={formatted.iso} title={formatted.iso}>
      {formatted.text}
    </time>
  );
}

SignatureTime.propTypes = {
  value: PropTypes.any,
  fallback: PropTypes.string,
};
