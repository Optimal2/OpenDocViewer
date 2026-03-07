# Contributing to OpenDocViewer

This document defines the repository conventions used by the project. The goal is consistency and low-risk maintenance rather than stylistic novelty.

## Scope of changes

When touching a file, try to keep the change in one of these categories:

- behavior change
- refactor / structure only
- documentation only
- test only

Mixing categories is sometimes necessary, but separating them usually makes review easier.

## File naming

Use names that reflect the module role.

- **React components**: `PascalCase.jsx`
  - examples: `DocumentToolbar.jsx`, `ThemeProvider.jsx`
- **Hooks**: `useSomething.js`
  - examples: `useDocumentViewer.js`, `usePageNavigation.js`
- **Utilities / services / integrations / workers**: `camelCase.js`
  - examples: `zoomUtils.js`, `bootstrapRuntime.js`, `imageWorker.js`
- **Folders**: keep them feature-oriented and stable
  - examples: `DocumentLoader/`, `DocumentToolbar/`, `integrations/`, `logging/`

Avoid generic names such as `Utils.js` or `Helpers.js` unless the scope is truly local and obvious.

## `js` / `jsx` policy

The project uses both `js` and `jsx` on purpose.

- Use **`.jsx`** when the file contains JSX markup.
- Use **`.js`** when the file contains no JSX.

This makes intent visible from the filename and keeps build tooling simpler.

## Comments and JSDoc

Comments should explain one of the following:

- responsibility boundaries
- data flow
- non-obvious browser/runtime constraints
- why a decision exists

Comments should not restate trivial code.

For exported modules and complex helpers:

- keep a top-of-file overview
- document important typedefs / callback types with JSDoc
- update docs when a module’s responsibility changes

## Refactoring guidelines

Before splitting a large file, identify which responsibility is actually being separated. Good split points include:

- rendering vs. orchestration
- parsing vs. DOM work
- integration boundary vs. UI boundary
- shared utility vs. feature-specific behavior

Low-risk refactors are preferred unless the change is explicitly intended to alter behavior.

## Review checklist

Before opening or merging a change, verify at least the following when relevant:

```bash
npm run lint
npm run build
npm run doc
```

Also check:

- imports point to the new canonical path after renames
- no generated output (`dist/`, `docs/`, `node_modules/`) is included in source zips or commits unless explicitly intended
- README / `docs-src/` / JSDoc still match the implementation

## Documentation map

- `README.md` — product and deployment overview
- `docs-src/architecture.md` — architecture and flow notes
- `docs-src/runtime-configuration.md` — runtime config and override rules
- `src/types/jsdoc-types.js` — shared JSDoc-only type aliases
