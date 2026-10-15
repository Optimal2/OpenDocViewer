# Validation record

Base source: `02c01d7f19553656311b5dc71a4c0420c63c2f65`.
Hardened workflow blob: `4d0a10c2d37e894d6d157a309f2a895703d2b5a8`.
All Node-based test runs used Node 22.23.3, with Vitest default parallelism.
No source changes were made to the printing code or its tests.

| Check | Actual process exit | Result |
| --- | ---: | --- |
| Extracted workflow, baseline | 0 | 36 native process executions, both events and both initial exit-code states |
| Extracted workflow, hardened | 0 | 44 native process executions, including restored normal validator and measured limits |
| Extracted workflow, guard removed | 1 | Expected RED: empty/no-op returned 0 in every event/state combination |
| Focused lockstep Vitest case | 0 | Matrix GREEN after the fixture environment fix |
| `npm run build` | 0 | Production bundle built; chunk-size warning only |
| PowerShell helper parser | 0 | No parse errors |
| Strict component validator against the base | 0 | Check 15 compared both shared scripts with the actual local canonical checkout; both matched |
| `npm run doc:agent` | 0 | 148 source files indexed; no generated documentation diff |
| `node scripts/verify-agent-docs-fresh.mjs` | 0 | Working tree, index and HEAD agree |
| Focused `printPipeline.test.jsx` rerun | 0 | 13/13 passed |
| Final `npm test` | 1 | 71 files passed, 1 failed; 2613 tests passed, 2 failed, 2615 total |

The final full suite passed the new lockstep matrix but failed two existing
printing assertions: `printPipeline.test.jsx:211` (generated comparison PDF)
and `:306` (curtain PDF log row), each expecting a mocked handler to have been
called once but observing zero calls. The preceding clean full run failed only
the first assertion (2614 passed, 1 failed). The focused printing rerun passed
all 13 tests. `flushPrint()` uses a fixed 120 ms wait; timing sensitivity is a
hypothesis, not a proven cause. The full suite is RED, not green by aggregation
of separate runs. Hosted CI is left to the parent integrator.

Earlier fixture validation exposed Windows cleanup locking and inherited
platform-root environment aliases. The final harness uses only the required
real inputs, removes platform-root aliases case-insensitively, retries cleanup
for a bounded interval, and places fixtures under the already excluded
`_tools/` root. A leftover full-copy fixture was moved to registered scratch;
an intervening scan that discovered its copied Playwright specs was invalid and
is not counted as a clean suite run. The initial full run also reported 12
worker-start errors. Neither final clean full run reported worker-start errors.

No package, release, tag, deployment, customer probe or remote push was performed.
