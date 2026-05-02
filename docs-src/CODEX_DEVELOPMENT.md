# Codex Development Guide

This guide is the compact, agent-friendly entry point for OpenDocViewer development with Codex 5.5+ from VS Code. Keep it factual and current. Put detailed architecture, integration, and deployment context in the linked documents, not here.

## Repository Role

OpenDocViewer is a generic browser-based document viewer for PDF, TIFF, and raster image files. It can be used standalone, embedded, or started by a host application through a normalized Portable Document Bundle.

OpenDocViewer should stay host-neutral. IbsPackager manual-review support belongs in the integration contract and in IbsPackager host code unless a generic viewer capability is missing.

Use these files as the main map:

- `AGENTS.md` - operational rules for Codex and other coding agents.
- `README.md` - product overview, setup, deployment, and documentation map.
- `CONTRIBUTING.md` - repository conventions and review checklist.
- `docs-src/architecture.md` - runtime flow and module responsibilities.
- `docs-src/integrations.md` - host integration contract for files, metadata, and bootstrap modes.
- `docs-src/runtime-configuration.md` - runtime config loading order, override rules, and deployment notes.
- `docs-src/deploy-ops.md` - IIS hosting, proxy deployment, cache rules, and operational checklists.
- `docs-src/log-servers.md` - optional logging endpoint contracts and security assumptions.
- `docs-src/printing.md` - print pipeline design and module boundaries.

## Language and Documentation Policy

- Write code, comments, scripts, and development documentation in English.
- Use Swedish only in application localization and help resources under `public/locales/` and `public/help/`.
- Prefer short Markdown sections with stable headings, concrete paths, and runnable commands.
- Keep AI-facing instructions in `AGENTS.md` and this file; avoid duplicating rules across many READMEs.
- Keep the integration contract in `docs-src/integrations.md` aligned with `src/integrations/*` and `src/schemas/portableBundle.js`.

## Safe Change Workflow

1. Inspect files before editing. Do not infer payload schemas, runtime config keys, routes, or deployment behavior from names alone.
2. Keep changes scoped to OpenDocViewer unless the task explicitly requires matching host changes in IbsPackager or OpenModulePlatform.
3. Preserve the viewer/host boundary: ODV renders documents; host applications own permissions, workflow state, and business commands.
4. Update docs when bootstrap behavior, bundle shape, runtime config, deployment, or public integration guidance changes.
5. Run the narrowest useful validation.
6. If the user needs to see the change in a hosted runtime, build and deploy the updated static bundle using the matching local workflow.

## Validation Ladder

Use the narrowest level that gives real confidence:

- JavaScript or React changes: `npm run lint`
- Bundling/runtime import changes: `npm run build`
- JSDoc/commented API changes: `npm run doc`
- PowerShell script changes: parse the changed `.ps1` file with `System.Management.Automation.Language.Parser`
- Documentation-only changes: `git diff --check`
- Local hosted visibility: build `dist/`, update the hosted directory, then verify the relevant localhost URL

Avoid running `npm install` unless dependency files need to change. Use `npm ci` only when a clean dependency restore is part of the task.

## Local Runtime Defaults

Default local paths and endpoints:

```text
OpenDocViewer repo:      E:\Linus Dunkers\Documents\GitHub\OpenDocViewer
OpenModulePlatform repo: E:\Linus Dunkers\Documents\GitHub\OpenModulePlatform
IbsPackager repo:        E:\Linus Dunkers\Documents\GitHub\IbsPackager
Runtime root:            E:\OMP
Portal URL:              http://localhost:8088/
IbsPackager URL:         http://localhost:8088/ibspackager/
```

These are local development defaults. Do not hardcode user-specific paths into reusable scripts unless the task explicitly asks for a local-only script.

## Common Commands

```powershell
npm run lint
npm run build
npm run doc
```

For local development:

```powershell
npm run dev
```

For release validation, prefer the existing release helper when the task is explicitly about preparing a release:

```powershell
.\release.ps1
```

## Integration Notes

The canonical host contract is Portable Document Bundle v1. For future IbsPackager manual-review integration:

- IbsPackager should provide browser-reachable file URLs and review metadata to ODV.
- ODV should display files and metadata without owning review approval/rejection state.
- Review commands, authorization, audit rules, and temporary URL issuance should remain in IbsPackager and the platform.
- Add generic ODV capabilities only when they are useful beyond one host application.

Read `docs-src/integrations.md` before changing `src/integrations/bootstrapRuntime.js`, `src/integrations/normalizePortableBundle.js`, or `src/components/DocumentLoader/sources/explicitListSource.js`.

## Generated Output

- `dist/` is build output.
- `docs/` is generated JSDoc output.
- Hand-written source documentation belongs in `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, and `docs-src/`.

Do not commit generated output unless the task or release process explicitly requires it.
