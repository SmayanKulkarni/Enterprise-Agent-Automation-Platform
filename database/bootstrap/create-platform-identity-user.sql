/*
  Run once as the Azure SQL administrator after 001_identity_tenant_access.sql.
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

IF NOT EXISTS (
  SELECT 1
  FROM sys.database_role_members AS membership
  INNER JOIN sys.database_principals AS role_principal ON role_principal.principal_id = membership.role_principal_id
  INNER JOIN sys.database_principals AS member_principal ON member_principal.principal_id = membership.member_principal_id
  WHERE role_principal.name = N'platform_identity_runtime' AND member_principal.name = N'platform_identity_app'
)
  ALTER ROLE platform_identity_runtime ADD MEMBER platform_identity_app;
