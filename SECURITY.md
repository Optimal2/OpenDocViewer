# Security Policy

## Supported Versions

**OpenDocViewer v1.1.0** is the current recommended release.  
**OpenDocViewer v1.0.1** is still considered safe to run and eligible for security fixes, but it is superseded by v1.1.0 and lacks some fixes and functionality added later.

Older releases are retained for historical reference only.

| Version | Security support | Notes |
| ------- | ---------------- | ----- |
| 1.1.0   | :white_check_mark: | Current recommended release |
| 1.0.1   | :white_check_mark: | Supported safe release, superseded by 1.1.0 |
| 1.0.0   | :x: | Superseded by 1.0.1 and 1.1.0 |
| 0.9.0   | :x: | Unsupported |
| 0.8.1   | :x: | Unsupported |
| < 0.8.1 | :x: | Unsupported |

## Recent release context

The five most recent releases are listed below for operational context:

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

### OpenDocViewer v0.8.1
OpenDocViewer 0.8.1 improves security hardening for the zoom percent input.

This release sanitizes user-entered zoom values more robustly while preserving the same behavior for valid input. It includes no UI or API changes and mainly affects malformed input handling.

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