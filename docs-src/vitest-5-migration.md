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
specific: `^22.12.0 || ^24.0.0 || >=26.0.0`. jsdom 30 raises the floor to
`^22.22.2 || ^24.15.0 || >=26.0.0`, so the application's engine range is
`^22.22.2 || >=24.15.0`. Use Node 22.22.2+ in the 22.x line or 24.15+ for
development; Node 25 is excluded by Vitest and jsdom even though the
application's engine range allows it. CI uses Node 22.23.3.
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
`src/utils/__tests__/runtimeConfig.test.js`. (The header test has since moved
to `src/__tests__/webConfigHeaders.test.js`.) Additional searches checked mocking,
environment annotations, sequential options, asynchronous assertions, snapshots,
and deprecated imports. Literal document-loading strategy values named
`sequential` are application data and need no migration.

## Hub-machine worker-start investigation (2026-10-13/14)

The predecessor campaign `odv-vitest-workerstart-timeouter-lokalt` (pass
2026-10-13) settled the repository side: vitest 5.0.4 hardcodes
`START_TIMEOUT = 6e4` and `WORKER_START_TIMEOUT = 9e4` as module constants,
not configurable; `test.poolOptions` was removed in vitest 4; a bare numeric
`maxWorkers` REPLACES the default `availableParallelism() - 1`, so a committed
`maxWorkers: 8` would RAISE a 2-4 core CI runner from 1-3 workers to 8;
default parallelism was the FASTEST level measured (31-82 s against
178-296 s with one worker). This campaign turns to the hub,
`linus_hemma`, and asks whether the machine itself forces a different
worker-count cap.

### Hardware and environment, measured 2026-10-13/14

- 24 logical cores. `--isolate` is vitest's default, so vitest spawns one
  fork per test file (69); `maxWorkers` bounds concurrency, not the fork
  count. Default is 23 concurrent workers.
- Node 22.23.3 via fnm at
  `%APPDATA%\fnm\node-versions\v22.23.3\installation\`.
  The shell default is Node 25.6.0, which is outside vitest 5.0.4's and
  jsdom's own engines ranges (`^22.12.0 || ^24.0.0 || >=26.0.0`) while
  OpenDocViewer's `engines` (`^22.22.2 || >=24.15.0`) admits it. Use Node
  22.23.3 for local vitest; the shell default is not safe.
- Disk 0 = `AMD-RAID Array 1`, SSD on RAID, 3.0 TB, drives **C:** and
  **G:**. Disk 1 = `ST16000NM000J-2T` (Seagate Exos 16 TB, **7200 rpm
  spinning**), RAID, drive **E:**. The OpenDocViewer checkout
  (`<workspace>\OpenDocViewer`) is on the spinning disk; the AO per-job
  worktree root (`G:\wt`) is on the SSD.
- Bitdefender real-time protection is ON (`VSSERV`, `BDAppSrv`, `BDAuxSrv`,
  `BDProtSrv`, `bdredline`, `bdredline_agent`, `BDSafepaySrv` Running);
  Windows Defender real-time protection is OFF.
- The exclusion list cannot be read from a session through any standard
  API. What IS readable: `C:\Program Files\Bitdefender\Bitdefender
  Security\scheduler_VSSERV.xml` contains only two scheduled tasks,
  `quarAutoclean` and `exception_cleaner`. No scheduled scan is
  configured, so a scheduled-scan window is not available as an
  explanation. `exception_cleaner` last ran at epoch 1791932400 =
  2026-10-14 01:00:00 local.
- `bdservicehost` (pid 39492) has consumed ~89 040 s CPU (~24.7 CPU-hours)
  since it started on 2026-10-08 10:52, with a 1.86 GB working set -
  roughly 7 % of one core, continuously.
- Desktop heap `SharedSection=1024,40960,768` is the Windows default; all
  vitest workers are children of an interactive session and use the
  40 960 KB heap. ~656 processes, 454 934 handles, 6.06 GB paged pool,
  4.30 GB non-paged pool. Commit limit a flat 91 GB, committed 69-76 GB,
  available memory never below 16.9 GB.

### Per-worker startup on the hub, from vitest's own `Isolate N workers spawned`

| tree | drive | commit | config | n | Isolate X (s) | outcome |
|---|---|---|---|---|---|---|
| E: main checkout | spinning | e77fd385 | default | 5 | 3.23 / 3.48 / 8.77 / 7.63 / 4.68 (mean **5.56**) | 3 green, 2 red (assertion) |
| E: main checkout | spinning | e77fd385 | `--maxWorkers=1` | 5 | 1.70 / 1.74 / 1.63 / 1.65 (mean **1.68**, one missing) | 5 green |
| `G:\wt\pv-vitest-ssd` | SSD | e77fd385 | default | 5 | 5.15 / 6.98 / 3.46 / 4.03 / 3.40 (mean **4.60**) | 5 green |
| `G:\wt\pv-vitest-ssd` | SSD | e77fd385 | `--maxWorkers=1` | 5 | 1.52 / 1.51 / 1.95 / 1.83 / 1.24 | **3 RED (worker-start death)** |
| `G:\wt\pv-vitest-main` | SSD | 24f5c6d6 | `--maxWorkers=1` | 5 | 1.47 / 1.28 / 1.56 / 1.19 / 1.14 | 5 green |
| `G:\wt\pv-vitest-main` | SSD | 24f5c6d6 | default | 3 | 3.91 / 12.80 / 3.18 | 2 green, 1 red (assertion) |
| `G:\wt\pv-vitest-ssd` | SSD | e77fd385 | `--maxWorkers=1`, quiet volume | 5 | 1.12 / 1.13 / 1.28 / 1.29 (+1.22) | 5 green |
| `G:\wt\pv-vitest-ssd` | SSD | e77fd385 | `--maxWorkers=1`, forced disk-0 load | 5 | 1.36 / 1.53 / 1.25 / 1.25 / 1.35 | 5 green |

Compared with `linus_laptop` (1.74 s default / 0.33 s single worker): the
hub is ~2.6-3.2x slower per worker at default parallelism (mean 4.60 s on
SSD, 5.56 s on the spinning disk) and ~3.5-5.1x slower at one worker
(1.1-1.7 s against 0.33 s). Wall clock at default parallelism is 33-101 s
on the hub against the laptop's 16-19 s. The drive accounts for only
part of it: SSD 4.60 s against spinning 5.56 s at default, i.e. the
spinning disk costs about 20 % more per worker, while the gap to the
laptop is a factor of three.

### The three red classes, kept separate

A future reader must classify a red with one grep, so each class is named
with its exact error string.

1. **worker-start death** -
   `Caused by: Error: Worker exited unexpectedly with exit code 3221225794
   during starting state`. `3221225794 = 0xC0000142 =
   STATUS_DLL_INIT_FAILED` (verified against Microsoft's NTSTATUS list).
   Seen 3 times, all in the same configuration (`G:\wt\pv-vitest-ssd`,
   commit e77fd385, `--maxWorkers=1`), repeating 52 / 61 / 55 times within
   a run and aborting it after only 17 / 8 / 14 of 69 files, wall clock
   pinned at 113-114 s. All three had 2-4 AO jobs in progress, and so did
   two green runs in the same series, so the AO job count does not
   discriminate. Windows logged NOTHING: zero Application Error,
   Application Hang, SideBySide, WER and Bitdefender events in those
   windows.
2. **worker-start timeout** -
   `[vitest-pool]: Failed to start forks worker ... caused by
   [vitest-pool-runner]: Timeout waiting for worker to respond`, the
   predecessor campaign's symptom. **It did not occur once in this
   campaign's 38 full-suite runs.**
3. **assertion flake** -
   `expected "vi.fn()" to be called 1 times, but got 0 times` (and once
   `got 2 times`) in `src/components/__tests__/printPipeline.test.jsx` at
   lines 211, 286 and 306. Seen 3 times at default parallelism, on both
   e77fd385 and 24f5c6d6, on both drives. This is a repo-side test
   defect, independent of the worker-start question.

### What was excluded, each with the measurement that excluded it

- **Bitdefender DLL injection into a worker**: a fresh 60 s `node.exe`
  loaded 35 modules, zero of them matching
  `bd|bitdefender|atcuf|trufos|redline|safepay|avcbf`.
- **Desktop heap exhaustion**: default `SharedSection`, interactive heap,
  ~656 processes total.
- **Paged / non-paged pool and handle exhaustion**: 6.06 / 4.30 GB and
  454 934 handles, within defaults; no Resource-Exhaustion event on the
  test nights (the only 10 are from 2026-09-27).
- **Commit / memory pressure**: commit limit a flat 91 GB with 69-76 GB
  committed and never less than 16.9 GB available, across 9 instrumented
  runs.
- **Spawn rate and CPU pressure**: a standalone reproducer spawned
  2 400 bare `node.exe -e "process.exit(0)"` children, 300 per condition
  at concurrency 1 / 4 / 12 / 23, once with the AO queues verified empty
  and once under 12 CPU-spinning processes, with 0 failures at up to
  27.9 children/s.
- **Disk-0 I/O pressure alone**: 5 runs of the exact configuration that
  produced the 3 reds, with forced disk-0 queue length mean 1.4-4.7 and
  peaks 3.5-16.5 (the red runs had mean 0.9-2.7, peaks 4.4-16.4). All 5
  green.
- **A regression between e77fd385 and 24f5c6d6**: single-worker Isolate X
  is 1.14-1.56 s on origin/main against 1.24-1.95 s on e77fd385, within
  noise.
- **AO job count as a predictor**: reds at 2, 3 and 4 concurrent AO jobs;
  greens at 3 and 4.

### Decision: no environment-gated mechanism, no cap

Every worker-start death occurred at `--maxWorkers=1`; default
parallelism produced 0 worker-start failures in 13 runs across both
drives and both commits, and it is also the fastest level. A
`VITEST_MAX_WORKERS` value that lowered the worker count would therefore
point away from the only configuration that has never failed. Default
parallelism is therefore both the fastest and the only fault-free level
measured. No cap of any kind is committed.

The `test:` block in `vite.config.js` therefore keeps `maxWorkers`
unset, keeps `exclude` as `[...configDefaults.exclude, '_tools/**',
'dist/**', 'tests/ui/**']`, keeps `testTimeout: 120000` and `hookTimeout:
120000`. The existing measurement comment block above `test:` (from
commits 443d3edf and 4de8540c) is the source of truth on the repository
side and is not reworded.

### Reproducibility, stated honestly

- An idle series exists and it was clean. With AO jobs in progress
  across all instances verified to be 1 (the measuring job itself) or 0:
  5 of 5 green at `--maxWorkers=1` on origin/main, 3 of 3 at default on
  origin/main (one of those three red on the assertion flake, not
  worker-start), 5 of 5 green in the controlled quiet arm, and 1 200 of
  1 200 bare spawns. The worker-start death has never been observed with
  the machine verified quiet.
- The fault is not provokable. 0 of 10 further attempts reproduced it in
  the only configuration that ever showed it, which bounds the per-run
  rate in that configuration to <= 0.31 at 95 % (exact binomial).
  Across the campaign the triggering configuration is 3 red of 18
  (~17 %). No load threshold was found on any metric measured: CPU, disk
  queue on either disk, commit charge, available memory, spawn rate or
  AO job count.
- The process tree differs from the predecessor campaign. Every run in
  this campaign executed as a child of the AO Windows-service process
  tree; the predecessor campaign's reproductions ran in an interactive
  PowerShell under the user's session. The run counts on both sides are
  too small to bound a rate difference between them.

### What the measurement still cannot see

- The process-tree difference above.
- The binomial bound on a rarer failure (the campaign's run count cannot
  bound a rate below ~17 %).
- The unreadable Bitdefender exclusion list.
- The fact that a transient machine state which the campaign's metrics do
  not capture remains the leading explanation for three reds inside one
  30-minute window that has not recurred.

### Operator guidance

- Run the suite with Node 22.23.3 (the CI-pinned version), not the shell
  default 25.6.0. The shell default is outside vitest 5.0.4's and jsdom's
  own engines ranges, even though the application's `engines` admits it.
- Leave `maxWorkers` unset. Default parallelism is both the fastest and
  the only fault-free level measured on the hub. `--maxWorkers=1` lowers
  per-worker startup time but has been the only configuration to produce
  worker-start deaths.
- Read the process EXIT CODE, not the `Tests` line. `Errors` is counted
  separately and a worker-start death can leave the suite reporting
  `Tests` complete while the exit code is non-zero. See the comment
  block above `test:` in `vite.config.js` for the documented instance.
- An operator action list with antivirus-exclusion paths, the
  load-threshold measurement, and a list of what could NOT be verified
  is kept in the maintainers' private notes (not in this repository).

## Validation and rollback

Run `npm test`, `npm run lint`, `npm run build`, `npm run doc:agent`, and
`scripts/local-ci.ps1`. The local CI script checks build, tests, component versions,
and generated documentation; it does not run tests. GitHub CI independently
runs tests, lint, build, and JSDoc after a clean npm install.

Both the Vitest 4 baseline and Vitest 5 full local run passed 91 tests in five
files (exit 0). The local build output already contains a copied
`dist/__tests__/web-headers.test.js`, accounting for four duplicate header
checks; the tracked suite contains 87 tests in four files. That `dist/` copy is a
generated, git-ignored build artifact, not a fifth tracked file. This pre-existing
discovery behavior is unchanged by the migration (the later move of the header
test to `src/__tests__/` keeps it out of `dist/`, and Vitest now excludes `dist/**`). The Vitest 5 run used
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
