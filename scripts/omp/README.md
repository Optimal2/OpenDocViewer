# OMP Object Builder

## Convenience Wrappers

Every OMP-compatible repository exposes the same command files in
`scripts\omp`:

```text
bump-version.cmd
build-universal-package.cmd
export-universal-package.cmd
```

The `.cmd` files are intended for Windows double-click usage and normal command
prompt usage. They call the matching PowerShell scripts with `-NoProfile` and
without `-ExecutionPolicy Bypass`. `build-universal-package.cmd` and
`bump-version.cmd` pause at the end by default so a double-clicked console
window stays open. For scripted validation, pass `--no-pause` as the first
argument:

```cmd
scripts\omp\build-universal-package.cmd --no-pause
```

All `.cmd` wrappers forward additional arguments to the underlying `.ps1`
script. Examples:

```cmd
scripts\omp\build-universal-package.cmd --no-pause -OutputDirectory E:\Packages
scripts\omp\export-universal-package.cmd -AllComponents -BuildArtifacts -OutputPath E:\Packages\my-package.zip
```

For most manual package builds, use `build-universal-package.cmd`. It defaults
to all components, builds artifact payloads, and writes one complete universal
package. `export-universal-package.cmd` is the lower-level exporter; use it when
you need explicit parameters such as host profiles, selected components, or
extra object files.

`bump-version.ps1` updates the current repository's `omp-components.json`.
It can bump repository, component, module-definition, and dashboard widget
versions. When module definitions are selected it also updates the referenced
module-definition JSON files. When widget files are selected it updates both the
manifest `widgetVersion` and the referenced widget package JSON
`packageVersion`/`widgetVersion` values. Use the `.cmd` launcher for an
interactive double-click flow.

```powershell
.\scripts\omp\bump-version.ps1 -ComponentKey omp-portal-web
.\scripts\omp\bump-version.ps1 -AllComponents -Part minor
.\scripts\omp\bump-version.ps1 -ModuleKey omp_portal -UpdateModuleMinimums
.\scripts\omp\bump-version.ps1 -WidgetFile widgets/log-search-widgets.json
.\scripts\omp\bump-version.ps1 -AllWidgets
```

Double-click `bump-version.cmd` for an interactive version bump. The default
interactive choice is all artifact components and patch version bump; module
definition versions are bumped only when selected. This command changes files,
so review `git diff` before building and committing.

When arguments are passed to `bump-version.cmd`, it runs the underlying
PowerShell script non-interactively. This is useful for scripted version bumps:

```cmd
scripts\omp\bump-version.cmd --no-pause -ComponentKey omp-portal-web
scripts\omp\bump-version.cmd --no-pause -AllComponents -Part patch
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
the same output shape as the other portable OMP objects. Repository manifest
`widgetFiles` entries should normally be objects with `path` and
`widgetVersion`. The builder stamps the widget package root `packageVersion` and
each widget's `widgetVersion`, and writes default destinations as
`<name>__<widgetVersion>.json` so installer archives can keep several widget
versions side by side.

Use `-WidgetDataFile` for widget runtime-data zips that contain shared
`widget_data` JSON and referenced `widget_binary_data` rows. Portal can export
these objects from the universal package form for database-backed widget media
such as music-player tracks and custom blank-widget images. When Portal exports
runtime data together with dashboard widgets, the runtime-data package uses the
same `packageVersion` as the widget package so the universal manifest can track
the object version.

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

## Validating Command Wrappers

Use `test-cmd-wrappers.ps1` to verify that repository `.cmd` package builders
can run without hanging. The validation always calls
`build-universal-package.cmd --no-pause`, redirects stdout/stderr to per-repo
log files, and terminates the whole command process tree if one repository
exceeds the configured timeout.

```powershell
.\scripts\omp\test-cmd-wrappers.ps1 -RepositoryName OpenModulePlatform -PerRepositoryTimeoutSeconds 1200

.\scripts\omp\test-cmd-wrappers.ps1 `
  -WorkspaceRoot "E:\Linus Dunkers\Documents\GitHub" `
  -RepositoryName Dokumentbibliotek,LogSearch,EArkivChecker `
  -OutputRoot "$env:TEMP\omp-cmd-wrapper-validation\packages" `
  -LogRoot "$env:TEMP\omp-cmd-wrapper-validation\logs" `
  -PerRepositoryTimeoutSeconds 1800
```

With no `-RepositoryName`, the validator scans the workspace for sibling
repositories that contain both `omp-components.json` and
`scripts\omp\build-universal-package.cmd`. The default output and log folders
are below the current user's temp directory.

## Comparing Package Generation Paths

Universal package validation should compare the import-relevant portable object
data, not the outer zip bytes. Zip timestamps, compression metadata, and the
package manifest `createdUtc` value may differ without changing what Portal or
HostAgent imports.

Use these helpers when validating that repository scripts, the Bootstrapper
developer-source refresh, and installer exports produce the same objects:

```powershell
.\scripts\omp\merge-universal-package-objects.ps1 `
  -PackageRoot "$env:TEMP\omp-cmd-wrapper-validation\packages" `
  -OutputRoot "$env:TEMP\omp-cmd-wrapper-validation\aggregate-objects"

.\scripts\omp\compare-universal-package-data.ps1 `
  -FirstPackage "$env:TEMP\omp-cmd-wrapper-validation\aggregate-objects" `
  -SecondPackage "E:\DevInstaller\OpenModulePlatform\Universal\installer\data\global"

.\scripts\omp\compare-universal-package-data.ps1 `
  -FirstPackage "E:\DevInstaller\OpenModulePlatform\Universal\installer\exports\omp-universal__global__20260606.zip" `
  -SecondPackage "E:\DevInstaller\OpenModulePlatform\Universal\installer\data\global"
```

`merge-universal-package-objects.ps1` extracts many repository-level universal
packages into one object root and fails if two packages contain the same object
path with different content. `compare-universal-package-data.ps1` normalizes
universal object comparison and expands artifact packages before comparing
their payloads. `compare-artifact-payload-files.ps1` is available for a focused
artifact-to-artifact comparison when a single artifact identity is suspected.

The Bootstrapper installer refresh may keep local `*.zip.source-stamp.json`
files next to artifact packages in its object archive. Those files are cache
metadata only: universal package export includes `artifacts/*.zip`, not the
stamp files, and importers ignore them.

To create a universal package from an already validated object root, use:

```powershell
.\scripts\omp\export-universal-object-root.ps1 `
  -ObjectRoot "E:\DevInstaller\OpenModulePlatform\Universal\installer\data\global" `
  -OutputPath "E:\Packages\omp-universal__global__verified.zip"
```

That helper is intended for validation and developer packaging. Normal
repository builds should still use `build-universal-package.cmd` or
`export-universal-package.ps1`.
