// File: src/manual-page/mountManualPage.jsx
/**
 * Mount the stand-alone manual page into a container, the way src/index.jsx mounts the viewer:
 * apply the shared theme and toolbar density to the document before the first render, then render
 * the page inside the viewer's ThemeProvider (which keeps `data-theme` on <html> and the shared
 * theme preference in sync).
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../contexts/ThemeProvider.jsx';
import { getEffectiveOdvThemeMode, resolveConcreteTheme, applyOdvThemeToDocument } from '../utils/ompThemePreference.js';
import { getEffectiveToolbarLargeButtons } from '../utils/viewerPreferences.js';
import { applyToolbarDensityToDocument } from '../utils/toolbarDensity.js';
import ManualPage from './ManualPage.jsx';

/**
 * @param {(Element|null)} container Element to render into (`#root`).
 * @returns {(Object|null)} The React root (`createRoot`), or null without a container.
 */
export function mountManualPage(container) {
  if (!container) return null;

  const initialThemeMode = getEffectiveOdvThemeMode();
  applyOdvThemeToDocument(resolveConcreteTheme(initialThemeMode), initialThemeMode);
  applyToolbarDensityToDocument(getEffectiveToolbarLargeButtons());

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ThemeProvider>
        <ManualPage />
      </ThemeProvider>
    </React.StrictMode>
  );
  return root;
}

export default mountManualPage;
