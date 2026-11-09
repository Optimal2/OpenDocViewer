// File: src/manual-page/ManualPage.jsx
/**
 * The stand-alone manual page (served as `<ODV base>/manual/`): a header with the page title and
 * the viewer's own theme and language menus, and the shared manual view filling the rest.
 *
 * - The runtime configuration is the viewer's (src/app/bootConfig.js loads it from the ODV base),
 *   so the manual source modes (`help.manual.source`), path templates and the feature filter of
 *   the standard manual are the same as in the viewer's manual overlay.
 * - `help.manual.enabled: false` (src/utils/manualEnabled.js) shows a "not available" notice
 *   instead of the manual.
 * - The URL fragment selects the initial section (`manual/#zoom`) and follows the section being
 *   read (history.replaceState, so reading does not add history entries). While a manual image
 *   lightbox holds the fragment (`#<lightbox-id>` + `:target`) the view reports no section, so the
 *   fragment is left alone and the lightbox stays open. A page loaded (or reloaded) with a lightbox
 *   id as the fragment opens that lightbox over the top of the manual; closing it hands the
 *   fragment back to the section being read. A fragment naming no element, or an element that the
 *   fragment does not show, opens the manual at the top, and the first section report replaces it.
 * - The language and theme menus are the viewer's components and store the choice through the
 *   same shared preferences, so a choice made here applies in the viewer and the other way round.
 */

import React, { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import ManualView from '../components/Manual/ManualView.jsx';
import LanguageMenuButton from '../components/DocumentToolbar/LanguageMenuButton.jsx';
import ThemeMenuButton from '../components/DocumentToolbar/ThemeMenuButton.jsx';
import { getRuntimeConfig } from '../utils/runtimeConfig.js';
import { isManualEnabled } from '../utils/manualEnabled.js';

export const MANUAL_PAGE_TITLE_ID = 'odv-manual-page-title';
const RESERVED_IDS = [MANUAL_PAGE_TITLE_ID];

/** @returns {string} The current URL fragment without `#` (still URL-encoded). */
function readUrlFragment() {
  try {
    return typeof window === 'undefined' ? '' : String(window.location.hash || '').replace(/^#/, '');
  } catch {
    return '';
  }
}

/**
 * Put the section being read into the URL fragment without adding a history entry. An empty id
 * (no contents tree, or not loaded yet) leaves the URL alone so a requested section survives.
 *
 * @param {string} sectionId
 * @returns {void}
 */
function syncUrlFragment(sectionId) {
  if (!sectionId || typeof window === 'undefined') return;
  try {
    const fragment = encodeURIComponent(sectionId);
    if (readUrlFragment() === fragment) return;
    const base = String(window.location.href).split('#')[0];
    window.history.replaceState(window.history.state, '', `${base}#${fragment}`);
  } catch {
    // A sandboxed host can refuse history updates; the page works without the fragment.
  }
}

/**
 * @param {Object} props
 * @param {Object} [props.config] Runtime configuration; defaults to the loaded viewer configuration.
 * @returns {React.ReactElement}
 */
export default function ManualPage({ config = undefined }) {
  const { t, i18n } = useTranslation('common');
  const enabled = isManualEnabled(config === undefined ? getRuntimeConfig() : config);
  // Read once: the view applies the initial section once per loaded manual.
  const [initialSectionId] = useState(readUrlFragment);
  const title = t('help.standalonePageTitle', { defaultValue: 'OpenDocViewer – Manual' });

  useEffect(() => {
    try { document.title = title; } catch { /* best effort */ }
  }, [title, i18n?.language]);

  const handleActiveSectionChange = useCallback((sectionId) => {
    syncUrlFragment(sectionId);
  }, []);

  return (
    <div className="odv-manual-page" data-odv-manual-page="root">
      <header className="toolbar odv-manual-page-header">
        <h1 id={MANUAL_PAGE_TITLE_ID} className="odv-manual-page-title">{title}</h1>
        <div className="toolbar-end-actions">
          <ThemeMenuButton />
          <LanguageMenuButton />
        </div>
      </header>
      <main className="odv-manual-page-body" aria-labelledby={MANUAL_PAGE_TITLE_ID}>
        {enabled ? (
          <ManualView
            initialSectionId={initialSectionId}
            onActiveSectionChange={handleActiveSectionChange}
            reservedIds={RESERVED_IDS}
          />
        ) : (
          <p className="odv-manual-page-disabled" role="status" data-odv-manual-page="disabled">
            {t('help.manualDisabled', { defaultValue: 'The manual is not available in this installation.' })}
          </p>
        )}
      </main>
    </div>
  );
}

ManualPage.propTypes = {
  config: PropTypes.object,
};
