SET NOCOUNT ON;

IF OBJECT_ID(N'studio.list_revisions', N'P') IS NULL
  THROW 50000, N'Studio revision history procedure is missing.', 1;

IF NOT EXISTS (
  SELECT 1
  FROM sys.database_permissions AS permissions
  INNER JOIN sys.database_principals AS principals ON principals.principal_id = permissions.grantee_principal_id
  WHERE permissions.major_id = OBJECT_ID(N'studio.list_revisions')
    AND permissions.permission_name = N'EXECUTE'
    AND permissions.state = N'G'
    AND principals.name = N'platform_studio_runtime'
)
  THROW 50000, N'Studio revision history is not granted to the Studio runtime role.', 1;

SELECT N'011_studio_revision_history' AS migration, N'passed' AS status;
