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
It can bump repository, component, and module-definition versions. When module
definitions are selected it also updates the referenced module-definition JSON
files. Use the `.cmd` launcher for an interactive double-click flow.

```powershell
.\scripts\omp\bump-version.ps1 -ComponentKey omp-portal-web
.\scripts\omp\bump-version.ps1 -AllComponents -Part minor
.\scripts\omp\bump-version.ps1 -ModuleKey omp_portal -UpdateModuleMinimums
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
