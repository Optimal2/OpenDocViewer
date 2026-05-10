// File: src/components/DocumentToolbar/ManualOverlayDialog.jsx
/**
 * Manual overlay that loads simple external HTML fragments from the public help folder.
 *
 * This keeps customer-specific manual text and linked assets out of the compiled React bundle.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getRuntimeConfig } from '../../utils/runtimeConfig.js';

const MANUAL_REFRESH_QUERY_KEY = 'odvManualRefresh';

/**
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
function toText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

/**
 * @param {string} template
 * @param {string} language
 * @returns {string}
 */
function interpolateTemplate(template, language) {
  return String(template || '')
    .replace(/\{\{lng\}\}/g, language)
    .replace(/\{\{lang\}\}/g, language);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isRewritableRelativeUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (normalized.startsWith('#')) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return false;
  if (normalized.startsWith('//')) return false;
  return true;
}

/**
 * @param {string} html
 * @param {string} resolvedUrl
 * @returns {string}
 */
function rewriteManualHtml(html, resolvedUrl) {
  if (typeof DOMParser === 'undefined') return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script').forEach((node) => node.remove());

  const urlAttributes = ['href', 'src', 'poster'];
  urlAttributes.forEach((attribute) => {
    doc.querySelectorAll(`[${attribute}]`).forEach((node) => {
      const current = node.getAttribute(attribute);
      if (!isRewritableRelativeUrl(current || '')) return;
      try {
        node.setAttribute(attribute, new URL(String(current), resolvedUrl).toString());
      } catch {
        // Leave the attribute as-is if URL rewriting fails.
      }
    });
  });

  doc.querySelectorAll('a[href]').forEach((node) => {
    const href = String(node.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#')) return;
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  });

  const headMarkup = doc.head
    ? Array.from(doc.head.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((node) => node.outerHTML)
      .join('')
    : '';
  if (doc.body && doc.body.innerHTML.trim()) return `${headMarkup}${doc.body.innerHTML}`;
  return `${headMarkup}${doc.documentElement?.innerHTML || String(html || '')}`;
}

/**
 * @param {string} url
 * @param {number} refreshToken
 * @returns {string}
 */
function appendManualRefreshToken(url, refreshToken) {
  if (!refreshToken) return url;
  try {
    const parsed = new URL(String(url || ''), window.location.href);
    parsed.searchParams.set(MANUAL_REFRESH_QUERY_KEY, String(refreshToken));
    return parsed.toString();
  } catch {
    const separator = String(url || '').includes('?') ? '&' : '?';
    return `${url}${separator}${MANUAL_REFRESH_QUERY_KEY}=${encodeURIComponent(String(refreshToken))}`;
  }
}

/**
 * @param {string} url
 * @returns {string}
 */
function removeManualRefreshToken(url) {
  const raw = String(url || '');
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, window.location.href);
    parsed.searchParams.delete(MANUAL_REFRESH_QUERY_KEY);
    return parsed.toString();
  } catch {
    return raw.replace(new RegExp(`([?&])${MANUAL_REFRESH_QUERY_KEY}=[^&]*&?`), '$1').replace(/[?&]$/, '');
  }
}

/**
 * @param {string} language
 * @returns {Array<string>}
 */
function buildManualCandidates(language) {
  const cfg = getRuntimeConfig();
  const fallbackLanguage = toText(cfg?.help?.manual?.fallbackLanguage, 'en').toLowerCase();
  const siteTemplate = toText(cfg?.help?.manual?.sitePathTemplate, 'help/site/manual.{{lng}}.html');
  const fallbackTemplate = toText(cfg?.help?.manual?.fallbackPathTemplate, 'help/default/manual.{{lng}}.html');
  const normalizedLanguage = toText(language, 'en').toLowerCase();
  const variants = [];
  [normalizedLanguage, fallbackLanguage].forEach((entry) => {
    if (!entry || variants.includes(entry)) return;
    variants.push(entry);
  });

  const candidates = [];
  variants.forEach((lng) => {
    [siteTemplate, fallbackTemplate].forEach((template) => {
      const interpolated = interpolateTemplate(template, lng);
      if (!interpolated || candidates.includes(interpolated)) return;
      candidates.push(interpolated);
    });
  });

  return candidates;
}

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {function(): void} props.onClose
 * @returns {(React.ReactElement|null)}
 */
export default function ManualOverlayDialog({ isOpen, onClose }) {
  const { t, i18n } = useTranslation('common');
  const dialogRef = useRef(/** @type {(HTMLDivElement|null)} */ (null));
  const [manualState, setManualState] = useState({ loading: false, error: '', html: '', resolvedUrl: '' });
  const [refreshToken, setRefreshToken] = useState(0);

  const language = useMemo(() => {
    const raw = String(i18n?.resolvedLanguage || i18n?.language || 'en').toLowerCase();
    return raw.split('-')[0] || 'en';
  }, [i18n?.language, i18n?.resolvedLanguage]);

  const handleRefresh = useCallback(() => {
    setRefreshToken(Date.now());
  }, []);

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

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setManualState({ loading: true, error: '', html: '', resolvedUrl: '' });

    const load = async () => {
      const candidates = buildManualCandidates(language);
      for (const candidate of candidates) {
        try {
          const requestUrl = appendManualRefreshToken(candidate, refreshToken);
          const response = await fetch(requestUrl, {
            cache: refreshToken ? 'reload' : 'no-store',
            credentials: 'same-origin',
            signal: controller?.signal,
            headers: { Accept: 'text/html, text/plain;q=0.9, */*;q=0.1' },
          });
          if (!response.ok) continue;
          const html = await response.text();
          if (cancelled) return;
          const resolvedUrl = removeManualRefreshToken(response.url || requestUrl);
          setManualState({
            loading: false,
            error: '',
            html: rewriteManualHtml(html, resolvedUrl || candidate),
            resolvedUrl: resolvedUrl || candidate,
          });
          return;
        } catch (error) {
          if (controller?.signal?.aborted) return;
          if (cancelled) return;
          if (String(error?.name || '') === 'AbortError') return;
        }
      }

      if (!cancelled) {
        setManualState({
          loading: false,
          error: t('help.manualNotAvailable', { defaultValue: 'No manual file could be loaded for this language.' }),
          html: '',
          resolvedUrl: '',
        });
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller?.abort?.();
    };
  }, [isOpen, language, refreshToken, t]);

  if (!isOpen) return null;

  return (
    <div
      className="odv-help-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-help-title"
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
        className="odv-help-dialog"
        tabIndex={-1}
        data-odv-shortcuts="off"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="odv-help-header">
          <div>
            <h2 id="odv-help-title" className="odv-help-title">
              {t('help.menu.manual', { defaultValue: 'Manual' })}
            </h2>
            <p className="odv-help-subtitle">
              {manualState.resolvedUrl
                ? t('help.loadedFrom', {
                    path: manualState.resolvedUrl,
                    defaultValue: `Loaded from ${manualState.resolvedUrl}`,
                  })
                : t('help.subtitle', {
                    defaultValue: 'OpenDocViewer manual content loaded from a site-local HTML file.',
                  })}
            </p>
          </div>
          <div className="odv-help-header-actions">
            <button
              type="button"
              className="odv-help-close-icon"
              onClick={handleRefresh}
              disabled={manualState.loading}
              aria-label={t('help.refreshManual', { defaultValue: 'Reload manual from server' })}
              title={t('help.refreshManual', { defaultValue: 'Reload manual from server' })}
            >
              <span className="material-icons" aria-hidden="true">refresh</span>
            </button>
            <button
              type="button"
              className="odv-help-close-icon"
              onClick={onClose}
              aria-label={t('help.close', { defaultValue: 'Close' })}
              title={t('help.close', { defaultValue: 'Close' })}
            >
              <span className="material-icons" aria-hidden="true">close</span>
            </button>
          </div>
        </div>

        <div className="odv-help-body odv-help-body-manual">
          {manualState.loading ? (
            <p className="odv-help-placeholder">
              {t('help.loading', { defaultValue: 'Loading manual…' })}
            </p>
          ) : manualState.error ? (
            <div className="odv-help-placeholder is-error">
              <p>{manualState.error}</p>
              <p>{t('help.manualPathsHint', {
                defaultValue: 'Place a site-local HTML file under help/site/ or rely on the bundled fallback under help/default/.',
              })}</p>
            </div>
          ) : (
            <div className="odv-manual-content" dangerouslySetInnerHTML={{ __html: manualState.html }} />
          )}
        </div>

        <div className="odv-help-footer">
          <button type="button" className="odv-help-close-button" onClick={onClose}>
            {t('help.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  );
}

ManualOverlayDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
