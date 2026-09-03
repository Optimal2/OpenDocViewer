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

DECLARE @OpenDocViewerDisplayName nvarchar(150) = N'OpenDocViewer';
-- Single source for the module/instance key so the MERGE and lookup statements below
-- cannot drift apart if the key is ever renamed.
DECLARE @OpenDocViewerKey nvarchar(128) = N'opendocviewer';
DECLARE @OpenDocViewerRoutePath nvarchar(256) = @OpenDocViewerKey;
DECLARE @OpenDocViewerAppKey nvarchar(128) = N'opendocviewer_webapp';
DECLARE @OpenDocViewerPublicUrl nvarchar(500) = NULL;
DECLARE @OpenDocViewerInstallPath nvarchar(500) = NULL;

DECLARE @InstanceId uniqueidentifier;
DECLARE @InstanceTemplateId int;
DECLARE @OpenDocViewerModuleId int;
DECLARE @OpenDocViewerAppId int;
DECLARE @OpenDocViewerModuleInstanceId uniqueidentifier;
DECLARE @OpenDocViewerTemplateModuleInstanceId int;

SELECT TOP (1)
       @InstanceId = InstanceId,
       @InstanceTemplateId = InstanceTemplateId
FROM omp.Instances
WHERE InstanceKey = N'default'
ORDER BY CreatedUtc, InstanceId;

-- Error numbers: the OpenDocViewer seed scripts use the 51000-51999 range (user-defined
-- THROW numbers start at 50001). 51013-51018 belong to this script; each guard has its
-- own number so a failing installation log points at exactly one lookup.
IF @InstanceId IS NULL
BEGIN
    THROW 51013, 'Default OMP instance not found. Run the core SQL setup/init scripts first.', 1;
END

IF @InstanceTemplateId IS NULL
BEGIN
    THROW 51014, 'Default OMP instance has no instance template. The template MERGE statements below would otherwise write NULL template ids.', 1;
END

MERGE omp.Modules AS target
USING
(
    SELECT @OpenDocViewerKey AS ModuleKey,
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
WHERE ModuleKey = @OpenDocViewerKey
  AND SchemaName = N'omp_opendocviewer';

IF @OpenDocViewerModuleId IS NULL
BEGIN
    THROW 51017, 'The OpenDocViewer module row was not found after the MERGE above; the statements that follow would write a NULL module id.', 1;
END

MERGE omp.Apps AS target
USING
(
    SELECT @OpenDocViewerModuleId AS ModuleId,
           @OpenDocViewerAppKey AS AppKey,
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
  AND AppKey = @OpenDocViewerAppKey;

IF @OpenDocViewerAppId IS NULL
BEGIN
    THROW 51018, 'The OpenDocViewer app row was not found after the MERGE above; the statements that follow would write a NULL app id.', 1;
END

-- The seed never writes to omp.Artifacts: artifact rows are owned by package
-- import, which is the only component that knows the real on-disk version.
-- Since 2026-09-02 the seed does not write the artifact pointers either
-- (omp.AppInstances.ArtifactId and omp.InstanceTemplateAppInstances.DesiredArtifactId):
-- they are owned by artifact auto-apply, which runs after this script and points
-- the rows created here at the newest hash-bearing artifact. Nothing below reads
-- or resolves an artifact id, so the seed can never reference a version that does
-- not exist or re-enable a disabled artifact row.

MERGE omp.ModuleInstances AS target
USING
(
    SELECT @InstanceId AS InstanceId,
           @OpenDocViewerModuleId AS ModuleId,
           @OpenDocViewerKey AS ModuleInstanceKey,
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
  AND ModuleInstanceKey = @OpenDocViewerKey;

IF @OpenDocViewerModuleInstanceId IS NULL
BEGIN
    THROW 51015, 'The OpenDocViewer module instance was not found after the MERGE above; the statements that follow would write NULL ids.', 1;
END

MERGE omp.InstanceTemplateModuleInstances AS target
USING
(
    SELECT @InstanceTemplateId AS InstanceTemplateId,
           @OpenDocViewerModuleId AS ModuleId,
           @OpenDocViewerKey AS ModuleInstanceKey,
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
  AND ModuleInstanceKey = @OpenDocViewerKey;

IF @OpenDocViewerTemplateModuleInstanceId IS NULL
BEGIN
    THROW 51016, 'The OpenDocViewer template module instance was not found after the MERGE above; the statements that follow would write NULL ids.', 1;
END

MERGE omp.AppInstances AS target
USING
(
    SELECT @OpenDocViewerModuleInstanceId AS ModuleInstanceId,
           CAST(NULL AS uniqueidentifier) AS HostId,
           @OpenDocViewerAppId AS AppId,
           @OpenDocViewerAppKey AS AppInstanceKey,
           @OpenDocViewerDisplayName AS DisplayName,
           N'OpenDocViewer static web app managed by OMP HostAgent' AS Description,
           @OpenDocViewerRoutePath AS RoutePath,
           @OpenDocViewerPublicUrl AS PublicUrl,
           @OpenDocViewerInstallPath AS InstallPath,
           @OpenDocViewerKey AS InstallationName,
           -- Left NULL in the USING projection: the pointer is set by
           -- artifact auto-apply after this row exists, never from here.
           CAST(NULL AS int) AS ArtifactId,
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
               -- ArtifactId is owned by artifact auto-apply and is never set from here (ownership model).
               IsEnabled = source.IsEnabled,
               IsAllowed = source.IsAllowed,
               DesiredState = source.DesiredState,
               SortOrder = source.SortOrder,
               UpdatedUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT(AppInstanceId, ModuleInstanceId, HostId, AppId, AppInstanceKey, DisplayName, Description, RoutePath, PublicUrl, InstallPath, InstallationName, IsEnabled, IsAllowed, DesiredState, SortOrder)
    VALUES(NEWID(), source.ModuleInstanceId, source.HostId, source.AppId, source.AppInstanceKey, source.DisplayName, source.Description, source.RoutePath, source.PublicUrl, source.InstallPath, source.InstallationName, source.IsEnabled, source.IsAllowed, source.DesiredState, source.SortOrder);

MERGE omp.InstanceTemplateAppInstances AS target
USING
(
    SELECT @OpenDocViewerTemplateModuleInstanceId AS InstanceTemplateModuleInstanceId,
           CAST(NULL AS int) AS InstanceTemplateHostId,
           @OpenDocViewerAppId AS AppId,
           @OpenDocViewerAppKey AS AppInstanceKey,
           @OpenDocViewerDisplayName AS DisplayName,
           N'OpenDocViewer static web app managed by OMP HostAgent' AS Description,
           @OpenDocViewerRoutePath AS RoutePath,
           @OpenDocViewerPublicUrl AS PublicUrl,
           @OpenDocViewerInstallPath AS InstallPath,
           @OpenDocViewerKey AS InstallationName,
           -- Left NULL in the USING projection: the pointer is set by
           -- artifact auto-apply after this row exists, never from here.
           CAST(NULL AS int) AS DesiredArtifactId,
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
               -- DesiredArtifactId is owned by artifact auto-apply and is never set from here (ownership model).
               DesiredState = source.DesiredState,
               SortOrder = source.SortOrder,
               IsEnabled = source.IsEnabled,
               UpdatedUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT(InstanceTemplateModuleInstanceId, InstanceTemplateHostId, AppId, AppInstanceKey, DisplayName, Description, RoutePath, PublicUrl, InstallPath, InstallationName, DesiredState, SortOrder, IsEnabled)
    VALUES(source.InstanceTemplateModuleInstanceId, source.InstanceTemplateHostId, source.AppId, source.AppInstanceKey, source.DisplayName, source.Description, source.RoutePath, source.PublicUrl, source.InstallPath, source.InstallationName, source.DesiredState, source.SortOrder, source.IsEnabled);
GO
