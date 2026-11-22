# Codex Development Guide

This guide is the compact, agent-friendly entry point for OpenDocViewer development with Codex 5.5+ from VS Code. Keep it factual and current. Put detailed architecture, integration, and deployment context in the linked documents, not here.

## Repository Role

OpenDocViewer is a generic browser-based document viewer for PDF, TIFF, and raster image files. It can be used standalone, embedded, or started by a host application through a normalized Portable Document Bundle.

OpenDocViewer should stay host-neutral. Manual-review behavior belongs in the host integration contract and in host application code unless a generic viewer capability is missing.

Use these files as the main map:

- `docs-agent/AGENT_CONTEXT.md` - generated AI-agent entry point. Read this first when available.
- `docs-agent/MODULES.md` - generated module grouping and high-signal files.
- `docs-agent/ENTRYPOINTS.md` - generated package scripts, runtime entrypoints, and import hubs.
- `docs-agent/DEPENDENCIES.md` - generated package usage surface.
- `AGENTS.md` - operational rules for Codex and other coding agents.
- `README.md` - product overview, setup, deployment, and documentation map.
- `CONTRIBUTING.md` - repository conventions and review checklist.
- `docs-src/architecture.md` - the architecture description: components, runtime flows, data, integrations, configuration, security, build/deployment, operations and trade-offs.
- `docs-src/integrations.md` - host integration contract for files, metadata, and bootstrap modes.
- `docs-src/runtime-configuration.md` - runtime config loading order, override rules, and deployment notes.
- `docs-src/deploy-ops.md` - IIS hosting, proxy deployment, cache rules, and operational checklists.
- `docs-src/log-servers.md` - optional logging endpoint contracts and security assumptions.
- `docs-src/omp-component-manifest.md` - OMP artifact component manifest and version-bump helper usage.
- `docs-src/printing.md` - print pipeline design and module boundaries.
- `docs-src/pdf-signatures.md` - level-1 PDF signature inspection: formats, integrity rules, data contract, worker offload, fixtures.
- `docs-src/compare-transform.md` - compare view per-page transform (stepless zoom, free pan, 0.1° rotation): state shape, context API, rendering; overlay view (stacked pages, opacity, calibration); curtain view (draggable border, clip-path).
- `docs-src/help-manuals.md` - the bundled manual in `public/help/default/`: generated copies of a private source, the build chain, the file name pattern, never hand-edited.

## Language and Documentation Policy

- Write code, comments, scripts, and development documentation in English.
- Use Swedish only in application localization and help resources under `public/locales/` and `public/help/`.
- Prefer short Markdown sections with stable headings, concrete paths, and runnable commands.
- Keep AI-facing instructions in `AGENTS.md` and this file; avoid duplicating rules across many READMEs.
- Keep the integration contract in `docs-src/integrations.md` aligned with `src/integrations/*` and `src/schemas/portableBundle.js`.

## Safe Change Workflow

1. Inspect files before editing. Do not infer payload schemas, runtime config keys, routes, or deployment behavior from names alone.
2. Keep changes scoped to OpenDocViewer unless the task explicitly requires matching host or platform changes outside this repository.
3. Preserve the viewer/host boundary: ODV renders documents; host applications own permissions, workflow state, and business commands.
4. Update docs when bootstrap behavior, bundle shape, runtime config, deployment, or public integration guidance changes.
5. Run the narrowest useful validation.
6. If the user needs to see the change in a hosted runtime, build and deploy the updated static bundle using the matching local workflow.

## Validation Ladder

Use the narrowest level that gives real confidence:

- JavaScript or React changes: `npm run lint`
- Bundling/runtime import changes: `npm run build`
- Viewer UI behaviour that needs real layout or CSS (placement, hover, focus): `npm run test:ui` (Playwright, `tests/ui/`; the first run needs `npx playwright install chromium`). CI runs it after the build. A Vitest run in jsdom cannot prove browser-owned behaviour — UA media controls, native Tab order, real layout and CSS visibility — so such a claim needs a Chromium run and must name the engine it was measured in (`docs-src/architecture.md` § "Native verification").
- JSDoc/commented API changes: `npm run doc`
- Agent map/source-structure/dependency changes: `npm run doc:agent`
- PowerShell script changes: parse the changed `.ps1` file with `System.Management.Automation.Language.Parser`
- Pre-push gate: `scripts\local-ci.ps1` (build, Vitest, module definition validation, component version lockstep, agent docs). The module definition step checks embedded SQL freshness and runs the OpenModulePlatform import guard with `-SelfTest`. It requires at least one measured script. In a git worktree without a sibling `OpenModulePlatform` folder, set `OMP_PLATFORM_ROOT` to the platform checkout or pass `-PlatformRepositoryRoot`. `OpenModulePlatformRoot` takes precedence over `OMP_PLATFORM_ROOT`. Check 15 (shared-script drift) runs strict by default. `-AllowUnverifiedSharedScripts` affects Check 15 only.
- Documentation-only changes: `git diff --check`
- Local hosted visibility: build `dist/`, update the hosted directory, then verify the relevant localhost URL

Avoid running `npm install` unless dependency files need to change. Use `npm ci` only when a clean dependency restore is part of the task.

## Local Runtime Defaults

Default local paths and endpoints:

```text
OpenDocViewer repo:      <workspace>\OpenDocViewer
Optional platform repo:  <workspace>\OpenModulePlatform
Optional host repo:      <workspace>\<host-app-repo>
Runtime root:            <runtime-root>
Portal URL:              http://localhost:<portal-port>/
Host app URL:            http://localhost:<portal-port>/<host-app>/
```

These are local development defaults. Do not hardcode user-specific paths into reusable scripts unless the task explicitly asks for a local-only script.

## Common Commands

```powershell
npm run lint
npm run build
npm run doc
npm run doc:agent
```

For local development:

```powershell
npm run dev
```

For release validation, prefer the existing release helper when the task is explicitly about preparing a release:

```powershell
.\release.ps1 -ReleaseType patch -Yes
```

The release helper is release-only. Commit and push application changes, dependency updates,
source documentation, and `SECURITY.md` release-context updates first. The working tree must be
clean and the local branch must match `origin/<branch>` before the helper creates the npm version
commit and Git tag.

For AI-operated official releases:

1. Confirm that the user requested an official OpenDocViewer release. If they only ask for a
   local OMP test artifact, do not run `release.ps1`.
2. Inspect `package.json`, `SECURITY.md`, `release.ps1`, `.github/workflows/release.yml`, and
   the current Git status before making release-prep edits.
3. Update `SECURITY.md` for the version that `release.ps1` is about to create. Do not manually
   bump `package.json` or `package-lock.json`.
4. Run `npm run lint`, `npm run build`, `npm run doc`, and `git diff --check`.
   Run `npm run doc:agent` as well when source structure, JSDoc, package
   dependencies, or major module responsibilities changed.
5. Commit and push the release-prep changes.
6. Run `.\release.ps1 -ReleaseType <patch|minor|major> -Yes` from a clean branch that matches
   `origin/<branch>` to prepare the release commit/tag locally. To publish the official release,
   run `.\release.ps1 -Publish`: it recognizes the prepared release, shows a summary of what
   will be pushed and asks for confirmation before it pushes. `-Yes` skips that question, and a
   `-ReleaseType` that does not match the prepared version stops the run. The push is atomic
   and names exactly the branch and the release tag
   (`git push --atomic origin <branch> refs/tags/vX.Y.Z`); no other tag is pushed.
7. `release.ps1 -Publish` pushes the release commit + tag, and that push IS the release: the
   GitHub Actions **Release** workflow AUTO-runs on the `vX.Y.Z` tag and builds + publishes the
   GitHub release (body from `release-notes/<tag>.md`). The single approval gate is running
   `release.ps1 -Publish`. **Do NOT change `.github/workflows/release.yml` back to a
   `workflow_dispatch`-only / `approve_release` gate** — an AI change on 2026-06-28 (commit 964fa3f)
   did that and broke the "release.ps1 does everything" flow; it was reverted 2026-07-24. Just
   verify the pushed commit, the `vX.Y.Z` tag, and the auto-run workflow.
8. If the official release will be delivered through OMP, export/import the OMP package from the
   release commit. The release helper has already bumped the OMP component and module-definition
   versions inside that commit, together with `package.json` and the regenerated `docs-agent/`.
   This ensures OMP deploys files whose Help -> About version matches the official release.

Official OpenDocViewer releases and OMP artifact-only component builds are versioned separately.
Do not force `omp-components.json` to match `package.json`. The OMP artifact version only needs
to change when a new deployable artifact should be registered or imported. However, an official
release that is followed by an OMP deployment must not reuse a pre-release OMP artifact package,
because that package was built before `release.ps1` updated the application version embedded in
the runtime.

## Versioning and Maintained Lines

This section is the single source for how official OpenDocViewer releases are numbered and how
released lines are maintained. `AGENTS.md` and the `odv-release` skill point here, and a
session start prompt should too; do not restate the rules elsewhere. It covers the official
releases (`package.json`, the `vX.Y.Z` tags) and no other repository. The OMP artifact
component version keeps its own numbering (`docs-src/omp-component-manifest.md`); it appears
here only for what applies to it on a release branch. Decided by the maintainer on 2026-11-20.

### Version levels

- **Patch** (`2.12.1`): security fixes and serious bugs. A patch never requires an action at
  the customer.
- **Minor** (`2.13.0`): new functionality.
- **Major** (`3.0.0`): decided by the maintainer.

An action at the customer is judged against the compatibility list: runtime configuration keys
and their defaults, IIS headers and Content-Security-Policy, the session URL format, browser
support, and the files in the delivery.

- A change is a major only when a customer who has not touched their configuration notices a
  difference or has to do something.
- A new configuration key that is off by default is a minor.
- An addition to the shipped Content-Security-Policy is a minor when it is needed only for a
  feature that is off by default.
- Example: `pdfTextLayer.enabled` shipped off is a minor. Turning it on by default is a major.

### Maintained lines

- All work happens on `main`. Every release is a tag `vX.Y.Z`.
- An older line lives on a branch `release/X.Y`. `2.12` is the first line maintained this way.
- At most two lines are maintained at a time. A line counts as maintained once it has been
  delivered to a customer.
- The older line receives security patches for six months after the next line has been
  delivered. The period is extended if a customer approval turns out to take longer than two
  months.
- `release/X.Y` is created from the tag `vX.Y.0` at the first fix marked for the line, not
  earlier. From then on the branch is ahead of the tag with fixes that are not released.
- A release branch must always be releasable.
- OMP packages are built from `main` only. The OMP component version is never raised on a
  release branch.
- No release and no tag, from any branch, without the maintainer's explicit yes.

### A fix for a maintained line

1. Fix it on `main` first. A fix never travels from a release branch to `main`.
2. Make it a commit of its own: the fix and its test, and beyond them only what the gate
   requires to travel with every change to shipped files on `main` (the raised OMP component
   version and the regenerated `docs-agent/`). No cleanup in the same commit. A dependency
   update is a commit of its own, one dependency per commit. End the commit message with the
   trailer line `Backport: 2.12`, naming the line it is meant for. Only security fixes and
   serious bugs in code that was part of the release are marked.
3. Carry it over in the same job. Whoever fixes on `main` and marks the commit also transfers
   it to the release branch:
   - The commit on the branch names the commit on `main` it comes from: the
     `(cherry picked from commit <sha>)` line that `git cherry-pick -x` adds to the message.
   - It is not a clean cherry-pick. The version changes in `omp-components.json` and
     `opendocviewer.module-definition.json` and the `docs-agent/` of the commit on `main` do not
     come along: the branch keeps its own version files, and `docs-agent/` is regenerated on
     the branch. `main` has moved those files since the tag, so the pick is expected to stop
     on exactly them:

     ```powershell
     git cherry-pick -x <sha>
     git checkout HEAD -- omp-components.json opendocviewer.module-definition.json docs-agent
     npm run doc:agent
     git add docs-agent
     git cherry-pick --continue
     ```

     The message keeps its source line through the stop (measured with git 2.54). If the pick
     completes without stopping, restore the same paths from the commit before it
     (`git checkout HEAD~1 -- <paths>`), regenerate `docs-agent/` and run
     `git commit --amend --no-edit`.
   - A conflict in any other file stops the transfer: `git cherry-pick --abort`, then report.
     It is never resolved automatically.
   - A dependency update is redone on the branch, because `package-lock.json` rarely transfers.
   - The job is not done until CI is green on the branch. Red CI is reported, never left.
   - The transfer never produces a release. A release from a release branch is the
     maintainer's decision.
4. When a security fix would require an action at the customer (for example a dependency whose
   new version raises the browser requirement), first establish whether the flaw can be fixed
   in OpenDocViewer's own code without raising the dependency. Only when that is not possible
   does it become an explicit exception, which the maintainer decides case by case and which is
   stated at the top of the release notes.

### Release notes and advisories per line

- `release-notes/vX.Y.Z.md` must be in the tag's tree, so a patch gets its file on the release
  branch. The file is then copied to `main`.
- A fix that exists in several lines is published as one GitHub security advisory, with the
  fixed version per line.
- `SECURITY.md` on `main` is the one that applies.

### Decided but not in place (2026-11-20)

Check the repository before relying on any of these:

- No `release/*` branch exists. The latest release is `v2.12.0`.
- The release-branch exemption in the version gate. On `main` a change to shipped files
  (`src/`, `public/`, the package files) must come with a raised OMP component version. Check
  13 (LOCKSTEP) of the validator shared with OpenModulePlatform
  (`scripts/omp/validate-component-versions.ps1`) enforces it. The version step of `scripts/local-ci.ps1`,
  which `.githooks/pre-push` runs, and the `lockstep` job in `.github/workflows/ci.yml` run
  that check, and `release.ps1` raises the version inside every release commit. On `release/*`
  the rule is to be reversed: the gate fails when `omp-components.json` differs from the
  line's tag, and `release.ps1` stops raising the version there. The shared validator is not
  touched. The maintainer reviews that diff before it lands. Until it has landed:
  - A transferred fix that touches shipped files fails the gate on a release branch, so a
    transfer cannot be completed. Prepare it, report, and never bypass the gate.
  - `release.ps1` must not be run on a release branch. The release instructions above ("For
    AI-operated official releases") and in `AGENTS.md` describe a release from `main`.
- Monitoring of maintained branches: a scheduled job that runs `npm audit` against each
  maintained branch. It only reports and opens no fixes of its own. `release/*` is protected
  against forced push and deletion.

## Integration Notes

The canonical host contract is Portable Document Bundle v1. For future manual-review host integrations:

- The host application should provide browser-reachable file URLs and review metadata to ODV.
- ODV should display files and metadata without owning review approval/rejection state.
- Review commands, authorization, audit rules, and temporary URL issuance should remain in the host application and platform.
- Add generic ODV capabilities only when they are useful beyond one host application.

Read `docs-src/integrations.md` before changing `src/integrations/bootstrapRuntime.js`, `src/integrations/normalizePortableBundle.js`, or `src/components/DocumentLoader/sources/explicitListSource.js`.

## Generated Output

- `dist/` is build output.
- `docs/` is generated JSDoc output.
- `docs-agent/` is generated AI-agent documentation from AgentDocMap. It is
  intentionally committed and should be regenerated when source structure,
  dependencies, or JSDoc-backed APIs change.
- Hand-written source documentation belongs in `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, and `docs-src/`.

Do not commit generated output unless the task or release process explicitly requires it. `docs-agent/` is the exception because it is the committed agent-orientation packet.
