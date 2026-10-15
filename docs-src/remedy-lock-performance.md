# Step-4 remedy lock parser performance

Job: `20261015235114-030970b4`. Baseline:
`ce449a76f8cc1573657f6fb5a77f2981591cae98` (phase 16).
This change only batches calls to PowerShell's real AST parser and caches
results by exact source text for one test-process parser instance. It does
not change the allowlist, case arrays, assertions, expected refusal reasons,
`local-ci.ps1`, workflows, releases or runtime payloads.

## Measured result

Both runs used Node **22.23.3**, Vitest **5.0.4**, PowerShell **7.6.6**, the same
worktree and default Vitest worker settings. No `maxWorkers` override was used.
Dependencies were restored into the job worktree before timing. No other
tests or builds were started by this job during either timed interval.
Other workstation activity was uncontrolled; this is one measured pair,
not an estimate of run-to-run variance.

| Measurement | Before | After |
| --- | ---: | ---: |
| Full original suite | 18/18 pass | 18/18 pass |
| Process exit | 0 | 0 |
| Wall time, including startup and capture I/O | 325.637 s | 73.505 s |
| Observed parser process calls | 204 | 34 |
| Parsed source inputs, including repetitions | 204 | 201 |
| Distinct source inputs | 201 | 201 |

Observed wall-time reduction: **77.4% (4.43 times faster)**. Parser process
calls fell by **83.3%**. Three repeated parses became cache hits. Every
original distinct input was still parsed, with no extra or missing inputs
and no AST differences. Capture instrumentation was present in both runs
and did not alter parser return values.

The identical command shape was:

```text
node scripts/benchmark-step4-ast.mjs <before-or-after> <registered-scratch>
```

It launches `node node_modules/vitest/vitest.mjs run
scripts/local-ci-agent-docs-output.test.mjs`. Set `PATH` to the pinned Node
installation and `TEMP`, `TMP`, `TMPDIR` to registered job scratch first.
Each label must use a fresh capture directory. Logs and measured JSON are
in [the evidence directory](evidence/remedy-lock-performance/).

## Parser contract

`parse-local-ci-ast.ps1 -Path <file>` retains its single-file JSON API.
`-ManifestPath <json-file>` accepts an array of 1-16 source paths and
returns `{ paths, results }` in manifest order. The serializer is shared
between both modes. Every parse creates a fresh node ID generator; node
order, extent offsets/text, parent IDs, scalar fields and parse errors are
preserved. Source files are parsed, never executed.

`parse-local-ci-ast.mjs` prewarms the existing mutation arrays in groups of
at most 16. Remaining individual calls use `-Path`. A `Map` keyed by the
unaltered source string belongs to one parser instance. No disk cache,
service or persistent parser is introduced. Temporary files are removed
in `finally` on success and failure.

The caller validates manifest path order, result count and result shape
before caching any entry in a group. Existing parser absence, launch,
exit, invalid JSON and 64 MiB `maxBuffer` refusals remain fail-closed.
Only `ENOENT` permits trying the fallback interpreter. Parse errors remain
in the response and the unchanged `buildTree` check refuses them.
Oversized batch output is refused; it is not treated as a missing parser.

## Equivalence proof

The baseline observer saved exact source text and the old single-file
parser's JSON for every distinct input. Five additional inputs were then
captured with the unchanged baseline parser: empty source, Unicode/CRLF,
and three malformed scripts. All **206** inputs were parsed in **13**
new batch invocations and compared with deep equality against those old
results: **zero differences**. The aggregate SHA-256 of sorted source/AST
hash pairs is identical for baseline and batch:

```text
68a9655ba1d5abd18273af28f87e377f67b805504c7957352dfbc96bf0dd04f6
```

[corpus.json](evidence/remedy-lock-performance/corpus.json) preserves every
exact source, source hash, canonical AST hash, node count and error count.
The complete captured baseline script is referenced as a plain `.ps1`
evidence file so JSON-escaped local path separators do not resemble UNC
shares to public-content scanners; its exact source hash is unchanged.
[equivalence.json](evidence/remedy-lock-performance/equivalence.json) records
the counts and aggregate hashes. Recheck the new parser against that corpus:

```text
node scripts/benchmark-step4-ast.mjs verify <registered-scratch>
```

[suite-equivalence.json](evidence/remedy-lock-performance/suite-equivalence.json)
also verifies that both timed runs parsed the same 201 distinct inputs with
the same AST hashes. Removing only the new prewarm lines makes the entire
validator/test tail byte-identical to ce449, including every case,
assertion and expected reason (SHA-256
`261cf53226d8125dfe5d9e88e180cc0ce8ac2d60115e7c014fd16deb0c3399bc`).

## Focused refusal controls

The additional parser contract suite has **16 passing tests**, exit **0**.
It includes real single-file versus batch comparisons for valid, malformed
and missing source files, invalid manifests, bounded grouping, cleanup,
fallback selection, atomic cache population and exact-text cache keys.

Nine isolated handling mutations were each tested with a focused Vitest
name filter. Each mutation was restored before its matching GREEN run.
The original 18-test suite was not rerun for these mutants.

| Handling removed or broken | RED exit | Restored GREEN exit |
| --- | ---: | ---: |
| Missing-interpreter handling | 1 | 0 |
| Named maxBuffer refusal | 1 | 0 |
| Launch-failure handling | 1 | 0 |
| Process-exit check | 1 | 0 |
| Invalid-JSON propagation | 1 | 0 |
| Batch result cardinality | 1 | 0 |
| Batch path ordering | 1 | 0 |
| AST response validation | 1 | 0 |
| Exact cache keys (mutated to trim whitespace) | 1 | 0 |

The process-error controls inject subprocess responses at the spawn
boundary; they do not remove the installed interpreter or allocate a real
64 MiB overflow. Per-control mutation descriptions, exits and sanitized
RED/GREEN transcripts are retained alongside
[red-green.json](evidence/remedy-lock-performance/red-green.json).

## Integration boundary

This is repository test tooling, excluded from the deployable web payload
by the strict validator's Check 13. The baseline strict validator passed;
no component, repository, module-definition or npm release version bump
is required. No runtime activation or package refresh/import is needed.
The strict validator also passed after the changes against the same ce449
baseline. `npm run doc:agent` completed with no generated diff, and
`verify-agent-docs-fresh.mjs` returned 0. All changed JavaScript files passed
`node --check`; the changed PowerShell helper parsed with no errors.
See [validation.json](evidence/remedy-lock-performance/validation.json).
This job commits locally; its parent owns push and independent final review.
These results make no claim about the unrelated full repository suite, SQL
validation beyond the measured version validator, or remote CI.

## Integration verification: JSON output encoding

The independent review reproduced all 201 actual suite sources identically,
but a Unicode/CRLF control exposed an older inherited-console encoding issue
on both the baseline and this delta. The parent independently verified all
206 stored hashes in its ordinary UTF-8 environment, then forced a legacy
CP1252 console in a real child process: the new exact-source assertion failed
with replacement characters (native exit 1). The parser now explicitly emits
UTF-8 JSON, matching Node's decoder. Both single and batch paths preserve the
exact Unicode source and scalar value in that real legacy-console test.
All 17 parser contracts then passed, native exit 0. This is a small transport
correction, not a batching semantic difference or a weaker AST comparison.
The original before/after timings remain the dated worker measurements;
the parent does not relabel them as measurements after this encoding fix.
See `encoding-red.log`, `encoding-green.log` and
`parent-encoding-proof.json` in the evidence directory. Raw-log hashes are
retained; public copies normalize local paths and trailing whitespace.
