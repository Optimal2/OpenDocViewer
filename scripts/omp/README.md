# OMP Packaging

Use `export-universal-package.ps1` to export this repository's OMP module
definition and artifact packages as one universal OMP zip.

The command path is intentionally the same in every OMP-compatible module
repository:

```powershell
.\scripts\omp\export-universal-package.ps1 -AllComponents -BuildArtifacts
```

Host-specific configuration is optional. When needed, pass `-HostProfilePath` or
explicit `-ArtifactConfigurationFile`, `-HostConfigurationFile`,
`-ConfigOverlayFile`, and `-WidgetFile` arguments. This repository is
responsible for producing correct objects from the host information it receives;
repositories that have no host-specific needs can ignore those inputs.

A shared host profile can contain a `modules.opendocviewer` segment. The
canonical exporter applies only module segments that match modules owned by this
repository.
