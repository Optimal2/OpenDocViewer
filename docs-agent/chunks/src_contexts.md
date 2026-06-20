# OpenDocViewer / src/contexts

File count: 4. Line count: 3018. JSDoc symbol count: 81.

## src/contexts/themeContext.js

Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake.

Exports: `ThemeContext`

Symbols:

- `ThemeMode` (typedef) - Theme identifier.
- `ThemeContextValue` (typedef) - Context value shape for the theme.
- `ThemeContext` (constant) - Create the Theme context with a safe default to avoid undefined access if a consumer is mounted outside the provider by mistake.

## src/contexts/ThemeProvider.jsx

src/contexts/ThemeProvider.jsx OpenDocViewer — Theme state context \(React\) Centralize theme handling with: \- explicit themes: normal / light / dark \- an implicit system\-following startup mode when the user has not chosen

Exports: `ThemeProvider`

Local imports: `src/logging/systemLogger.js`, `src/contexts/themeContext.js`, `src/utils/viewerPreferences.js`

Symbols:

- `ThemeName` (typedef) - Theme identifier.
- `ThemeMode` (typedef) - Theme mode identifier.
- `detectSystemTheme` (function) - Detect system preferred color scheme \(SSR\-safe; defaults to light\).
- `resolveThemeForMode` (function) - Resolve the concrete theme for a theme mode.
- `applyThemeToDocument` (function) - Apply the resolved theme to the DOM \(SSR\-safe\).
- `resolveInitialThemeMode` (function) - Resolve the initial theme mode once during provider initialization.
- `ThemeProvider` (constant) - ThemeProvider component to manage and provide theme\-related state and functions.
- `ThemeProvider~setThemeMode` (constant) - Persist and apply a theme mode.
- `ThemeProvider~setThemeExplicit` (constant) - Apply an explicit concrete theme.
- `ThemeProvider~toggleTheme` (constant) - Toggle between the two highest\-contrast explicit themes.
- `<anonymous>~onChange` (function) - No description.

## src/contexts/viewerContext.js

Exports ViewerContext.

Exports: `ViewerContext`

Symbols:

- `ViewerPageEntry` (typedef) - No description.
- `DocumentSessionInitOptions` (typedef) - No description.
- `DisposeDocumentSessionOptions` (typedef) - No description.
- `StoreSourceBlobInput` (typedef) - No description.
- `EnsurePageAssetOptions` (typedef) - No description.
- `ViewerSourceDescriptor` (typedef) - No description.
- `ViewerRuntimeDiagnostics` (typedef) - No description.
- `ViewerPageLoadState` (typedef) - No description.
- `ViewerContextValue` (typedef) - No description.

## src/contexts/ViewerProvider.jsx

OpenDocViewer — Viewer state provider.

Exports: `ViewerProvider`

Local imports: `src/logging/systemLogger.js`, `src/contexts/viewerContext.js`, `src/utils/documentLoadingConfig.js`, `src/utils/sourceTempStore.js`, `src/utils/pageAssetStore.js`, `src/utils/pageAssetRenderer.js`, `src/utils/reloadCacheIdentity.js`, `src/utils/objectUrlRegistry.js`

Symbols:

- `DocumentSessionInitOptions` (typedef) - No description.
- `DisposeDocumentSessionOptions` (typedef) - No description.
- `StoreSourceBlobInput` (typedef) - No description.
- `EnsurePageAssetOptions` (typedef) - No description.
- `makeAssetKey` (function) - No description.
- `makePendingAssetKey` (function) - No description.
- `makePdfResolutionPageKey` (function) - No description.
- `isPdfPageEntry` (function) - No description.
- `makePersistedAssetKey` (function) - No description.
- `getPageAt` (function) - No description.
- `resolvePatch` (function) - No description.
- `touchCacheEntry` (function) - No description.
