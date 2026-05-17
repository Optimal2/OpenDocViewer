# OMP Component Manifest

This repository uses `omp-components.json` to list deployable components that
can be registered as OMP artifacts.

OpenDocViewer has one deployable component, so the repository release version
and the component artifact version normally stay aligned. The manifest still
uses the same component-list shape as multi-app repositories so OMP package and
HostAgent tooling can treat it consistently.

## Fields

- `repositoryKey` identifies the source repository.
- `repositoryVersion` is an optional coordinated release version for the whole
  repository.
- `componentKey` is the stable key used by scripts and release tooling.
- `moduleKey`, `appKey`, `packageType`, and `targetName` identify the OMP
  artifact target.
- `registrationMode` may be `bootstrap` for deployable infrastructure
  components that are packaged by the repository but are not yet represented by
  normal OMP app metadata. Omit it for normal OMP artifact components.
- `relativePathTemplate` describes the artifact-store path. Replace
  `{version}` with the component version.
- `packageFileTemplate` describes the expected release package path.

## Bumping Versions

Use `scripts/bump-component-version.ps1` to update manifest versions:

```powershell
.\scripts\bump-component-version.ps1 -ComponentKey opendocviewer-web -Part patch
.\scripts\bump-component-version.ps1 -All -Version 2.0.3
```

The script updates `omp-components.json` only. For an actual OpenDocViewer
release, keep using the normal release process so `package.json`, tags,
release notes, and `SECURITY.md` stay aligned with the manifest.
