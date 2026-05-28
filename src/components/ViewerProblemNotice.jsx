// File: src/components/ViewerProblemNotice.jsx
/**
 * OpenDocViewer — configurable viewer-level problem notice.
 *
 * This is deliberately separate from per-page placeholders. A single corrupt file can be handled by
 * the normal lost-page UI, while this notice is for session-level failures where the user needs a
 * clear operational instruction from the site configuration.
 */

import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { getRuntimeConfig, getViewerProblemNoticeConfig } from '../utils/runtimeConfig.js';
import { resolveLocalizedValue } from '../utils/localizedValue.js';

/**
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toCount(value, fallback = 0) {
  const next = Math.floor(Number(value));
  return Number.isFinite(next) ? Math.max(0, next) : fallback;
}

/**
 * @typedef {Object} ProblemNoticeTrigger
 * @property {string} key
 * @property {string} reason
 * @property {number} failedPages
 * @property {number} expectedPages
 * @property {number} failedRatio
 * @property {string} error
 */

/**
 * @param {Object} input
 * @param {(string|null|undefined)} input.error
 * @param {*} input.pageLoadState
 * @param {boolean} input.loadingRunActive
 * @param {*} input.config
 * @returns {(ProblemNoticeTrigger|null)}
 */
function resolveProblemTrigger({ error, pageLoadState, loadingRunActive, config }) {
  if (!config?.enabled) return null;

  const errorText = String(error || '').trim();
  const failedPages = toCount(pageLoadState?.failedPages);
  const expectedPages = Math.max(
    failedPages,
    toCount(pageLoadState?.expectedPages),
    toCount(pageLoadState?.discoveredPages)
  );
  const failedRatio = expectedPages > 0 ? failedPages / expectedPages : 0;

  if (config.showForLoaderError && errorText) {
    return {
      key: `loader:${errorText}`,
      reason: 'loader-error',
      failedPages,
      expectedPages,
      failedRatio,
      error: errorText,
    };
  }

  if (!config.showForFailedPages || failedPages <= 0) return null;
  if (config.requireLoadComplete && (loadingRunActive || !pageLoadState?.allPagesReady)) return null;

  const minFailedPages = Math.max(1, Number(config.minFailedPages) || 1);
  const ratioThreshold = Math.max(0, Math.min(1, Number(config.failedPageRatio) || 0));
  const ratioMatches = ratioThreshold <= 0 || failedRatio >= ratioThreshold;
  const smallRunFullyFailed = expectedPages > 0 && expectedPages <= minFailedPages && failedPages >= expectedPages;
  const countMatches = failedPages >= minFailedPages;

  if (!smallRunFullyFailed && (!countMatches || !ratioMatches)) return null;

  return {
    key: `failed:${failedPages}:${expectedPages}`,
    reason: 'failed-pages',
    failedPages,
    expectedPages,
    failedRatio,
    error: '',
  };
}

function getSameOriginParentWindow() {
  try {
    if (typeof window === 'undefined') return null;
    if (!window.parent || window.parent === window) return null;
    void window.parent.location.href;
    return window.parent;
  } catch {
    return null;
  }
}

function buildCacheBustedCurrentUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('odvSessionReset', String(Date.now()));
    return url.toString();
  } catch {
    return window.location.href;
  }
}

function dispatchResetEvent(target, detail) {
  try {
    const EventCtor = target?.CustomEvent || CustomEvent;
    const event = new EventCtor('odv:session-reset-requested', {
      detail,
      cancelable: true,
    });
    return target.dispatchEvent(event);
  } catch {
    return true;
  }
}

function postResetMessageToParent(detail) {
  try {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) return;
    window.parent.postMessage({ type: 'odv:session-reset-requested', detail }, '*');
  } catch {
    // Best-effort support signal only.
  }
}

function reloadCurrentViewer() {
  try {
    window.location.replace(buildCacheBustedCurrentUrl());
  } catch {
    try { window.location.reload(); } catch {}
  }
}

function resetViewerSession(trigger, targetMode) {
  if (typeof window === 'undefined') return;

  const detail = {
    reason: trigger?.reason || 'viewer-problem-notice',
    failedPages: trigger?.failedPages || 0,
    expectedPages: trigger?.expectedPages || 0,
    error: trigger?.error || '',
  };

  if (dispatchResetEvent(window, detail) === false) return;

  const mode = String(targetMode || 'parent-or-current').toLowerCase();
  if (mode === 'none') return;

  const parent = getSameOriginParentWindow();
  if (parent) {
    if (dispatchResetEvent(parent, detail) === false) return;
  } else {
    postResetMessageToParent(detail);
  }

  if ((mode === 'parent' || mode === 'parent-or-current') && parent) {
    try {
      parent.location.reload();
      return;
    } catch {
      // Fall back to the current viewer below when allowed.
    }
  }

  if (mode !== 'parent') reloadCurrentViewer();
}

/**
 * @param {Object} props
 * @param {(string|null|undefined)} props.error
 * @param {*} props.pageLoadState
 * @param {boolean} props.loadingRunActive
 * @returns {(React.ReactElement|null)}
 */
export default function ViewerProblemNotice({ error, pageLoadState, loadingRunActive }) {
  const { t, i18n } = useTranslation('common');
  const config = useMemo(() => getViewerProblemNoticeConfig(getRuntimeConfig()), []);
  const trigger = useMemo(() => resolveProblemTrigger({
    error,
    pageLoadState,
    loadingRunActive,
    config,
  }), [config, error, loadingRunActive, pageLoadState]);
  const [dismissedKey, setDismissedKey] = useState('');

  useEffect(() => {
    if (!trigger?.key) return;
    if (dismissedKey && dismissedKey !== trigger.key) setDismissedKey('');
  }, [dismissedKey, trigger?.key]);

  if (!trigger || dismissedKey === trigger.key) return null;

  const title = resolveLocalizedValue(config.title, i18n)
    || t('viewer.problemNotice.title', { defaultValue: 'The documents could not be shown correctly' });
  const message = resolveLocalizedValue(config.message, i18n)
    || t('viewer.problemNotice.message', { defaultValue: 'The document session may have expired. Close this viewer and open the document again from the source system.' });
  const reloadLabel = resolveLocalizedValue(config.reloadLabel, i18n)
    || t('viewer.problemNotice.reload', { defaultValue: 'Reload viewer' });
  const resetSessionLabel = resolveLocalizedValue(config.resetSessionLabel, i18n)
    || t('viewer.problemNotice.resetSession', { defaultValue: 'Reset session' });
  const closeLabel = resolveLocalizedValue(config.closeLabel, i18n)
    || t('viewer.problemNotice.close', { defaultValue: 'Dismiss' });
  const detailsLabel = resolveLocalizedValue(config.detailsLabel, i18n)
    || t('viewer.problemNotice.details', { defaultValue: 'Technical details' });
  const failedSummary = t('viewer.problemNotice.failedSummary', {
    failed: trigger.failedPages,
    total: trigger.expectedPages,
    defaultValue: `${trigger.failedPages} of ${trigger.expectedPages} pages failed.`,
  });

  return (
    <div className="viewer-problem-notice" role="alert" aria-live="assertive">
      <span className="material-icons viewer-problem-notice-icon" aria-hidden="true">error</span>
      <div className="viewer-problem-notice-body">
        <h2>{title}</h2>
        <p>{message}</p>
        {config.showTechnicalDetails ? (
          <details className="viewer-problem-notice-details">
            <summary>{detailsLabel}</summary>
            <p>{failedSummary}</p>
            {trigger.error ? <p>{trigger.error}</p> : null}
          </details>
        ) : null}
      </div>
      <div className="viewer-problem-notice-actions">
        {config.showResetSessionButton ? (
          <button
            type="button"
            className="viewer-problem-notice-button primary"
            onClick={() => resetViewerSession(trigger, config.resetSessionTarget)}
          >
            {resetSessionLabel}
          </button>
        ) : null}
        {config.showReloadButton ? (
          <button
            type="button"
            className="viewer-problem-notice-button"
            onClick={reloadCurrentViewer}
          >
            {reloadLabel}
          </button>
        ) : null}
        {config.dismissible ? (
          <button
            type="button"
            className="viewer-problem-notice-button"
            onClick={() => setDismissedKey(trigger.key)}
          >
            {closeLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

ViewerProblemNotice.propTypes = {
  error: PropTypes.string,
  pageLoadState: PropTypes.object,
  loadingRunActive: PropTypes.bool,
};
