# OpenDocViewer: GitHub AI findings, campaign `github-fynd-ai-forslag-alla-repon`

Base: `267b1e8fc804c72a95bd9fd202dd610ee77a5fbe` (`origin/main` at job start).

Scope: the `## OpenDocViewer` section of
`DEV/AI-Vaults/Projects/OMP-ODV/60-Reports/prep/2026-11-06-github-fynd-ai-forslag-alla-repon-wp0.md`,
which lists six AI findings in five files. The list is a set of hypotheses from a scan, not
instructions. Each hypothesis was re-tested against the current source in this repository; the
disposition below records what the code actually does now.

Nothing was dismissed on GitHub and no analyzer suppression was added.

## Per-finding dispositions

| # | Finding | File | Disposition |
| --- | --- | --- | --- |
| 1 | Restoring a source with `writeFileSync` changes its mtime, so a successful mutation run does not fully restore the original file state. | `scripts/test-signature-security-mutations.mjs` | **Fixed in `0f8ea9f` ("Preserve source timestamps after security mutations").** The runner now captures `atime`/`mtime` per mutated file and restores both with `utimesSync` after the write (`scripts/test-signature-security-mutations.mjs:154`). Verified in the current source: `utimesSync` is imported and called on the recorded timestamps. |
| 2 | The restoration assertion deliberately drops the `mtime` captured by `snapshot`, so it does not detect that the CLI's restore writes change source timestamps. | `scripts/test-signature-security-mutations.test.mjs` | **Fixed in `e7fbb75` ("Test complete mutation source restoration").** `snapshot()` now records `mtime: statSync(join(root, file)).mtimeMs` alongside the content (`scripts/test-signature-security-mutations.test.mjs:22`) and the assertions compare the complete snapshot (`expect(snapshot(root)).toEqual(before)`). Verified in the current source. |
| 3 | Relative URLs in `srcset` are not rewritten, so responsive `<img srcset>` and `<source srcset>` assets resolve relative to the viewer page instead of `resolvedUrl`. | `src/components/DocumentToolbar/ManualOverlayDialog.jsx` | **Fixed in `b126012` ("Rewrite manual srcset URLs and trap dialog focus").** `rewriteManualSrcset` rewrites each candidate and keeps its width or density descriptor, and the sanitized tree's `[srcset]` nodes are rewritten against `resolvedUrl` (`src/components/DocumentToolbar/ManualOverlayDialog.jsx:155`, `:245`). Pinned by the unit test *"rewrites responsive srcset candidates against the resolved manual URL"*. Verified in the current source. |
| 4 | The manual dialog does not contain keyboard focus; after tabbing through the dialog controls, focus can move to controls behind the backdrop even though `aria-modal` declares the rest of the page unavailable. | `src/components/DocumentToolbar/ManualOverlayDialog.jsx` | **Fixed in two steps. (a)** `b126012` added the focus trap; `d4bb6af` ("Honor sequential focus order in manual dialog") made the trap follow browser eligibility and sequential order, and `b5c22fe` ("Honor inherited disabled state in manual focus trap") made it honor inherited disabled state. **(b)** The baseline trap still skipped every native stop *inside* a controlled `<audio>`/`<video>`: the host element was one focusable entry, so Tab left the media's own UA controls behind the backdrop. This job's accepted patch (`odv-native-media-focus.patch`, SHA-256 `c5511a478bc1a2eeb90698354e439da62c7a8a33ca63482b9c57b3f072083594`) adds controlled media to the eligible sequence (`MANUAL_MEDIA_SELECTOR`) and hands the browser's own media focus scope back to the UA, so the eleven native stops the baseline skipped are now reachable. The evidence is below. |
| 5 | The site-config-generator escaping helper is described as matching the escaped value literally, but the generated expression is unanchored and also matches the escaped value as a substring of a longer string. | `tools/site-config-generator/test-fixture-escaping.mjs` | **Fixed in `db35590` ("Correct regular expression escaping contract").** The helper's own contract comment now states that the result is the source of an *unanchored* pattern that matches the value literally *wherever it occurs in the searched string*, and that `^` and `$` must be added when whole-string matching is intended (`tools/site-config-generator/test-fixture-escaping.mjs:27`). The behaviour itself was always correct; only the description overstated it. Verified in the current source. |
| 6 | The escaping test interpolates the escaped value at runtime, after the template literal has already been parsed, so it does not cover the stated source-generation scenario with backticks and interpolation markers. | `tools/site-config-generator/test-fixture-escaping.test.mjs` | **Fixed by correction in `1ba2a53` ("Clarify runtime template interpolation coverage").** The suites really do interpolate at runtime and never generate JavaScript source, so the original finding overstated the coverage that was needed. The test and its comment now say exactly that (`tools/site-config-generator/test-fixture-escaping.test.mjs:71`). The values under test include `` 'template ${interpolation}' ``, so the escaping of the interpolation marker itself is covered. Verified in the current source. |

Findings 1, 2, 3, 5 and 6 were already closed by earlier phases of this campaign; this job
re-verified each one against the current source instead of trusting the campaign log. Finding 4
was the only one still open, and it is the one this job implemented.

## The media focus finding: RED and GREEN, measured natively in Chromium

The accepted proposal is the three-file patch
`odv-native-media-focus.patch` (SHA-256 `c5511a478bc1a2eeb90698354e439da62c7a8a33ca63482b9c57b3f072083594`)
plus the five-byte test-fixture delta
`odv-fixture-loop.delta.patch` (SHA-256 `c7544f5eb895a3c4f127c882df7513866c4c632a1dd7913aa3052bd9711d6ef7`).
Both hashes were recomputed from disk before use and both matched. Both patches were produced
against `d156dbc3a7597fe0b4d6c526ba1df2dbe8e10b90`; `origin/main` had moved to `267b1e8`, so
`git apply --check` was run first. The media focus patch applied cleanly (exit 0), and the
fixture delta applied cleanly against the already-patched spec (exit 0).

The fixture delta is a test-fixture change only: it adds the `loop` attribute to the synthetic
audio element in `tests/ui/manual-contents-tree.spec.mjs`. Without it the two-second WAV reaches
its natural end between the play and the pause, so the second Space never has a running clip to
pause and the "paused" assertion can pass without the pause ever having happened. With `loop` the
clip stays in the intended playback interval, so the existing strict play/pause checks measure the
action they claim to measure. No assertion, retry, timeout or tolerance was changed.

### RED on the unchanged product

The product file `src/components/DocumentToolbar/ManualOverlayDialog.jsx` was reverted to its
`267b1e8` content while the two test files kept the new tests. The same Node 22.23.3, the same
Playwright 1.64.1 and the same pinned Chromium build were used for both stages.

| Stage | Command | Exit | Result |
| --- | --- | ---: | --- |
| Unit RED | `npx vitest run src/components/DocumentToolbar/__tests__/ManualOverlayDialog.contents.test.js` | 1 | **1 failed, 36 passed (37 total)** |
| Native RED | `npx playwright test tests/ui/manual-contents-tree.spec.mjs --grep "native media controls"` | 1 | **4 failed** (default, positive-last, positive-first, positive-reversed) |

The unit failure is the intended causal assertion, not a setup error:

```
FAIL ManualOverlayDialog contents tree > retains supported media controls and leaves their internal Tab navigation native
AssertionError: expected true to be false // Object.is equality
  expect(event.defaultPrevented).toBe(false);
```

The baseline trap cancels every Tab it handles, so `defaultPrevented` was `true`.

The native failures are focus-state mismatches against the same product-sanitized fixture, with the
media host's own UA controls missing from the reachable sequence. The baseline reached the audio
host and the video host as single stops (`role: "Audio"`, `role: "Video"`), and the expected
native control (`role: "button", name: "play"`) was absent, and in the default ordering the focus
had already moved past the media to the *after media* link:

```
- Expected  - 3          + Received  + 3
  "focused": [ { "name": "play", "role": "button" } ]
- "id": "manual-audio"   + "id": "manual-video"
```

That is the eleven native stops the baseline skipped: the play button, the volume slider, the mute
button, the time scrubber, the "show more media controls" button, and the video's full-screen
button.

### GREEN with the patch

The product file was restored to the patched content and the identical commands were rerun.

| Stage | Command | Exit | Result |
| --- | --- | ---: | --- |
| Unit GREEN | `npx vitest run src/components/DocumentToolbar/__tests__/ManualOverlayDialog.contents.test.js` | 0 | **37 passed (37)** |
| Native GREEN | `npx playwright test tests/ui/manual-contents-tree.spec.mjs --grep "native media controls"` | 0 | **4 passed (41.1 s)** |

The only variable between the RED and the GREEN stage is the product source: the two test files
are byte-identical across both stages. The native GREEN run compares the product's real focus
sequence against an oracle built from the very same product-sanitized fixture served to a
separate, application-handler-free page, in both directions, and asserts that focus stays inside
the dialog and that no transient starting point is left behind.

## Native status and its limits

The GREEN result above is a native Chromium measurement, not a jsdom inference. The unit test
itself says so: jsdom has no UA media controls and no native Tab default, so it can only prove
that the trap does not cancel the Tab. The eleven native stops are proven by the Playwright run
against the real browser engine.

What the native evidence does **not** cover, and what is therefore not claimed:

- **Other browser engines.** Only Chromium was measured. The product's declared target is
  Chromium-based desktop browsers (`docs-src/deploy-ops.md`), and no Firefox or Safari run was
  made. The degradation path on a non-Chromium engine (the browser's default Tab from the
  temporary starting point does not reach the media host) is self-healing: focus falls to the
  body and the next Tab is caught by the dialog's outside branch, which prevents the default and
  moves focus back inside. No document leak was observed in any measured case.
- **Screen readers and visual acceptance.** Not tested.
- **A positive tabindex outside the dialog.** The measured trap hands the media's focus scope to
  the browser when a media host is adjacent to another media host in the eligible sequence. That
  is safe for the surfaces this repository controls: `src/` contains no positive tabindex, and the
  manual's own positive indices are inside the dialog and are covered by the native tests. A host
  page that placed a positive tabindex between two media hosts inside the manual content would be
  a different contract, and no such contract is supported here.
- **Linux and CI.** The native runs above are Windows-local. The GitHub workflow runs are
  reported separately in the job output.

## Findings that would need a GitHub dismissal

None. Every hypothesis in this repository's WP0 section is either fixed in the current source or
fixed by this job's patch, so no finding needs to be dismissed on GitHub. No dismissal was made.

## Related canonical sync

`scripts/omp/bump-version.ps1` was replaced with the byte-identical canonical copy from
OpenModulePlatform `5e1c43c49c2541982f9ddab9e5a5f60fbd0bb07a`
(blob `fa3100dd0627df3ec3e1c4563e49193b55f8655d`). The working-tree bytes and the staged blob
both equal the canonical blob, and the repository's own Check 15 reports
`'scripts/omp/bump-version.ps1' matches the canonical copy (74d25218fb10df07)`. OpenDocViewer
has no Razor generator, so the `build/DeterministicRazor/*` shared build files do not apply here
and are not present.
