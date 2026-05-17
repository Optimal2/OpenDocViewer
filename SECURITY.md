# Security Policy

## Supported Versions

**OpenDocViewer v2.0.3** is the current recommended release line and the preferred production target going forward.

**OpenDocViewer v2.0.2** remains supported and may still be used in production where the v2.0.3 patch has not yet been rolled out, but the recommendation is to move to v2.0.3 to get the latest diagnostics and OMP artifact manifest improvements.

**OpenDocViewer v2.0.1** remains supported and may still be used in production where the v2.0.2 or v2.0.3 patches have not yet been rolled out, but the recommendation is to move to v2.0.3 to get the latest generated-PDF cache language-mode fixes, fixed-language prebuild reuse, diagnostics cleanup, and OMP artifact manifest support.

**OpenDocViewer v2.0.0** remains supported and may still be used in production where the v2.0.x patch line has not yet been rolled out, but the recommendation is to move to v2.0.3 to get the latest reload-cache fixes, generated-PDF cache fixes, source-link diagnostics, problem-notice handling, selection-panel behavior, diagnostics cleanup, and OMP artifact manifest support.

**OpenDocViewer v1.9.1** remains supported and may still be used in production where the v2.0.x feature release has not yet been rolled out, but the recommendation is to move to v2.0.3 to get the latest generated-PDF worker pipeline, session PDF caching, diagnostics, manual refresh, reload-cache, deployment-configuration controls, and OMP artifact manifest support.

**OpenDocViewer v1.9.0** remains supported and may still be used in production where a v2.0.x upgrade has not yet been completed, but the recommendation is to move to v2.0.3 to get the latest supported print configuration model, generated-PDF performance work, prepared COPY/KOPIA watermark assets, diagnostics, and release-script documentation.

**OpenDocViewer v1.8.0** remains supported and may still be used in production where an upgrade has not yet been completed, but the recommendation is to move to v2.0.3 to get the latest supported print configuration model, generated-PDF worker pipeline, dependency/security baseline, and operational support tooling.

Earlier releases are retained for historical reference only and are **not recommended** for current production deployments, even if they were previously marked as safe.

| Version | Security support | Notes |
| ------- | ---------------- | ----- |
| 2.0.3   | :white_check_mark: | Current recommended release and latest supported baseline |
| 2.0.2   | :white_check_mark: | Still supported, but superseded by v2.0.3 and not the preferred target for new deployments |
| 2.0.1   | :white_check_mark: | Still supported, but superseded by v2.0.3 and not the preferred target for new deployments |
| 2.0.0   | :white_check_mark: | Still supported, but superseded by v2.0.3 and not the preferred target for new deployments |
| 1.9.1   | :white_check_mark: | Still supported, but superseded by v2.0.3 and not the preferred target for new deployments |
| 1.9.0   | :white_check_mark: | Still supported, but superseded by v2.0.3 and not the preferred target for new deployments |
| 1.8.0   | :white_check_mark: | Still supported, but superseded by v2.0.3 and not the preferred target for new deployments |
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

### OpenDocViewer v2.0.3
Changes since v2.0.2:

- Improved diagnostics JSON downloads with timestamped default filenames.
- Added console diagnostics when a diagnostics download cannot be created.
- Hardened temporary download URL cleanup after successful and failed diagnostics downloads.
- Added build-id fallback support for diagnostics.
- Made diagnostics fields clearer by naming render-worker counts separately and documenting device-memory units.
- Kept diagnostics own-property checks compatible with older browser shells.
- Replaced several diagnostics list-size literals with named limits.
- Reduced duplicate benchmark-result loading logic.
- Replaced packed compare-rotation dependency math with an explicit primary/compare rotation key.
- Added an OMP component manifest and version-bump helper for artifact-based deployment tooling.

### OpenDocViewer v2.0.2
Changes since v2.0.1:

- Added `print.pdf.cacheLanguageMode`.
- Kept the default `strict` mode, where localized print text remains part of the generated-PDF cache key.
- Added opt-in `ignore` mode for installations where generated print output is intentionally identical across UI languages.
- Fixed reuse of fixed-language all-pages PDF prebuild variants when the active UI language differs from the configured prebuild language.
- Stopped UI language changes from invalidating fixed-language prebuild runs.
- Applied the same language-mode cache policy to user-generated session PDFs and background-prebuilt PDFs.
- Documented the cache language mode and exposed it in diagnostics.

### OpenDocViewer v2.0.1
Changes since v2.0.0:

- Added an optional short-lived reload cache for original source blobs and rendered page assets.
- Keyed reload-cache entries from stable document identity and version metadata instead of temporary source URLs.
- Kept the reload cache disabled by default, with bounded TTL validation and performance-overlay hit/miss diagnostics.
- Rejected invalid document payloads before caching.
- Improved handling and diagnostics for expired source links and serious source/session failures.
- Added a configurable viewer-level problem notice for serious loading failures.
- Preserved zero brightness and contrast values correctly.
- Changed the Selection tab cancel action so it is always available, discards unsaved selection edits, and returns to the thumbnail view.
- Aligned Swedish and English help text with the Selection tab behavior.
- Cleaned up source temporary storage, reload-cache TTL normalization, queued writes, cache constants, and benchmark helper signatures.

### OpenDocViewer v2.0.0
Changes since v1.9.1:

- Added a dedicated generated-PDF worker pipeline.
- Added worker-batch dispatch planning, partial PDF generation, and final PDF merge support.
- Changed generated-PDF progress reporting to deterministic work units.
- Added optional background preparation for common all-pages print variants.
- Paused background PDF preparation while a user-initiated print or download job is active.
- Kept completed prebuilt variants in the session cache.
- Added session-scoped generated-PDF cache reuse for compatible print settings.
- Excluded active-page PDF output from cache-key reuse because transient page edits can change the output.
- Added a configurable automatic-orientation checkbox for generated-PDF output.
- Added configurable print/export action labels and tooltips.
- Moved the runtime status indicator to the help-menu status LED.
- Kept diagnostics JSON download available independently of benchmark execution.
- Added opt-in PDF and render/decode benchmark tooling.
- Removed the old HTML print prewarm path.
- Documented generated-PDF prebuild and benchmark configuration.
- Added configuration for hiding user-facing metadata dialogs while preserving metadata internally.
- Added a manual reload control for site-local manual HTML updates.

### OpenDocViewer v1.9.1
Changes since v1.9.0:

- Promoted `dompurify` to a direct dependency.
- Added defense-in-depth sanitization for trusted header/footer template HTML before generated-PDF rendering.
- Tightened generated-PDF template parsing.
- Improved image-source diagnostics, printable surface extraction, cancellation handling, and jsPDF initialization errors.
- Improved generated-PDF rich text handling for header/footer templates.
- Added support for bold/italic detection, block/inline flow handling, simple alignment, two-column flex rows, text fitting, ellipsis behavior, and image format fallbacks.
- Kept generated-PDF cleanup delays conservative so browser print previews do not lose their backing PDF blob too early.
- Extracted constants and helper functions around PDF timing, quality, image handling, text fitting, and jsPDF compatibility.

### OpenDocViewer v1.9.0
Changes since v1.8.0:

- Refreshed runtime and development dependencies, including `axios` 1.16.0, `express-rate-limit` 8.5.1, resolved `ip-address` 10.2.0, React 19.2.6, pdf.js 5.7.284, and Vite 8.0.11.
- Updated lint/build tooling and release validation guidance.
- Added prepared transparent COPY and KOPIA watermark image assets.
- Added watermark modes: `auto`, `copy`, `kopia`, and `custom`.
- Kept custom text watermarking available.
- Made generated-PDF watermarks more subtle.
- Added configurable and localizable print action labels and tooltips.
- Improved generated-PDF header and footer rendering for the supported print-template subset.
- Preserved common inline styling such as bold and italic in generated-PDF output.
- Added simple left/right/center alignment and two-column flex-row handling for generated-PDF headers and footers.
- Documented the limited CSS parsing model for generated-PDF templates.
- Added cancellation for generated-PDF output while pages are being prepared.
- Added Escape as a cancel shortcut with confirmation.
- Replaced "secure print" terminology in progress UI with neutral wording.
- Kept print pre-warming configurable and disabled by default.
- Added a session-URL integration helper and related error handling.
- Updated runtime configuration documentation for expanded print options.
- Documented non-interactive release-script usage.

### OpenDocViewer v1.8.0
Changes since v1.7.0:

- Added a PDF-based print path alongside the existing browser HTML print path.
- Added optional PDF download from the print dialog.
- Added progress feedback while PDF output is generated.
- Simplified the print dialog to explicit actions for HTML print, PDF print, and PDF download.
- Added a reusable `StatusLed` component and initial print-readiness integration.
- Improved visual alignment between HTML print and generated-PDF output.
- Improved copy-marker handling in headers and watermark rendering.
- Expanded the bundled Swedish and English manuals.
- Hardened generated-PDF fallback handling, sanitization, quality normalization, and resource cleanup.
- Updated release documentation and release-script handling.

### OpenDocViewer v1.7.0
Changes since v1.6.0:

- Added a configurable copy-marker workflow for physical print output.
- Added configuration for exposing, defaulting, hiding, or forcing the copy watermark control.
- Added separate display labels and physical print values for print dialog options.
- Added metadata-aware header and footer templates with `{{...}}` tokens.
- Added conditional print-template blocks, page-specific document metadata, session-level tokens, structured reason/format tokens, metadata alias tokens, newline support, and a dedicated print footer.
- Escaped token values before insertion while preserving trusted administrator-authored template markup.
- Changed the default header/footer layout to reserve page space instead of drawing over the original page image.
- Adjusted copy watermark size, opacity, and visibility.
- Fixed JSDoc parser issues in print modules.
- Documented the print token and layout model.
- Tightened i18n path/default handling.
- Improved robustness around `import.meta` and `window` access.
- Added safer i18n path segment handling.
- Updated print-related logging payloads.
- Refreshed selected dependencies, including `i18next-http-backend` and `postcss`.

v1.7.0 is superseded by later releases and is not recommended for current deployments.

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
