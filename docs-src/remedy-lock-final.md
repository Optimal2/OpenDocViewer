# Final bounded remedy-lock correction

Campaign: `odv-remedylaset-ingangs-och-utkanalen-ar-obedomda`.
Job: `20261016003844-64295f48`. Baseline: `ce449a76`.

The prerequisite performance/UTF-8 transport commit was cherry-picked as
`8f459b84` from `78bec153523ef0570f9f9cdbd8e1661d225f533d`, without amendment.
Its batching, exact-text cache, parser contracts and encoding fix are retained.
This correction changes test tooling only; `scripts/local-ci.ps1` is unchanged.

## Final dispositions

| Finding | Disposition |
| --- | --- |
| F1: deliberate scope/provider-qualified verdict stores | Rejected: defending deliberate `$script:`, `$private:` or `${variable:}` stores has no practical value under the agreed normal-agent-mistake model and no-exotic-hardening boundary. |
| F2: real echo moved before captures or after verdict/remedy | Fixed: output capture, exit capture, echo and gate-exit branch must occur in that relative order in their actual common statement block. |
| F3: boolean increment | No extra implementation: under the existing strict/error preferences boolean increment is a terminating error, so it fails closed; the latest header now explicitly describes assignment-only, unqualified-path coverage. |
| Early constant-zero exit or silent catch termination | Fixed: a whole-file scan of the already-built AST rejects numeric constant-zero exits outside the real final success branch, and return/break/continue anywhere inside a catch. |
| Deliberately appended fake Write-Host outside step 4 | Rejected as intentional spoofing: output outside the anchored step-4 region remains an explicitly unjudged channel. |

The success exception is the direct last `exit 0` in the then block of the
final `if ($overallSuccess)` statement of the top-level try containing the
step-4 banner. Existing catches that record a failed result and fall through
remain valid, as does the telemetry-warning catch and the outer `exit 1` catch.
There is no blanket rethrow requirement and no PowerShell interpreter.
The scan judges numeric constant expressions, not computed exit values.

The order check adds no adjacency requirement between the exit capture,
echo and verdict. The pre-existing immediate output/exit capture rule is
unchanged. Positive controls retain comments, reworded remedies, harmless
try/finally gaps, the real success exit and the current catch behavior.

## Reproduction and evidence

Run `node scripts/measure-remedy-lock-final.mjs` with Node 22.23.3 and
TEMP/TMP/TMPDIR set to registered job scratch. It reads the real production
source, creates fixtures using real AST statement extents, and executes only
the selected Vitest case against a temporary test-module copy. It never
edits the production script or the tracked validator. The copy is removed
in `finally`; raw logs stay in scratch. Public logs normalize local paths.

Each bad source runs through the existing real-source cause/remedy test and
must exit 1 with its named new refusal. Removing the corresponding guard
makes that same bad source exit 0. Separately, running the new regression
tests with the guard removed must exit 1 (missing expected exception),
proving that the regression assertions bind. Restoring the validator and
real source must exit 0. No full-suite mutation runs are needed.

See [proofs.json](evidence/remedy-lock-final/proofs.json) for native exits,
tested source/validator hashes and raw/public stdout+stderr hashes, alongside
the sanitized transcripts. Repository validation is recorded separately in
[validation.json](evidence/remedy-lock-final/validation.json).

Measured results (Node 22.23.3, default worker parallelism, unchanged timeouts):

| Check | Actual result |
| --- | --- |
| Seven real-source bad fixtures | Each native exit 1 with its named order/silent-termination reason |
| Order guard removed, same bad source | Native exit 0 |
| Silent-termination guard removed, same early-exit source | Native exit 0 |
| New regression group with each corresponding guard removed | Each native exit 1, missing expected exception |
| Restored real-source test plus three new test groups | Four passed, native exit 0 |
| `npm run lint` | Exit 0; one existing React Fast Refresh warning |
| `npm run build` | Exit 0; large-chunk advisory |
| `npm test` | 71 files / 2,614 tests passed, exit 0, 74.41 seconds |
| Strict component validator against `ce449a76` | Exit 0, including shared-script comparison |
| `npm run doc:agent` | Exit 0; no `docs-agent` diff |
| `node scripts/verify-agent-docs-fresh.mjs` | Exit 0 |
| JavaScript syntax checks and `git diff --check` | Exit 0 |

The full repository run includes all original 18 remedy-lock cases, three
new groups and all 17 parser contracts. [integrity.json](evidence/remedy-lock-final/integrity.json)
records byte-identical original test sections and hashes of the unchanged
performance/parser files, production script and version identities.
Raw private logs were scratch-only; sanitized evidence is the durable record.

## Deployment boundary

Check 13 of the strict component validator explicitly excludes this tooling
from web payload inputs; the measured strict check passed without a bump.
Component keys bumped: none. Repository/module/npm identities are unchanged.
No deployment, service restart, runtime activation, package build or package
refresh/import is needed. The parent owns independent final delta review,
public scan, push, all remote CI workflows and campaign closeout.
