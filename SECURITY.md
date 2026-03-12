<!-- File: SECURITY.md -->
# Security Policy

## Supported Versions

**OpenDocViewer v1.2.0** is the current recommended release.  
**OpenDocViewer v1.1.0** is still considered safe to run and eligible for security fixes, but it is superseded by v1.2.0 and lacks some usability improvements added later.  
**OpenDocViewer v1.0.1** is still considered safe to run for older deployments, but it is a legacy supported release and lacks later fixes and improvements.

Older releases are retained for historical reference only.

| Version | Security support | Notes |
| ------- | ---------------- | ----- |
| 1.2.0   | :white_check_mark: | Current recommended release |
| 1.1.0   | :white_check_mark: | Supported safe release, superseded by 1.2.0 |
| 1.0.1   | :white_check_mark: | Supported legacy safe release |
| 1.0.0   | :x: | Superseded by later supported releases |
| 0.9.0   | :x: | Unsupported |
| < 0.9.0 | :x: | Unsupported |

## Recent release context

The five most recent releases are listed below for operational context:

### OpenDocViewer v1.2.0
OpenDocViewer v1.2.0 improves keyboard shortcut reliability and removes focus-dependent viewer command handling.

This release changes shortcut routing so viewer commands continue to work when focus is on toolbar buttons or other non-editable UI elements. Shortcuts are now suppressed only in interactive editing contexts such as text inputs, selects, contenteditable regions, and modal dialogs. It also removes the previous focus warning/button that was required to restore viewer keyboard control.

### OpenDocViewer v1.1.0
OpenDocViewer v1.1.0 improves print integration, keyboard usability, and document loading feedback.

This release adds configurable handling for Ctrl/Cmd+P, introduces a dedicated print shortcut on 0, fixes an issue where shortcut 6 could override numeric input in toolbar fields, and makes ongoing page loading more visible in the navigation UI. It also updates SECURITY.md and refines runtime configuration examples to better reflect the current application behavior.

### OpenDocViewer v1.0.1
OpenDocViewer v1.0.1 improves print header reliability and overall print-flow robustness.

This release fixes a critical issue introduced in v1.0.0 where print headers did not render correctly, and strengthens the print pipeline with safer DOM handling and improved readiness checks before printing.

### OpenDocViewer v1.0.0
OpenDocViewer 1.0.0 establishes the first stable baseline for the project.

This release focuses on internal stabilization and maintainability, including a clearer app structure, improved bootstrap/integration boundaries, expanded documentation, and CI validation for lint, build, and generated docs.

It also includes smaller robustness improvements across the viewer, loader, diagnostics, and runtime configuration.

### OpenDocViewer v0.9.0
OpenDocViewer 0.9.0 updates project dependencies and maintenance tooling.

This release primarily refreshes runtime and development dependencies, including React, Vite, i18n, PDF, and linting-related packages, without verified application-level feature changes in the source code.

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