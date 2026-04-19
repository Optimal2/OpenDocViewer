# OpenDocViewer v1.5.0 release notes

This document summarizes the effective change set between the shipped `1.4.1` baseline and the
current `main` branch that is being prepared as **v1.5.0**.

## Release position

v1.5.0 is the new recommended release line.

It replaces earlier versions not only because of feature growth, but because it is the first release
that combines:

- the current dependency/security baseline
- the document-aware viewer model
- selection-aware filtering/navigation/printing
- compare-aware navigation and editing behavior
- the current runtime configuration surface and sample coverage

## Security and dependency baseline

The release lifts the frontend dependency baseline to the currently intended secure set:

- `axios` `^1.15.0`
- `follow-redirects` `>=1.16.0` via the resolved lockfile tree
- `dompurify` `>=3.4.0` via the resolved lockfile tree

In addition, v1.5.0 keeps the more defensive runtime behavior introduced during the recent hardening
work:

- performance-overlay-specific data collection is gated behind the overlay flag
- runtime i18n loading uses version-aware cache busting/fallback handling to reduce stale-client
  language resource issues after deployment
- viewer-owned context menus suppress the browser's default image-save menu inside the viewer
  surface

## Viewer and workflow highlights

### Document-aware thumbnails and navigation

The viewer now preserves document boundaries when the host payload provides portable-document
metadata. This enables:

- visual document boundaries in the thumbnail strip
- document-aware thumbnail badges
- sticky document headers in the thumbnail pane
- whole-document navigation in addition to page navigation

### Selection-aware filtering

The thumbnail pane now includes a dedicated selection workflow where users can:

- include/exclude whole documents
- include/exclude individual pages
- save or cancel selection edits
- use the saved selection as the active page universe for browsing
- optionally print either the saved selection or the entire session when relevant

### Compare-aware controls

Compare mode now has consistent modifier-based behavior across:

- toolbar navigation
- keyboard navigation
- page rotation
- brightness / contrast targeting
- thumbnail following

`Shift` targets the right compare pane when compare mode is active.

`Ctrl` switches page navigation into document navigation when more than one visible document is
available.

### Print dialog redesign

The print workflow is now centered on a single dialog with a method dropdown:

- Active page
- All pages
- Simple range
- Custom pages

The dialog only shows the extra controls required for the chosen method and keeps the shared print
metadata section stable across methods.

For large jobs, the viewer can show a temporary preparation notice before the browser print preview
appears. The threshold is configurable through runtime config.

### Language persistence without session reset

The viewer language can now be changed from inside OpenDocViewer. Language preference is persisted
locally together with other viewer preferences, while the viewer session remains intact so already
loaded images/pages do not need to be rebuilt.

## Runtime configuration and docs

The runtime/sample configuration surface has been expanded and synchronized so the site sample file
mirrors the safe site-override surface.

As of this release, the only intentionally commented sample entries are the deployment-derived path
examples:

- `basePath`
- `baseHref`

The sample explicitly includes, among other current viewer settings:

- `print.preparationNoticeThresholdPages`
- print shortcut policy
- i18n defaults / supported languages / cache-busting versioning
- current large-document loading options

## Operational notes

- v1.5.0 should be the only production target going forward.
- Older versions are not recommended for current deployments.
- The repository version field may still read `1.4.1` before the final release script is run. The
  actual release process is expected to bump the version to `1.5.0` and tag it.
