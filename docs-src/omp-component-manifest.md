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
| Seed `@ArtifactVersion` | `sql/3-initialize-opendocviewer.sql` (the `DECLARE @ArtifactVersion` near the top) | A bootstrap-placeholder default artifact version used only when the seed script inserts fresh rows or backfills NULL values. | Deliberately decoupled from both streams above; it seeds initial rows only. |
| `definitionVersion` | `omp-components.json` `moduleDefinitions[].definitionVersion` AND `opendocviewer.module-definition.json` | The OMP module-definition version. | ONE logical version stored in TWO physical copies; the copies MUST be equal. Enforced by `scripts/validate-component-versions.ps1` (Check 8). |
| `minModuleDefinitionVersion` | `omp-components.json` component entry | The minimum module-definition version an artifact package requires. | A floor/constraint (Check 8b), not a copy; it must be at least the current `definitionVersion`. |
| `compatibleArtifacts` `minVersion`/`maxVersion` | `opendocviewer.module-definition.json` | The range of component artifact versions the module definition accepts. | A range constraint over the component version (Check 10), not a copy. |

Seed `@ArtifactVersion` invariant: the seed script never overwrites an existing
choice. An existing non-NULL `omp.AppInstances.ArtifactId` or
`omp.InstanceTemplateAppInstances.DesiredArtifactId` is never changed by the
seed script; only NULL values (backfilled via `COALESCE(target, source)`) and
fresh `WHEN NOT MATCHED` rows receive the seed default. This keeps a re-run or
package import from resetting an already-chosen desired artifact (for example a
newer deployable artifact) back to the bootstrap placeholder.

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

Use `scripts/bump-component-version.ps1` to update manifest versions:

```powershell
.\scripts\bump-component-version.ps1 -ComponentKey opendocviewer-web -Part patch
.\scripts\bump-component-version.ps1 -All -Version 2.0.3
```

The script updates `omp-components.json` only. For an actual OpenDocViewer
release, keep using the normal release process so `package.json`, tags,
release notes, and `SECURITY.md` describe the official release. Do not bump
`omp-components.json` during an official release merely to match `package.json`;
change the component manifest only when the deployable OMP artifact version is
intended to change.

When an official release is going to be installed through OMP, the order matters:

1. Prepare and commit the release notes and other source changes.
2. Run `release.ps1`, which updates `package.json` / `package-lock.json`, creates
   the official version commit, and tags the release.
3. After that release commit exists, bump the OMP artifact component version.
4. Export the OMP universal package from the post-release commit.

This post-release artifact bump does not mean the OMP artifact version must equal
the official OpenDocViewer version. It only guarantees that OMP sees a new
artifact identity and imports files built after the official application version
changed. Without this step, a local or customer OMP installation can keep serving
an older artifact-only package, and Help -> About will correctly show the older
OpenDocViewer version embedded in that package.
