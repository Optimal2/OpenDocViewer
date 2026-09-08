# Vitest 5 migration

Measured on 2026-09-08 before the dependency change: `package.json` declared
`vitest: ^4.1.11`; `package-lock.json` resolved `vitest` and seven `@vitest/*`
packages to `4.1.11`. The target is `^5.0.0`, resolved to `5.0.0` by npm.
Only Vitest and its required dependency graph are updated.

## Compatibility review

Sources reviewed: the [Vitest 5 migration guide](https://vitest.dev/guide/migration/),
[5.0.0 changelog](https://github.com/vitest-dev/vitest/releases/tag/v5.0.0),
and `npm view vitest@5.0.0 engines peerDependencies --json`.

Vitest requires Vite 6.4+ and Node 22.12+. Its published Node range is more
specific: `^22.12.0 || ^24.0.0 || >=26.0.0`. Use Node 22.18+ in the 22.x line
or a supported 24.x release for development; Node 25 is excluded even though
the application's existing engine range allows it. CI uses Node 22.18.0.
The existing Vite 8.2.2 satisfies the peer requirement.

| Breaking change | Repository assessment |
| --- | --- |
| Hoisted mocking must be top-level; mocks clear before each test. | No mocking API usage in the tracked tests. |
| Sequential APIs are removed; use `concurrent: false`. | No sequential test APIs or options. |
| Async assertions require awaiting; polling timeouts and empty-string throws change. | No affected assertions. |
| Parent-directory config discovery is removed. | npm runs from the root containing `vite.config.js`. |
| DOM global writes propagate to the environment window. | Default Node environment; no jsdom or happy-dom dependency or annotation. |
| Internal packages are bundled and deprecated entrypoints removed. | Tests import `vitest`; config imports `vitest/config`. |
| Projects, benchmarks, browser matching, reports, coverage and worker IDs change. | None configured or consumed here. |

`vite.config.js` keeps `configDefaults.exclude` plus `_tools/**`. No separate
Vitest config exists. Globals are not enabled: each test explicitly imports
`describe`, `it`, `expect`, and any lifecycle hooks. The synthetic
`globalThis.window` in `runtimeConfig.test.js` is restored by `afterEach` and
does not use a DOM environment. No test or config migration is necessary.

## Reproducible preflight

```powershell
git ls-files '*.test.*' '*.spec.*'
git grep -n -E 'vi\.(mock|hoisted)|test\.sequential' -- '*test*' '*spec*'
```

The search returned no matches (git grep exit 1). Four tracked test files were
checked: `public/__tests__/web-headers.test.js`,
`src/logging/__tests__/systemLogger.test.js`,
`src/utils/__tests__/documentLoadingConfig.test.js`, and
`src/utils/__tests__/runtimeConfig.test.js`. Additional searches checked mocking,
environment annotations, sequential options, asynchronous assertions, snapshots,
and deprecated imports. Literal document-loading strategy values named
`sequential` are application data and need no migration.

## Validation and rollback

Run `npm test`, `npm run lint`, `npm run build`, `npm run doc:agent`, and
`scripts/local-ci.ps1`. The local CI script checks build, component versions,
and generated documentation; it does not run tests. GitHub CI independently
runs tests, lint, build, and JSDoc after a clean npm install.

Both the Vitest 4 baseline and Vitest 5 full local run passed 91 tests in five
files (exit 0). The local build output already contains a copied
`dist/__tests__/web-headers.test.js`, accounting for four duplicate header
checks; the tracked suite contains 87 tests in four files. This pre-existing
discovery behavior is unchanged by the migration. The Vitest 5 run used
Node 24.20.0; Node 25.6.0 was used for the baseline.
The explicit tracked-suite run (`npm test -- src public`) also passed all
87 tests in four files (exit 0). Lint, the full production build, and the local
CI gate passed (exit 0), including component validation and regenerated agent
documentation freshness. The three changed agent-map files are included.

The component manifest guard treats package files as web artifact inputs:
`opendocviewer-web` moves from `2.4.71` to `2.4.72`, and `repositoryVersion`
from `2.4.82` to `2.4.83`. The bump helper also raises the module definition's
compatible artifact maximum to `2.4.72`, and therefore its definition version
from `2.0.29` to `2.0.30` in both files. The component's minimum definition
stays `2.0.28`; no SQL contract changes. Application version `2.7.1` stays
unchanged. No release tag or runtime activation is required.
Revert the single migration commit to roll back the complete dependency change,
then restore dependencies with npm.
