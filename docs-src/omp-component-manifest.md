# OMP Component Manifest

This repository uses `omp-components.json` to list deployable components that
can be registered as OMP artifacts.

OpenDocViewer has one deployable component, so the repository release version
and the component artifact version may look similar, but they are intentionally
independent. The public OpenDocViewer release version is owned by `package.json`
and Git tags. The OMP artifact component version is owned by
`omp-components.json` and may move faster when local or customer deployments
need artifact-only test builds between public releases. The manifest still uses
the same component-list shape as multi-app repositories so OMP package and
HostAgent tooling can treat it consistently.

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
