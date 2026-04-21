<!-- File: SECURITY.md -->
# Security Policy

## Supported Versions

**OpenDocViewer v1.6.0** is the current recommended release line and the preferred production target going forward.

**OpenDocViewer v1.5.0** remains supported and may still be used in production where an upgrade has not yet been completed, but the recommendation is to move to v1.6.0 to get the latest supported viewer functionality, metadata tooling, documentation/help model, and theme/runtime refinements.

Earlier releases are retained for historical reference only and are **not recommended** for current production deployments, even if they were previously marked as safe.

| Version | Security support | Notes |
| ------- | ---------------- | ----- |
| 1.6.0   | :white_check_mark: | Current recommended release and latest supported baseline |
| 1.5.0   | :white_check_mark: | Still supported, but superseded by v1.6.0 and not the preferred target for new deployments |
| 1.4.1   | :x: | Superseded by later releases; not recommended for current deployments |
| 1.4.0   | :x: | Unsupported |
| 1.3.1   | :x: | Unsupported |
| 1.3.0   | :x: | Unsupported |
| 1.2.0   | :x: | Unsupported |
| 1.1.0   | :x: | Unsupported |
| 1.0.1   | :x: | Unsupported |
| 1.0.0   | :x: | Unsupported |
| 0.9.0   | :x: | Unsupported |
| < 0.9.0 | :x: | Unsupported |

## Recent release context

The eight most recent releases are listed below for operational context.

### OpenDocViewer v1.6.0
OpenDocViewer v1.6.0 extends the document-aware viewer baseline from v1.5.0 with richer metadata handling, improved operator-facing overlays, configurable HTML-based help content, and broader runtime/UI refinement.

From a support and maintainability perspective this release preserves full raw document metadata in the normalized integration layer, adds optional semantic alias mapping for host metadata, and surfaces that metadata through new in-viewer tools rather than leaving it trapped inside the incoming payload. This makes later UI, print, support, and integration work less dependent on deployment-specific parsing logic.

From a viewer workflow perspective it adds document metadata overlays from page and thumbnail context menus, a metadata matrix view across all documents in the current session, improved metadata fallback behavior, and Escape-based closing consistency for the new overlays. It also expands the toolbar/help area with an About dialog, version visibility in the UI, and an HTML-based manual model that can be overridden site-locally without rebuilding the application.

This release also reintroduces theme support in a more controlled form with explicit Normal / Light / Dark modes, persisted user preference handling, and broader theme-token cleanup across dialogs and interactive surfaces so the viewer remains usable in all supported themes.

OpenDocViewer v1.6.0 is recommended going forward because it keeps the v1.5.0 security/dependency baseline while improving metadata transparency, site-local documentation flexibility, usability, and long-term integration maintainability.

### OpenDocViewer v1.5.0
OpenDocViewer v1.5.0 is the consolidated production baseline that combines the latest supported viewer workflow with the current security/dependency baseline.

From a security perspective this release is the first one in the current line that combines the recommended dependency set (`axios` 1.15.0 and the corresponding resolved `follow-redirects` / `dompurify` updates in the lockfile) with the current runtime hardening around gated diagnostics, safer context-menu behavior inside the viewer, and version-aware language-resource loading.

From a functional/support perspective it also introduces the document-aware viewer model: portable-document grouping, selection-aware filtering, compare-aware modifier targeting, unified print-dialog flow, configurable large-print preparation notices, persisted language preferences, and synchronized runtime/sample configuration coverage.

v1.5.0 remains supported, but v1.6.0 is preferred for current deployments.

### OpenDocViewer v1.4.1
OpenDocViewer v1.4.1 is a targeted patch release focused on maintenance and release hygiene.

This release updates the development/build toolchain to remediate current Vite security advisories, keeps the existing runtime behavior intact, improves release-script clarity around manual SECURITY.md updates and post-push verification, and adds small maintainability clarifications in worker-side rendering code where GitHub AI previously raised low-confidence suggestions.

### OpenDocViewer v1.4.0
OpenDocViewer v1.4.0 improves hybrid document loading throughput, rendered-page reuse, viewer stability during held navigation, diagnostics behavior, and loading-time print behavior.

This release keeps the hybrid loader architecture but now reuses full rendered page assets for thumbnails by default while memory pressure allows it, increases the resident full-page cache target for performance-oriented runs, and speeds background warm-up by dispatching batches concurrently through the worker/main render schedulers instead of serializing every asset request. It also keeps performance-overlay counters updating after the initial load completes while still stopping the load-duration timer, disables overlay-specific polling entirely when the overlay is not enabled, simplifies the print dialog to an active-page-only mode while page discovery is still in progress so the UI no longer appears to reset itself mid-load, and hardens Page Up, Page Down, Arrow Up, and Arrow Down repeat navigation so long key-holds behave like the stable toolbar press-and-hold path.

### OpenDocViewer v1.3.1
OpenDocViewer v1.3.1 hardens the viewer after v1.3.0 with a focus on rendered page asset reliability, safer cleanup behavior, and more predictable zoom handling.

This release fixes cases where stale object URLs could cause rendered page images to fail in longer mixed-document sessions, makes single-page raster cleanup more conservative so original data is only released after verified full-asset persistence, and stabilizes Fit to Screen, Fit to Width, and Actual Size against the exact pane viewport in Edge and Chrome.

### OpenDocViewer v1.3.0
OpenDocViewer v1.3.0 improves overall stability in the document loading and rendering pipeline, with a strong focus on making the viewer behave more predictably across larger and more varied document sets.

This release consolidates the work done after v1.2.0 into a more stable baseline, especially around source loading, rendered page asset handling, thumbnail behavior, temporary storage, and memory-related defaults. The result is a viewer that is more reliable in practical use while still preserving the performance and memory improvements that were safe to keep.

The release also improves configuration clarity by expanding the site-level sample configuration, and updates documentation to better reflect the current runtime behavior and supported deployment model.

### OpenDocViewer v1.2.0
OpenDocViewer v1.2.0 improves keyboard shortcut reliability and removes focus-dependent viewer command handling.

This release changes shortcut routing so viewer commands continue to work when focus is on toolbar buttons or other non-editable UI elements. Shortcuts are now suppressed only in interactive editing contexts such as text inputs, selects, contenteditable regions, and modal dialogs. It also removes the previous focus warning/button that was required to restore viewer keyboard control.

### OpenDocViewer v1.1.0
OpenDocViewer v1.1.0 improves print integration, keyboard usability, and document loading feedback.

This release adds configurable handling for Ctrl/Cmd+P, introduces a dedicated print shortcut on 0, fixes an issue where shortcut 6 could override numeric input in toolbar fields, and makes ongoing page loading more visible in the navigation UI. It also updates SECURITY.md and refines runtime configuration examples to better reflect the current application behavior.

### OpenDocViewer v1.0.1
OpenDocViewer v1.0.1 improves print header reliability and overall print-flow robustness.

This release fixes a critical issue introduced in v1.0.0 where print headers did not render correctly, and strengthens the print pipeline with safer DOM handling and improved readiness checks before printing.

## Reporting a Vulnerability

Please report security vulnerabilities by email to **dev@optimal2.se**.

Use a subject such as:

`Security vulnerability report: <short description>`

Include at least:

- a clear description of the issue and its potential impact
- steps to reproduce, including sample input, configuration, or test data where relevant
- the exact OpenDocViewer version you tested
- relevant logs, stack traces, screenshots, or proof-of-concept material

Do **not** open a public issue for suspected security vulnerabilities.

## Response expectations

We aim to:

- acknowledge valid reports within **3 business days**
- provide status updates at least every **7 days** while investigation or remediation is ongoing
- coordinate fixes and release notes before public disclosure when appropriate