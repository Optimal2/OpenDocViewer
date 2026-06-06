# OMP Object Builder

## Convenience Wrappers

`bump-version.ps1` updates the current repository's `omp-components.json`.
It can bump repository, component, and module-definition versions. When module
definitions are selected it also updates the referenced module-definition JSON
files. Use the `.cmd` launcher for an interactive double-click flow.

```powershell
.\scripts\omp\bump-version.ps1 -ComponentKey omp-portal-web
.\scripts\omp\bump-version.ps1 -AllComponents -Part minor
.\scripts\omp\bump-version.ps1 -ModuleKey omp_portal -UpdateModuleMinimums
```

`build-universal-package.ps1` is a friendlier wrapper around
`export-universal-package.ps1`. With no component selection it builds all
components and writes a universal zip named from `repositoryKey` and
`repositoryVersion`.

```powershell
.\scripts\omp\build-universal-package.ps1
.\scripts\omp\build-universal-package.ps1 -OutputDirectory E:\Packages
```

The default output folder is `artifacts\universal-packages`. Set
`OMP_UNIVERSAL_PACKAGE_OUTPUT_DIR` to use a shared package folder without
hardcoding machine-specific paths in repositories.

`build-repository-objects.ps1` reads a repository's `omp-components.json` and
creates portable OMP objects:

```text
module-definitions/
artifacts/
host-configs/
config-overlays/
widgets/
widget-data/
```

Use this script when a module repository needs to publish objects for Portal,
HostAgent import folders, or installer package libraries. Runtime or
customer-specific configuration should be supplied through command-line
mappings, not committed to the public repository.

For .NET components, this script publishes with deterministic MSBuild settings
and a stable `PathMap`. The same source and artifact version should therefore
produce identical import-relevant artifact payload bytes whether the package is
built from a repository script or by the Bootstrapper developer-source refresh.

Use `-WidgetFile` for dashboard widget JSON objects that should be copied into
the same output shape as the other portable OMP objects.

Use `-WidgetDataFile` for widget runtime-data zips that contain shared
`widget_data` JSON and referenced `widget_binary_data` rows. Portal can export
these objects from the universal package form for database-backed widget media
such as music-player tracks and custom blank-widget images.

When `-ComponentKey` is used, the builder exports only those component artifact
packages and the module definition files whose `moduleKey` belongs to the
selected components. Use `-AllComponents` for a full repository package.

`export-universal-package.ps1` is the standard command that every
OMP-compatible module repository should expose at the same path. It uses the
object builder and then creates one universal zip with
`omp-universal-package.json` at the root. `export-universal-package.cmd` is the
matching double-click wrapper.

Examples:

```powershell
.\scripts\omp\export-universal-package.ps1 -AllComponents -BuildArtifacts

.\scripts\omp\export-universal-package.ps1 `
  -AllComponents `
  -BuildArtifacts `
  -TargetHostProfile vgr-test `
  -ArtifactConfigurationFile 'opendocviewer-web:odv.site.config.js=E:\Secure\odv.site.config.js'

.\scripts\omp\export-universal-package.ps1 `
  -AllComponents `
  -BuildArtifacts `
  -HostProfilePath E:\Private\profiles\vgr-test.package-profile.json `
  -OutputPath E:\Packages\opendocviewer__vgr-test__20260525.zip
```

The optional host profile is JSON and can provide `targetHostProfile`,
`artifactConfigurationFiles`, `hostConfigurationFiles`, `configOverlayFiles`,
`widgetFiles`, `widgetDataFiles`, and `modules`.

Use `modules.<moduleKey>` when one shared host profile contains values for many
modules. The exporter applies only the segments that match module keys owned by
the current repository.

Repositories that need to turn module-private settings into generated portable
objects can add an optional hook at
`scripts/omp/build-host-profile-objects.ps1`. The hook receives
`-RepositoryRoot`, `-OutputRoot`, `-HostProfilePath`, `-TargetHostProfile`,
`-ModuleKey`, and `-Configuration`, and should write generated host configs,
config overlays, widgets, or widget runtime-data zips below `OutputRoot`.

Keep private host profiles in the private installer or DEV repository, not in
public module repositories.
