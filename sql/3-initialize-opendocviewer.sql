/*
OpenDocViewer OMP registration script.

This script registers OpenDocViewer as a normal host-neutral OMP web app so
HostAgent can deploy it from an artifact like every other web application. The
physical install path is intentionally left NULL by default; HostAgent resolves
the target from HostAgent:WebAppsRoot and the app RoutePath.
*/
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'omp_opendocviewer')
BEGIN
    EXEC(N'CREATE SCHEMA [omp_opendocviewer]');
END
GO

DECLARE @ArtifactVersion nvarchar(50) = N'2.0.10';
DECLARE @OpenDocViewerDisplayName nvarchar(150) = N'OpenDocViewer';
DECLARE @OpenDocViewerRoutePath nvarchar(256) = N'opendocviewer';
DECLARE @OpenDocViewerPublicUrl nvarchar(500) = NULL;
DECLARE @OpenDocViewerInstallPath nvarchar(500) = NULL;

DECLARE @InstanceId uniqueidentifier;
DECLARE @InstanceTemplateId int;
DECLARE @OpenDocViewerModuleId int;
DECLARE @OpenDocViewerAppId int;
DECLARE @OpenDocViewerArtifactId int;
DECLARE @OpenDocViewerModuleInstanceId uniqueidentifier;
DECLARE @OpenDocViewerTemplateModuleInstanceId int;

SELECT TOP (1)
       @InstanceId = InstanceId,
       @InstanceTemplateId = InstanceTemplateId
FROM omp.Instances
WHERE InstanceKey = N'default'
ORDER BY CreatedUtc, InstanceId;

IF @InstanceId IS NULL
BEGIN
    THROW 51013, 'Default OMP instance not found. Run the core SQL setup/init scripts first.', 1;
END

MERGE omp.Modules AS target
USING
(
    SELECT N'opendocviewer' AS ModuleKey,
           N'OpenDocViewer' AS DisplayName,
           N'WebAppModule' AS ModuleType,
           N'omp_opendocviewer' AS SchemaName,
           N'First-party OMP registration for the OpenDocViewer static web application' AS Description,
           CAST(1 AS bit) AS IsEnabled,
           CAST(310 AS int) AS SortOrder
) AS source
ON target.ModuleKey = source.ModuleKey
WHEN MATCHED THEN
    UPDATE SET DisplayName = source.DisplayName,
               ModuleType = source.ModuleType,
               SchemaName = source.SchemaName,
               Description = source.Description,
               IsEnabled = source.IsEnabled,
               SortOrder = source.SortOrder,
               UpdatedUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT(ModuleKey, DisplayName, ModuleType, SchemaName, Description, IsEnabled, SortOrder)
    VALUES(source.ModuleKey, source.DisplayName, source.ModuleType, source.SchemaName, source.Description, source.IsEnabled, source.SortOrder);

SELECT @OpenDocViewerModuleId = ModuleId
FROM omp.Modules
WHERE ModuleKey = N'opendocviewer';

MERGE omp.Apps AS target
USING
(
    SELECT @OpenDocViewerModuleId AS ModuleId,
           N'opendocviewer_webapp' AS AppKey,
           @OpenDocViewerDisplayName AS DisplayName,
           N'WebApp' AS AppType,
           N'Static web application definition for OpenDocViewer' AS Description,
           CAST(1 AS bit) AS IsEnabled,
           CAST(310 AS int) AS SortOrder
) AS source
ON target.ModuleId = source.ModuleId
AND target.AppKey = source.AppKey
WHEN MATCHED THEN
    UPDATE SET DisplayName = source.DisplayName,
               AppType = source.AppType,
               Description = source.Description,
               IsEnabled = source.IsEnabled,
               SortOrder = source.SortOrder,
               UpdatedUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT(ModuleId, AppKey, DisplayName, AppType, Description, IsEnabled, SortOrder)
    VALUES(source.ModuleId, source.AppKey, source.DisplayName, source.AppType, source.Description, source.IsEnabled, source.SortOrder);

SELECT @OpenDocViewerAppId = AppId
FROM omp.Apps
WHERE ModuleId = @OpenDocViewerModuleId
  AND AppKey = N'opendocviewer_webapp';

MERGE omp.Artifacts AS target
USING
(
    SELECT @OpenDocViewerAppId AS AppId,
           @ArtifactVersion AS Version,
           N'web-app' AS PackageType,
           N'opendocviewer' AS TargetName,
           N'opendocviewer/web/' + @ArtifactVersion AS RelativePath,
           CAST(1 AS bit) AS IsEnabled
) AS source
ON target.AppId = source.AppId
AND target.Version = source.Version
AND target.PackageType = source.PackageType
AND target.TargetName = source.TargetName
WHEN MATCHED THEN
    UPDATE SET RelativePath = source.RelativePath,
               IsEnabled = source.IsEnabled,
               UpdatedUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT(AppId, Version, PackageType, TargetName, RelativePath, IsEnabled)
    VALUES(source.AppId, source.Version, source.PackageType, source.TargetName, source.RelativePath, source.IsEnabled);

SELECT @OpenDocViewerArtifactId = ArtifactId
FROM omp.Artifacts
WHERE AppId = @OpenDocViewerAppId
  AND Version = @ArtifactVersion
  AND PackageType = N'web-app'
  AND TargetName = N'opendocviewer';

MERGE omp.ModuleInstances AS target
USING
(
    SELECT @InstanceId AS InstanceId,
           @OpenDocViewerModuleId AS ModuleId,
           N'opendocviewer' AS ModuleInstanceKey,
           N'OpenDocViewer' AS DisplayName,
           N'OpenDocViewer module instance for the default OMP instance' AS Description,
           CAST(1 AS bit) AS IsEnabled,
           CAST(310 AS int) AS SortOrder
) AS source
ON target.InstanceId = source.InstanceId
AND target.ModuleInstanceKey = source.ModuleInstanceKey
WHEN MATCHED THEN
    UPDATE SET ModuleId = source.ModuleId,
               DisplayName = source.DisplayName,
               Description = source.Description,
               IsEnabled = source.IsEnabled,
               SortOrder = source.SortOrder,
               UpdatedUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT(ModuleInstanceId, InstanceId, ModuleId, ModuleInstanceKey, DisplayName, Description, IsEnabled, SortOrder)
    VALUES(NEWID(), source.InstanceId, source.ModuleId, source.ModuleInstanceKey, source.DisplayName, source.Description, source.IsEnabled, source.SortOrder);

SELECT @OpenDocViewerModuleInstanceId = ModuleInstanceId
FROM omp.ModuleInstances
WHERE InstanceId = @InstanceId
  AND ModuleInstanceKey = N'opendocviewer';

MERGE omp.InstanceTemplateModuleInstances AS target
USING
(
    SELECT @InstanceTemplateId AS InstanceTemplateId,
           @OpenDocViewerModuleId AS ModuleId,
           N'opendocviewer' AS ModuleInstanceKey,
           N'OpenDocViewer' AS DisplayName,
           N'OpenDocViewer module instance in the default template' AS Description,
           CAST(310 AS int) AS SortOrder,
           CAST(1 AS bit) AS IsEnabled
) AS source
ON target.InstanceTemplateId = source.InstanceTemplateId
AND target.ModuleInstanceKey = source.ModuleInstanceKey
WHEN MATCHED THEN
    UPDATE SET ModuleId = source.ModuleId,
               DisplayName = source.DisplayName,
               Description = source.Description,
               SortOrder = source.SortOrder,
               IsEnabled = source.IsEnabled,
               UpdatedUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT(InstanceTemplateId, ModuleId, ModuleInstanceKey, DisplayName, Description, SortOrder, IsEnabled)
    VALUES(source.InstanceTemplateId, source.ModuleId, source.ModuleInstanceKey, source.DisplayName, source.Description, source.SortOrder, source.IsEnabled);

SELECT @OpenDocViewerTemplateModuleInstanceId = InstanceTemplateModuleInstanceId
FROM omp.InstanceTemplateModuleInstances
WHERE InstanceTemplateId = @InstanceTemplateId
  AND ModuleInstanceKey = N'opendocviewer';

MERGE omp.AppInstances AS target
USING
(
    SELECT @OpenDocViewerModuleInstanceId AS ModuleInstanceId,
           CAST(NULL AS uniqueidentifier) AS HostId,
           @OpenDocViewerAppId AS AppId,
           N'opendocviewer_webapp' AS AppInstanceKey,
           @OpenDocViewerDisplayName AS DisplayName,
           N'OpenDocViewer static web app managed by OMP HostAgent' AS Description,
           @OpenDocViewerRoutePath AS RoutePath,
           @OpenDocViewerPublicUrl AS PublicUrl,
           @OpenDocViewerInstallPath AS InstallPath,
           N'opendocviewer' AS InstallationName,
           @OpenDocViewerArtifactId AS ArtifactId,
           CAST(1 AS bit) AS IsEnabled,
           CAST(1 AS bit) AS IsAllowed,
           CAST(1 AS tinyint) AS DesiredState,
           CAST(310 AS int) AS SortOrder
) AS source
ON target.ModuleInstanceId = source.ModuleInstanceId
AND target.AppInstanceKey = source.AppInstanceKey
WHEN MATCHED THEN
    UPDATE SET HostId = source.HostId,
               AppId = source.AppId,
               DisplayName = source.DisplayName,
               Description = source.Description,
               RoutePath = source.RoutePath,
               PublicUrl = source.PublicUrl,
               InstallPath = source.InstallPath,
               InstallationName = source.InstallationName,
               ArtifactId = source.ArtifactId,
               IsEnabled = source.IsEnabled,
               IsAllowed = source.IsAllowed,
               DesiredState = source.DesiredState,
               SortOrder = source.SortOrder,
               UpdatedUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT(AppInstanceId, ModuleInstanceId, HostId, AppId, AppInstanceKey, DisplayName, Description, RoutePath, PublicUrl, InstallPath, InstallationName, ArtifactId, IsEnabled, IsAllowed, DesiredState, SortOrder)
    VALUES(NEWID(), source.ModuleInstanceId, source.HostId, source.AppId, source.AppInstanceKey, source.DisplayName, source.Description, source.RoutePath, source.PublicUrl, source.InstallPath, source.InstallationName, source.ArtifactId, source.IsEnabled, source.IsAllowed, source.DesiredState, source.SortOrder);

MERGE omp.InstanceTemplateAppInstances AS target
USING
(
    SELECT @OpenDocViewerTemplateModuleInstanceId AS InstanceTemplateModuleInstanceId,
           CAST(NULL AS int) AS InstanceTemplateHostId,
           @OpenDocViewerAppId AS AppId,
           N'opendocviewer_webapp' AS AppInstanceKey,
           @OpenDocViewerDisplayName AS DisplayName,
           N'OpenDocViewer static web app managed by OMP HostAgent' AS Description,
           @OpenDocViewerRoutePath AS RoutePath,
           @OpenDocViewerPublicUrl AS PublicUrl,
           @OpenDocViewerInstallPath AS InstallPath,
           N'opendocviewer' AS InstallationName,
           @OpenDocViewerArtifactId AS DesiredArtifactId,
           CAST(1 AS tinyint) AS DesiredState,
           CAST(310 AS int) AS SortOrder,
           CAST(1 AS bit) AS IsEnabled
) AS source
ON target.InstanceTemplateModuleInstanceId = source.InstanceTemplateModuleInstanceId
AND target.AppInstanceKey = source.AppInstanceKey
WHEN MATCHED THEN
    UPDATE SET InstanceTemplateHostId = source.InstanceTemplateHostId,
               AppId = source.AppId,
               DisplayName = source.DisplayName,
               Description = source.Description,
               RoutePath = source.RoutePath,
               PublicUrl = source.PublicUrl,
               InstallPath = source.InstallPath,
               InstallationName = source.InstallationName,
               DesiredArtifactId = source.DesiredArtifactId,
               DesiredState = source.DesiredState,
               SortOrder = source.SortOrder,
               IsEnabled = source.IsEnabled,
               UpdatedUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT(InstanceTemplateModuleInstanceId, InstanceTemplateHostId, AppId, AppInstanceKey, DisplayName, Description, RoutePath, PublicUrl, InstallPath, InstallationName, DesiredArtifactId, DesiredState, SortOrder, IsEnabled)
    VALUES(source.InstanceTemplateModuleInstanceId, source.InstanceTemplateHostId, source.AppId, source.AppInstanceKey, source.DisplayName, source.Description, source.RoutePath, source.PublicUrl, source.InstallPath, source.InstallationName, source.DesiredArtifactId, source.DesiredState, source.SortOrder, source.IsEnabled);
GO
