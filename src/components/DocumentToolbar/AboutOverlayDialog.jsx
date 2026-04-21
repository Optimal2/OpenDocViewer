// File: src/components/DocumentToolbar/AboutOverlayDialog.jsx
/**
 * Small About dialog for version/build/support information.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getRuntimeConfig } from '../../utils/runtimeConfig.js';

/**
 * @returns {{ version:string, buildId:string, githubUrl:string, contactEmail:string }}
 */
function resolveAboutInfo() {
  const cfg = getRuntimeConfig();
  const version = String(
    (typeof window !== 'undefined' && (window.__ODV_APP_VERSION__ || window.__APP_VERSION__))
      || (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env.VITE_APP_VERSION || import.meta.env.APP_VERSION))
      || 'unknown'
  );
  const buildId = String(
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.ODV_BUILD_ID)
      || ''
  ).trim();
  return {
    version,
    buildId,
    githubUrl: String(cfg?.help?.about?.githubUrl || 'https://github.com/Optimal2/OpenDocViewer').trim(),
    contactEmail: String(cfg?.help?.about?.contactEmail || 'dev@optimal2.se').trim(),
  };
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @returns {(React.ReactElement|null)}
 */
export default function AboutOverlayDialog({ isOpen, onClose }) {
  const { t } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const aboutInfo = useMemo(() => resolveAboutInfo(), []);

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

  if (!isOpen) return null;

  return (
    <div
      className="odv-help-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-about-title"
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
        className="odv-help-dialog odv-about-dialog"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="odv-help-header">
          <div>
            <h2 id="odv-about-title" className="odv-help-title">
              {t('about.title', { defaultValue: 'About OpenDocViewer' })}
            </h2>
            <p className="odv-help-subtitle">
              {t('about.subtitle', { defaultValue: 'Version, project links, and support contact.' })}
            </p>
          </div>
          <button
            type="button"
            className="odv-help-close-icon"
            onClick={onClose}
            aria-label={t('about.close', { defaultValue: 'Close' })}
            title={t('about.close', { defaultValue: 'Close' })}
          >
            <span className="material-icons" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="odv-help-body odv-about-body">
          <div className="odv-about-grid">
            <div className="odv-about-row">
              <div className="odv-about-label">{t('about.version', { defaultValue: 'Version' })}</div>
              <div className="odv-about-value"><code>{aboutInfo.version}</code></div>
            </div>
            {aboutInfo.buildId ? (
              <div className="odv-about-row">
                <div className="odv-about-label">{t('about.buildId', { defaultValue: 'Build id' })}</div>
                <div className="odv-about-value"><code>{aboutInfo.buildId}</code></div>
              </div>
            ) : null}
            <div className="odv-about-row">
              <div className="odv-about-label">{t('about.project', { defaultValue: 'Project' })}</div>
              <div className="odv-about-value">
                <a href={aboutInfo.githubUrl} target="_blank" rel="noopener noreferrer">{aboutInfo.githubUrl}</a>
              </div>
            </div>
            <div className="odv-about-row">
              <div className="odv-about-label">{t('about.contact', { defaultValue: 'Contact' })}</div>
              <div className="odv-about-value">
                <a href={`mailto:${aboutInfo.contactEmail}`}>{aboutInfo.contactEmail}</a>
              </div>
            </div>
          </div>
        </div>

        <div className="odv-help-footer">
          <button type="button" className="odv-help-close-button" onClick={onClose}>
            {t('about.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}

AboutOverlayDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
