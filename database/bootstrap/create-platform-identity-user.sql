/*
  Run once as the Azure SQL administrator after all migrations are applied.
  Choose a unique password locally. Do not save it in this repository or paste it into chat.
*/
SET NOCOUNT ON;
DECLARE @password nvarchar(256) = N'REPLACE_WITH_A_NEW_PASSWORD';

IF @password = N'REPLACE_WITH_A_NEW_PASSWORD' THROW 50000, N'Set a new contained-user password before running this script.', 1;
IF DATABASE_PRINCIPAL_ID(N'platform_identity_runtime') IS NULL THROW 50000, N'Apply migration 001 first.', 1;

IF DATABASE_PRINCIPAL_ID(N'platform_identity_app') IS NULL
BEGIN
  DECLARE @statement nvarchar(max) = N'CREATE USER [platform_identity_app] WITH PASSWORD = N''' + REPLACE(@password, N'''', N'''''') + N''', DEFAULT_SCHEMA = [identity];';
  EXEC sp_executesql @statement;
END;

DECLARE @roles TABLE (name sysname NOT NULL PRIMARY KEY);
INSERT INTO @roles (name) VALUES
  (N'platform_identity_runtime'), (N'platform_projection_writer'), (N'platform_studio_runtime'), (N'platform_connected_runtime'),
  (N'platform_workflow_browser'), (N'platform_workflow_worker'), (N'platform_governance_browser');

IF EXISTS (SELECT 1 FROM @roles AS r WHERE DATABASE_PRINCIPAL_ID(r.name) IS NULL) THROW 50000, N'Apply all migrations first.', 1;

DECLARE @grants nvarchar(max) = (
  SELECT STRING_AGG(CONVERT(nvarchar(max), N'ALTER ROLE ' + QUOTENAME(r.name) + N' ADD MEMBER [platform_identity_app];'), N' ')
  FROM @roles AS r
  WHERE IS_ROLEMEMBER(r.name, N'platform_identity_app') = 0
);
IF @grants IS NOT NULL EXEC sp_executesql @grants;
