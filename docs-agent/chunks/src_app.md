# OpenDocViewer / src/app

File count: 3. Line count: 731. JSDoc symbol count: 20.

## src/app/AppBootstrap.jsx

Application bootstrap React component.

Exports: AppBootstrap

Local imports: src/i18n.js, src/logging/systemLogger.js, src/ErrorBoundary.jsx, src/app/OpenDocViewer.jsx, src/integrations/bootstrapRuntime.js, src/components/DocumentLoader/sources/explicitListSource.js, src/utils/performanceOverlayFlag.js

Symbols:

- `SessionShape` (typedef) - Session metadata for a bundle.
- `ExplicitItem` (typedef) - Explicit item (URL list).
- `PortableDocumentBundle` (typedef) - Portable document bundle shape.
- `UrlConfig` (typedef) - URL parameter config (pattern mode).
- `BootstrapDebugInfo` (typedef) - Diagnostics-only bootstrap metadata.
- `DemoBuildOptions` (typedef) - Options for building a demo source list.
- `DemoSourceItem` (typedef) - One entry in the demo source list.
- `makeReloadCacheSeedFromBundle` (function) - Build a stable reload-cache scope from host/user identity without including short-lived source URLs/tickets, session ids, or the current document selection.
- `buildDemoSourceList` (function) - Build a demo source list from the /public sample files.
- `module.exports` (function) - Top-level bootstrapper component.

## src/app/bootConfig.js

Runtime boot loader that resolves configuration scripts before React starts.

Symbols:

- `getAppBase` (function) - Return the application base path (always with a trailing slash) derived from the current page URL.
- `isJsContentType` (function) - Heuristic: does a content-type look like JavaScript?
- `probeScriptUrl` (function) - Probe a candidate script URL and only accept it when the response looks like JavaScript.
- `loadClassicScript` (function) - Load a classic script and resolve when it executes (or errors).
- `loadFromCandidates` (function) - Try multiple candidate URLs (in order) until one probes as JS, then load it.

## src/app/OpenDocViewer.jsx

src/app/OpenDocViewer.jsx Main application shell for the viewer.

Exports: OpenDocViewer

Local imports: src/logging/systemLogger.js, src/contexts/ViewerProvider.jsx, src/PerformanceMonitor.jsx, src/components/DocumentConsumerWrapper.jsx, src/utils/performanceOverlayFlag.js

Symbols:

- `SourceItem` (typedef) - Item in the explicit source list mode.
- `BootstrapDebugInfo` (typedef) - Diagnostics-only startup details surfaced through the performance overlay.
- `OpenDocViewer` (function) - OpenDocViewer — Top-level component.
- `OpenDocViewer~resizeRaf` (constant) - rAF-throttled resize handler: Avoids re-render spam during window drags.
- `OpenDocViewer~showPerf` (constant) - Decide if the Performance HUD should render: Runtime flag (config/env/meta) OR explicit URL opt-in: ?perf=1 (handy during support sessions)
