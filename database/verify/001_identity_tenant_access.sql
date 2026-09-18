/* Run as the migration administrator. */
SET NOCOUNT ON;

IF OBJECT_ID(N'identity.tenants', N'U') IS NULL
  OR OBJECT_ID(N'identity.users', N'U') IS NULL
  OR OBJECT_ID(N'identity.memberships', N'U') IS NULL
  OR OBJECT_ID(N'identity.read_current_session', N'P') IS NULL
  OR OBJECT_ID(N'identity.list_current_tenants', N'P') IS NULL
  OR DATABASE_PRINCIPAL_ID(N'platform_identity_runtime') IS NULL
  THROW 50000, N'Identity migration is incomplete.', 1;

SELECT N'001_identity_tenant_access' AS migration, N'passed' AS status;
