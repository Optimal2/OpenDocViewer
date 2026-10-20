# Lockstep workflow: reject a silent validator

The CI lockstep step resets `$global:LASTEXITCODE` to `$null` immediately before
calling the validator and throws `Lockstep validator did not report an exit code`
if the value remains null immediately afterwards. This covers both base-selection
branches without changing the validator or the local CI gate.

## Measurement method

The pre-change source pin was `02c01d7f19553656311b5dc71a4c0420c63c2f65`.
The runner form matters: a PowerShell Actions step prepends
`$ErrorActionPreference = 'stop'` and appends
`if ((Test-Path -LiteralPath variable:\LASTEXITCODE)) { exit $LASTEXITCODE }`.
A missing script or parse error already fails in this form; an empty file does not.

`scripts/lockstep-workflow.test.mjs` extracts the actual named step's literal
`run: |` block, bounded by YAML indentation, and builds that three-part script.
Each case starts a fresh `pwsh -Command` process which dot-sources the step
directly at command scope. The small PowerShell helper only seeds the caller's
exit-code state. Using a wrapper script launched with `-File` would give different
exit propagation; an `exit 1` control case catches that measurement error.

The fixture copies the real validator, its helper, and the tracked manifest,
package and SQL inputs into a disposable local repository inside the current
checkout. Both `git cat-file` (push) and `git fetch` (PR) are
real native calls; the fetch remote is the fixture itself, never a network host.
Every case runs on both `push` and `pull_request`, starting with either an
undefined `LASTEXITCODE` or stale zero. The normal and restored cases use the
repository's real validator and check its actual success output and process exit.

The fixture mirrors CI's existing `OMP_ALLOW_MISSING_PLATFORM=1` exception and
removes inherited platform-root variables case-insensitively on Windows.
Check 15 is explicitly NOT VERIFIED there. Its base commit equals fixture HEAD,
so diff-based checks see an empty diff. This tests workflow invocation and exit
propagation; separate strict validation checks the actual change against its base.

## Measured results

The five required baseline cases were measured and reported before the workflow
was edited. Each result below was identical for both events and both initial states.

| Validator | Before | Hardened |
| --- | ---: | ---: |
| Real validator | 0 | 0 |
| Missing | 1 | 1 |
| Directory at the script path | 1 | 1 |
| Syntax error (`param(`) | 1 | 1 |
| Empty file (zero bytes) | 0 | 1, named failure |
| Comment-only no-op | 0 | 1, named failure |
| Real validator restored after empty/no-op | 0 (normal case) | 0 |
| Explicit `exit 1` control | 1 | 1 |

Transcripts include native process exit codes and stdout followed by stderr,
with absolute fixture paths replaced by `<fixture>` and line endings normalized
to LF for storage:

- [Baseline](evidence/empty-validator/baseline.txt): 36 executions; matrix exit 0.
- [Hardened](evidence/empty-validator/hardened.txt): 44 executions; matrix exit 0.
- [Guard removed](evidence/empty-validator/guard-removed.txt): the extracted body
  has only the new guard removed. Empty/no-op return 0 again on both events and
  both initial states, causing the regression command to exit 1 (RED).

The hardened and mutation transcripts also include their complete extracted
runner script. The mutation changes only fixture content, not the source workflow.
The regular Vitest suite runs the hardened matrix again to prove that matrix
GREEN after RED. This does not imply that unrelated suites passed; see the
[validation record](evidence/empty-validator/validation.md).

To reproduce from the repository root (use the CI-pinned Node version):

```powershell
node scripts/lockstep-workflow.test.mjs
node scripts/lockstep-workflow.test.mjs --remove-guard
# Expected exits: 0, then 1. Restore/GREEN:
node scripts/lockstep-workflow.test.mjs
```

`--baseline --remove-guard` reproduces the old expectations. Optional
`--evidence <repo-relative-path>` writes the complete transcript inside this checkout.
Fixture processes have 60-second bounds, and fixture directories are removed in
`finally` with bounded retries for Windows file locks. Fixtures live under the
already excluded `_tools/` directory so failed cleanup cannot add copied test
files to a later Vitest scan. The Vitest case declares a five-minute timeout.

## Measured limits

This is a completion-code check, not content validation. The following deliberately
limited validators still returned 0 in all four hardened event/state combinations:

- A script containing only `exit 0`.
- A script containing only `git --version`: a native command sets `LASTEXITCODE`
  even though no version validation happens.
- The real validator with only its final `exit 0` removed: its internal native
  calls already leave an exit code. Exit truncation is therefore not universally
  detected by this guard.

These cases are retained as measured limitations, not represented as rejection
guarantees. The test covers the push-before and PR-base paths on local Windows
PowerShell 7; it does not measure fallback base paths or the hosted Linux runner.

## Version scope

These numbers are historical: they record the bump made with this change, as
reported by the repository bump helper, not the current versions (see
`omp-components.json` and `package.json` for those). The repository bump helper
updated repository `2.4.204` to `2.4.205`, component
`opendocviewer-web` `2.4.193` to `2.4.194`, and module definition `opendocviewer`
`2.0.151` to `2.0.152` in both physical copies. It also raised the compatible
artifact maximum to `2.4.194` and the component's minimum definition to `2.0.152`.
SQL bytes and their embed were unchanged. The npm product version remained `2.10.0`.

## Parent integration: deterministic printing test synchronization

The worker's two clean full runs exposed failures in the unchanged printing
tests; a focused rerun passed. These observations do not prove a production
printing defect. The test helper slept for 120 real milliseconds to cover a
30 ms submit timer and a nested 50 ms PDF timer. When the event loop is busy,
both the outer timer and the sleep can become ready before the nested timer
has even been scheduled. A longer fixed sleep would retain this assumption.

The integration changes only `printPipeline.test.jsx`: fake timers are scoped
to each test, `flushPrint` drains timers and their promise continuations inside
React `act`, and cleanup restores real timers. All 13 original behavioral
tests and assertions remain. No printing implementation, delay, timeout or
expected call count changed. Removing the asynchronous timer drain makes the
existing generated-PDF assertion fail (native exit 1, expected handler call
absent); byte-identical restoration passes all 13 tests (native exit 0).
The exact mutation/restoration hashes and raw-output hashes are recorded in
`evidence/empty-validator/print-timer-proof.json` with the focused transcripts.

The earlier validation table remains the worker's historical RED record;
final combined validation and independent review are recorded by the parent
against the final committed source. An initial parent setup attempt ran before
dependency copying finished and executed no tests; it is excluded from the
RED/GREEN and acceptance evidence.
