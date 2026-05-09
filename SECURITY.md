# Security Policy

## Supported Versions

**OpenDocViewer v1.9.1** is the current recommended release line and the preferred production target going forward.

**OpenDocViewer v1.9.0** remains supported and may still be used in production where the v1.9.1 patch has not yet been rolled out, but the recommendation is to move to v1.9.1 to get the latest generated-PDF hardening, diagnostics, and maintainability fixes.

**OpenDocViewer v1.8.0** remains supported and may still be used in production where an upgrade has not yet been completed, but the recommendation is to move to v1.9.1 to get the latest supported print configuration model, generated-PDF header/footer improvements, prepared COPY/KOPIA watermark assets, dependency/security baseline, and release-script documentation.

Earlier releases are retained for historical reference only and are **not recommended** for current production deployments, even if they were previously marked as safe.

| Version | Security support | Notes |
| ------- | ---------------- | ----- |
| 1.9.1   | :white_check_mark: | Current recommended release and latest supported baseline |
| 1.9.0   | :white_check_mark: | Still supported, but superseded by v1.9.1 and not the preferred target for new deployments |
| 1.8.0   | :white_check_mark: | Still supported, but superseded by v1.9.1 and not the preferred target for new deployments |
| 1.7.0   | :x: | Superseded by later releases; not recommended for current deployments |
| 1.6.0   | :x: | Superseded by later releases; not recommended for current deployments |
| 1.5.0   | :x: | Superseded by later releases; not recommended for current deployments |
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

### OpenDocViewer v1.9.1
OpenDocViewer v1.9.1 is a targeted patch release on top of v1.9.0 focused on generated-PDF hardening, diagnostics, and maintainability. Existing v1.9.0 print configuration should continue to work; this patch does not introduce a new runtime configuration model.

Compared with v1.9.0, the main functional area touched is the generated-PDF backend in `src/utils/printPdf.js`. The release promotes `dompurify` to a direct dependency and uses it as an explicit defense-in-depth layer for trusted administrator-authored header/footer template HTML before the generated-PDF renderer consumes the limited rich-text subset it supports.

From a security and robustness perspective this release tightens generated-PDF template parsing, image-source diagnostics, safe printable surface extraction, cancellation handling, and jsPDF initialization errors. Diagnostic messages are more actionable while still avoiding uncontrolled or overly large source strings in error output.

From a generated-PDF output perspective this release improves rich text handling for header/footer templates, including bold/italic detection, block/inline flow handling, simple alignment, two-column `display:flex; justify-content:space-between` rows, text fitting, ellipsis behavior, and image format fallbacks. It also keeps generated-PDF cleanup delays intentionally conservative so browser print previews do not lose their backing PDF blob while the user is still interacting with the print dialog.

From a maintainability perspective this release extracts constants and small helper functions around PDF timing, quality, image handling, text fitting, and jsPDF compatibility assumptions. The goal is to keep the generated-PDF backend easier to review and safer to adjust without changing the public integration contract.

OpenDocViewer v1.9.1 is recommended going forward because it keeps the v1.9.0 print configuration model while adding the latest generated-PDF hardening and review-driven cleanup.

### OpenDocViewer v1.9.0
OpenDocViewer v1.9.0 builds on the v1.8.0 generated-PDF print baseline with a safer dependency set, clearer print configuration, and closer visual parity between HTML print and generated-PDF print.

From a security and maintenance perspective this release refreshes the npm dependency baseline, including `axios` 1.16.0, `express-rate-limit` 8.5.1, resolved `ip-address` 10.2.0, React 19.2.6, pdf.js 5.7.284, Vite 8.0.11, and the matching lint/build tooling updates. The release validation baseline is `npm audit --audit-level=low`, `npm run lint`, `npm run build`, and `npm run doc`.

From a print-configuration perspective this release adds prepared transparent COPY and KOPIA watermark image assets, introduces explicit watermark modes (`auto`, `copy`, `kopia`, and `custom`), keeps custom text watermarking available, and makes generated-PDF watermarks more subtle so they do not obscure the underlying document content. Print actions can also be configured and localized for HTML print, generated-PDF print, and generated-PDF download labels and tooltips.

From a generated-PDF output perspective this release improves header and footer rendering for the trusted print-template subset used by OpenDocViewer deployments. The generated-PDF backend now preserves common inline styling such as bold and italic, supports simple left/right/center text alignment, handles the common two-column `display:flex; justify-content:space-between` header/footer pattern, and documents the intentionally limited CSS parsing model instead of attempting to behave like a full browser layout engine.

From an operator workflow perspective this release makes generated-PDF output cancellable while pages are being prepared, supports Escape as a cancel shortcut with confirmation, uses neutral terminology instead of "secure print" in the progress UI, and keeps print pre-warming configurable with the default disabled because it has not shown a reliable performance benefit.

From an integration and release-readiness perspective this release adds a session-URL integration helper, improves related error handling, updates the runtime configuration documentation for the expanded print options, keeps customer-specific packaging out of the public repository through ignored local files, and documents non-interactive release-script usage through `.\release.ps1 -ReleaseType minor -Yes`.

OpenDocViewer v1.9.0 combines the v1.8.0 generated-PDF print workflow with a cleaner print configuration model, improved PDF/HTML print consistency, and a refreshed security/dependency baseline. v1.9.1 is preferred for current deployments.

### OpenDocViewer v1.8.0
OpenDocViewer v1.8.0 builds on the v1.7.0 print customization baseline with a more practical, operator-friendly print workflow and a generated-PDF print backend.

From a print-output perspective this release adds a PDF-based print path alongside the existing browser HTML print path. Users can print through the browser's HTML preview, print via a generated PDF, or download the generated PDF when enabled by configuration. The PDF path reuses already rendered page images where possible, shows OpenDocViewer-side generation progress, supports configured headers, footers, metadata tokens, copy-marker output, and page-specific portrait/landscape handling. The existing HTML print path remains available for direct browser printing and for compatibility with existing deployments.

From a print-dialog perspective this release simplifies the UI after the broader v1.7.0 print feature expansion. The dialog now uses plain, explicit actions for HTML print, PDF print, and PDF download rather than a split-button/dropdown model. The visible explanatory text is kept short, while detailed behavioral differences between HTML print and PDF print are documented in the manual. The copy-watermark tooltip remains available on the relevant label without expanding the dialog.

From a user-feedback perspective this release adds visible progress while OpenDocViewer generates PDF print/download output. This makes larger print jobs feel less opaque: users can see how many pages have been processed before the browser's own print preview appears. A reusable StatusLed component also provides a compact status pattern that can be reused elsewhere in the application.

From a documentation and support perspective this release substantially expands the bundled Swedish and English default manuals. The manuals now cover navigation, zoom, thumbnails, metadata, selection, comparison, image adjustments, print modes, PDF download, copy watermark, headers/footers, large-document behavior, troubleshooting, and site-local manual overrides. The Swedish and English default manuals contain the same operational content in their respective languages.

From a maintainability and hardening perspective this release refines generated-PDF sanitization and fallback handling, improves PDF/HTML watermark and header visual consistency, avoids premature cleanup of generated-PDF preview resources, fixes release-script parameter/newline issues, simplifies print UI styling, and addresses follow-up code review comments in the PDF and warm-frame print modules.

OpenDocViewer v1.8.0 keeps the v1.7.0 metadata-aware print model while adding a more transparent PDF print workflow, clearer operator feedback, and more complete built-in documentation. v1.9.0 is preferred for current deployments.

### OpenDocViewer v1.7.0
OpenDocViewer v1.7.0 extends the v1.6.0 metadata-aware viewer baseline with a substantially richer and safer print customization model.

From a print-control perspective this release adds a configurable copy-marker workflow for physical print output. Deployments can expose a user-controlled copy watermark checkbox, default it on or off, hide it while forcing the configured marker, localize display labels separately from physical print output, and use `printValue` for clean print text while keeping longer UI instructions in the print dialog. Normal printing remains unmarked by default unless the deployment explicitly configures otherwise.

From a print-template perspective this release adds metadata-aware header and footer templates with `{{...}}` tokens, conditional blocks that suppress empty labels, page-specific document metadata, session-level tokens, structured reason/format selection tokens, metadata alias tokens, newline support, and a dedicated print footer. Token values are escaped before insertion while trusted administrator-authored template markup remains supported.

From a print-layout perspective the default header/footer model now reserves page space instead of drawing over the original page image. This avoids obscuring document content while still allowing explicit legacy overlay behavior through configuration. The copy watermark has also been adjusted to be larger, more transparent, and more visible across both light and dark source pages by combining low-opacity text with contrast stroke/glow styling.

From a maintainability and hardening perspective this release fixes JSDoc parser issues in the print modules, documents the print token and layout model, tightens i18n path/default handling, improves robustness around `import.meta`/window access, adds safer i18n path segment handling, updates print-related logging payloads, and refreshes selected dependencies including `i18next-http-backend` and `postcss`.

v1.7.0 is superseded by later releases and is not recommended for current deployments.

### OpenDocViewer v1.6.0
OpenDocViewer v1.6.0 extends the document-aware viewer baseline from v1.5.0 with richer metadata handling, improved operator-facing overlays, configurable HTML-based help content, and broader runtime/UI refinement.

From a support and maintainability perspective this release preserves full raw document metadata in the normalized integration layer, adds optional semantic alias mapping for host metadata, and surfaces that metadata through new in-viewer tools rather than leaving it trapped inside the incoming payload. This makes later UI, print, support, and integration work less dependent on deployment-specific parsing logic.

From a viewer workflow perspective it adds document metadata overlays from page and thumbnail context menus, a metadata matrix view across all documents in the current session, improved metadata fallback behavior, and Escape-based closing consistency for the new overlays. It also expands the toolbar/help area with an About dialog, version visibility in the UI, and an HTML-based manual model that can be overridden site-locally without rebuilding the application.

This release also reintroduces theme support in a more controlled form with explicit Normal / Light / Dark modes, persisted user preference handling, and broader theme-token cleanup across dialogs and interactive surfaces so the viewer remains usable in all supported themes.

### OpenDocViewer v1.5.0
OpenDocViewer v1.5.0 is the consolidated production baseline that combines the latest supported viewer workflow with the current security/dependency baseline.

From a security perspective this release is the first one in the current line that combines the recommended dependency set (`axios` 1.15.0 and the corresponding resolved `follow-redirects` / `dompurify` updates in the lockfile) with the current runtime hardening around gated diagnostics, safer context-menu behavior inside the viewer, and version-aware language-resource loading.

From a functional/support perspective it also introduces the document-aware viewer model: portable-document grouping, selection-aware filtering, compare-aware modifier targeting, unified print-dialog flow, configurable large-print preparation notices, persisted language preferences, and synchronized runtime/sample configuration coverage.

### OpenDocViewer v1.4.1
OpenDocViewer v1.4.1 is a targeted patch release focused on maintenance and release hygiene.

This release updates the development/build toolchain to remediate current Vite security advisories, keeps the existing runtime behavior intact, improves release-script clarity around manual SECURITY.md updates and post-push verification, and adds small maintainability clarifications in worker-side rendering code where GitHub AI previously raised low-confidence suggestions.

### OpenDocViewer v1.4.0
OpenDocViewer v1.4.0 improves hybrid document loading throughput, rendered-page reuse, viewer stability during held navigation, diagnostics behavior, and loading-time print behavior.

This release keeps the hybrid loader architecture but now reuses full rendered page assets for thumbnails by default while memory pressure allows it, increases the resident full-page cache target for performance-oriented runs, and speeds background warm-up by dispatching batches concurrently through the worker/main render schedulers instead of serializing every asset request. It also keeps performance-overlay counters updating after the initial load completes while still stopping the load-duration timer, disables overlay-specific polling entirely when the overlay is not enabled, simplifies the print dialog to an active-page-only mode while page discovery is still in progress so the UI no longer appears to reset itself mid-load, and hardens Page Up, Page Down, Arrow Up, and Arrow Down repeat navigation so long key-holds behave like the stable toolbar press-and-hold path.

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
