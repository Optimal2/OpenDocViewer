# OpenDocViewer / src/manual\-page

File count: 3. Line count: 173. JSDoc symbol count: 4.

## src/manual\-page/main.jsx

Entry of the stand\-alone manual page \(manual/index.html\).

Local imports: `../styles.css`, `./manualPage.css`, `src/i18n.js`, `src/logging/systemLogger.js`, `src/manual-page/mountManualPage.jsx`

## src/manual\-page/ManualPage.jsx

The stand\-alone manual page \(served as \`&lt;ODV base&gt;/manual/\`\): a header with the page title and the viewer's own theme and language menus, and the shared manual view filling the rest.

Exports: `MANUAL_PAGE_TITLE_ID`, `ManualPage`

Local imports: `src/components/Manual/ManualView.jsx`, `src/components/DocumentToolbar/LanguageMenuButton.jsx`, `src/components/DocumentToolbar/ThemeMenuButton.jsx`, `src/utils/runtimeConfig.js`, `src/utils/manualEnabled.js`

Symbols:

- `readUrlFragment` (function) - No description.
- `syncUrlFragment` (function) - Put the section being read into the URL fragment without adding a history entry.
- `module.exports` (function) - No description.

## src/manual\-page/mountManualPage.jsx

Mount the stand\-alone manual page into a container, the way src/index.jsx mounts the viewer: apply the shared theme and toolbar density to the document before the first render, then render the page inside the viewer's Th

Exports: `mountManualPage`, `mountManualPage`

Local imports: `src/contexts/ThemeProvider.jsx`, `src/utils/ompThemePreference.js`, `src/utils/viewerPreferences.js`, `src/utils/toolbarDensity.js`, `src/manual-page/ManualPage.jsx`

Symbols:

- `mountManualPage` (function) - No description.
