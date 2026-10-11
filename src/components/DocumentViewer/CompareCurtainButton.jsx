// File: src/components/DocumentViewer/CompareCurtainButton.jsx
/**
 * File: src/components/DocumentViewer/CompareCurtainButton.jsx
 *
 * Entry to the curtain view (CompareCurtainView.jsx), shown in the compare toolbar and in the
 * overlay view's toolbar. Without a calibration (the overlay view has not been opened in this
 * compare session) the button stays focusable but disabled (`aria-disabled`), so its tooltip can
 * explain that the overlay view calibrates first.
 *
 * @component
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

/**
 * @param {Object} props
 * @param {boolean} props.calibrated True when a calibration exists in the viewer context.
 * @param {function(): void} props.onOpen Opens the curtain view.
 * @param {string=} props.className Extra class names.
 * @param {boolean=} props.showLabel Show the "Curtain" text next to the icon.
 * @returns {React.ReactElement}
 */
const CompareCurtainButton = ({ calibrated, onOpen, className = '', showLabel = false }) => {
  const { t } = useTranslation('common');
  const label = calibrated
    ? t('compareCurtain.open', { defaultValue: 'Curtain: show the calibrated pages with a draggable border' })
    : t('compareCurtain.needsCalibration', {
      defaultValue: 'Curtain: open the overlay view first – it calibrates the two pages',
    });
  return (
    <button
      type="button"
      className={['odv-btn', 'compare-curtain-button', calibrated ? '' : 'is-disabled', className].filter(Boolean).join(' ')}
      title={label}
      aria-label={label}
      aria-disabled={calibrated ? 'false' : 'true'}
      onClick={() => { if (calibrated) onOpen(); }}
    >
      <span className="material-icons" aria-hidden="true">vertical_split</span>
      {showLabel ? <span>{t('compareCurtain.title', { defaultValue: 'Curtain' })}</span> : null}
    </button>
  );
};

CompareCurtainButton.propTypes = {
  calibrated: PropTypes.bool.isRequired,
  onOpen: PropTypes.func.isRequired,
  className: PropTypes.string,
  showLabel: PropTypes.bool,
};

export default React.memo(CompareCurtainButton);
