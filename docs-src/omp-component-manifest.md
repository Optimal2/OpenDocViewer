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
