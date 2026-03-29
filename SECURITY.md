# Security Policy

## Supported Versions

**OpenDocViewer v1.3.1** is the only supported and recommended release.
All earlier releases should be upgraded to **v1.3.1**.

Older releases are retained for historical reference only and are not considered secure deployment targets.

| Version | Security support   | Notes                                    |
| ------- | ------------------ | ---------------------------------------- |
| 1.3.1   | :white_check_mark: | Current recommended release              |
| 1.3.0   | :x:                | Superseded by 1.3.1; upgrade recommended |
| 1.2.0   | :x:                | Superseded by 1.3.1; upgrade recommended |
| 1.1.0   | :x:                | Superseded by 1.3.1; upgrade recommended |
| 1.0.1   | :x:                | Superseded by 1.3.1; upgrade recommended |
| 1.0.0   | :x:                | Unsupported                              |
| 0.9.0   | :x:                | Unsupported                              |
| < 0.9.0 | :x:                | Unsupported                              |

## Recent release context

The five most recent releases are listed below for operational context:

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

Please report security vulnerabilities by email to **[dev@optimal2.se](mailto:dev@optimal2.se)**.

Use a subject such as:

`Security vulnerability report: <short description>`

Include at least:

* a clear description of the issue and its potential impact
* steps to reproduce, including sample input, configuration, or test data where relevant
* the exact OpenDocViewer version you tested
* relevant logs, stack traces, screenshots, or proof-of-concept material

Do **not** open a public issue for suspected security vulnerabilities.

## Response expectations

We aim to:

* acknowledge valid reports within **3 business days**
* provide status updates at least every **7 days** while investigation or remediation is ongoing
* coordinate fixes and release notes before public disclosure when appropriate