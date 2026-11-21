# OMP Component Manifest

This repository uses `omp-components.json` to list deployable components that
can be registered as OMP artifacts.

OpenDocViewer has one deployable component, so the repository release version
and the component artifact version may look similar, but they are intentionally
independent. The public OpenDocViewer release version is owned by `package.json`
and Git tags. The OMP artifact component version is owned by
`omp-components.json` and may move faster when local or customer deployments
need artifact-only test builds between public releases. It may also stay on a
different number than the public release version. The manifest still uses the
same component-list shape as multi-app repositories so OMP package and HostAgent
tooling can treat it consistently.

The two version streams must not be mechanically synchronized. The OMP artifact
version exists so OMP can tell deployable packages apart; the official
OpenDocViewer version exists so users, support staff, release notes, and the
Help -> About dialog can identify the application build.

## Version Concepts in This Repository

Several version-looking values live in this repository. They are not the same
concept, and they are not meant to move together. The only equality requirement
in the whole set is the two physical copies of `definitionVersion`.

| Concept | Location | Meaning | Relationship to the others |
| --- | --- | --- | --- |
| Official application/release version | `package.json` (and Git tags, release notes) | The public OpenDocViewer version shown in Help -> About and release notes. | Independent stream. Bumped only by the official release process. |
| OMP deployable artifact version | `omp-components.json` `repositoryVersion` and component `opendocviewer-web.version` | The version OMP uses to tell deployable artifact packages apart. | Independent stream; may move faster than the release version and need not match it. |
| Artifact pointers (`ArtifactId`, `DesiredArtifactId`) | `omp.AppInstances` / `omp.InstanceTemplateAppInstances` (platform-owned tables) | Which deployable artifact an app instance (or template) currently points at. | Not a version stream of this repository at all. The seed script never writes them (platform rule `OMP-MODULE-SQL-CONFIG-OWNERSHIP`); rows it inserts start with `NULL` and the platform's artifact auto-apply is the only writer. |
| `definitionVersion` | `omp-components.json` `moduleDefinitions[].definitionVersion` AND `opendocviewer.module-definition.json` | The OMP module-definition version. | ONE logical version stored in TWO physical copies; the copies MUST be equal. Enforced by `scripts/omp/validate-component-versions.ps1` (Check 8). |
| `minModuleDefinitionVersion` | `omp-components.json` component entry | The minimum module-definition version an artifact package requires. | A floor/constraint (Check 8b), not a copy; it must be at least the current `definitionVersion`. |
| `compatibleArtifacts` `minVersion`/`maxVersion` | `opendocviewer.module-definition.json` | The range of component artifact versions the module definition accepts. | A range constraint over the component version (Check 10), not a copy. |

Artifact-pointer invariant: the seed script never writes
`omp.AppInstances.ArtifactId` or
`omp.InstanceTemplateAppInstances.DesiredArtifactId` at all. Both `MERGE`
statements leave the pointer out of `WHEN MATCHED ... UPDATE SET` and out of the
`WHEN NOT MATCHED ... INSERT` column list, so an existing choice is never
touched and a fresh row starts with `NULL` until the platform's artifact
auto-apply fills it. This is the platform ownership rule
`OMP-MODULE-SQL-CONFIG-OWNERSHIP` (module SQL must not touch the platform's
configuration layer); the HostAgent import gate and the `ModuleSqlGuard` check in
the platform's packaging reject a definition whose SQL violates it. The local
pre-push gate also validates embedding with `validate-module-definitions.ps1`
and runs `Test-ModuleSqlGuards.ps1 -SelfTest` from the OpenModulePlatform checkout.
The SQL guard must report a positive script count. Run the regression test with
`./scripts/omp/test-module-sql-import.ps1 -PlatformRepositoryRoot <path>`.

Earlier versions seeded a bootstrap `@ArtifactVersion` and backfilled `NULL`
pointers via `COALESCE(target, source)`; that mechanism is gone.

Do not mechanically synchronize the independent streams. The only values that
must stay equal are the two `definitionVersion` copies.

## Fields

- `repositoryKey` identifies the source repository.
- `repositoryVersion` is an optional coordinated release version for the whole
  repository.
- `moduleDefinitions` lists the OMP module-definition document owned by the
  repository. The JSON file lives at the repository root because OpenDocViewer
  is a single-module repository.
- `componentKey` is the stable key used by scripts and release tooling.
- `moduleKey`, `appKey`, `packageType`, and `targetName` identify the OMP
  artifact target.
- `registrationMode` may be `bootstrap` for deployable infrastructure
  components that are packaged by the repository but are not yet represented by
  normal OMP app metadata. Omit it for normal OMP artifact components.
- `relativePathTemplate` describes the artifact-store path. Replace
  `{version}` with the component version.
- `packageFileTemplate` describes the expected release package path.
- `minModuleDefinitionVersion` records the minimum module-definition version
  required by an artifact package.

## Bumping Versions

Use the canonical `scripts/omp/bump-version.ps1` helper for artifact-only version changes:

```powershell
.\scripts\omp\bump-version.ps1 -ComponentKey opendocviewer-web -Part patch
.\scripts\omp\bump-version.ps1 -AllComponents -Part patch
```

The helper updates the component, `repositoryVersion`, the compatible-artifact ceiling and the
module-definition version together. The older `scripts/bump-component-version.ps1` compatibility
wrapper is deprecated and refuses to run without an explicit opt-in because it does not maintain
that whole version matrix.

For an actual OpenDocViewer release, keep using `release.ps1` so `package.json`, tags, release notes,
and `SECURITY.md` describe the official release. The two version streams remain independent; the OMP
version does not have to equal `package.json`.

When an official release is going to be installed through OMP:

1. Prepare, commit and push the release notes and other source changes.
2. Run `release.ps1`. It updates `package.json` / `package-lock.json`, regenerates `docs-agent/`,
   bumps the OMP component and module-definition versions, and includes all of those changes in the
   official release commit and tag.
3. Export the OMP universal package from that release commit. Do not make a later artifact-only bump
   merely to make the two version numbers match.

Building from the release commit ensures that the deployed files and Help -> About carry the official
application version. An OMP package built from an earlier commit would still contain the older
application version.
