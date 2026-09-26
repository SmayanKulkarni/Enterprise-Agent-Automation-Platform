SET NOCOUNT ON;

DECLARE @required TABLE (schema_name sysname NOT NULL, object_name sysname NOT NULL);
INSERT INTO @required (schema_name, object_name) VALUES
  (N'identity', N'external_identities'), (N'identity', N'profiles'), (N'identity', N'exact_approvals'),
  (N'lifecycle', N'packages'), (N'case', N'cases'), (N'gateway', N'installations'),
  (N'memory', N'records'), (N'technical', N'customer_environments'), (N'vendor', N'access_grants'),
  (N'deployment', N'manifests'), (N'demo', N'runs'), (N'operations', N'command_receipts'),
  (N'operations', N'audit_facts'), (N'operations', N'change_hints');

IF EXISTS (SELECT 1 FROM @required AS r WHERE OBJECT_ID(QUOTENAME(r.schema_name) + N'.' + QUOTENAME(r.object_name), N'U') IS NULL)
  THROW 50000, N'Connected platform tables are incomplete.', 1;

IF OBJECT_ID(N'operations.record_command_receipt', N'P') IS NULL
  OR DATABASE_PRINCIPAL_ID(N'platform_connected_runtime') IS NULL
  THROW 50000, N'Connected platform runtime boundary is incomplete.', 1;

IF EXISTS (
  SELECT 1
  FROM sys.database_permissions AS permission
  INNER JOIN sys.database_principals AS grantee ON grantee.principal_id = permission.grantee_principal_id
  WHERE grantee.name = N'platform_connected_runtime'
    AND permission.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
)
  THROW 50000, N'Runtime role must not have direct table writes.', 1;

SELECT N'004_connected_platform' AS migration, N'passed' AS status;
