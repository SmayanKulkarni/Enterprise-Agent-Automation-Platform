SET NOCOUNT ON;

IF OBJECT_ID(N'identity.tenant_groups', N'U') IS NULL
  OR OBJECT_ID(N'identity.tenant_group_members', N'U') IS NULL
  OR OBJECT_ID(N'identity.tenant_group_admins', N'U') IS NULL
  OR OBJECT_ID(N'identity.group_admin_grants', N'U') IS NULL
  THROW 50000, N'Tenant group tables are incomplete.', 1;

IF SCHEMA_ID(N'governance') IS NULL
  OR OBJECT_ID(N'identity.list_current_groups', N'P') IS NULL
  OR OBJECT_ID(N'identity.read_group_session', N'P') IS NULL
  OR OBJECT_ID(N'governance.assert_group_admin', N'P') IS NULL
  OR DATABASE_PRINCIPAL_ID(N'platform_governance_browser') IS NULL
  THROW 50000, N'Tenant group procedures or roles are incomplete.', 1;

IF NOT EXISTS (
  SELECT 1 FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id = OBJECT_ID(N'governance.assert_group_admin')
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_governance_browser')
) THROW 50000, N'platform_governance_browser cannot execute the group fence.', 1;

IF (
  SELECT COUNT(*) FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id IN (OBJECT_ID(N'identity.list_current_groups'), OBJECT_ID(N'identity.read_group_session'))
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_identity_runtime')
) <> 2 THROW 50000, N'platform_identity_runtime cannot execute the group read procedures.', 1;

IF EXISTS (
  SELECT 1 FROM sys.database_permissions AS permission
  INNER JOIN sys.database_principals AS grantee ON grantee.principal_id = permission.grantee_principal_id
  WHERE grantee.name = N'platform_governance_browser'
    AND permission.permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'SELECT')
) THROW 50000, N'platform_governance_browser must not touch tables directly.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'identity.read_group_session')) NOT LIKE N'%status = N''current''%'
  OR OBJECT_DEFINITION(OBJECT_ID(N'identity.read_group_session')) NOT LIKE N'%status = N''active''%'
  THROW 50000, N'read_group_session does not filter on current admins of active groups.', 1;

BEGIN TRANSACTION;

DECLARE @suffix nvarchar(36) = CONVERT(nvarchar(36), NEWID());
DECLARE @issuer nvarchar(512) = N'https://verify.invalid';
DECLARE @tenant uniqueidentifier = NEWID();
DECLARE @admin uniqueidentifier = NEWID();
DECLARE @revoked uniqueidentifier = NEWID();
DECLARE @outsider uniqueidentifier = NEWID();
DECLARE @group uniqueidentifier = NEWID();
DECLARE @suspended uniqueidentifier = NEWID();

INSERT INTO [identity].tenants (id, slug, status) VALUES (@tenant, N'verify-' + @suffix, N'active');
INSERT INTO [identity].users (id, issuer, subject) VALUES
  (@admin, @issuer, N'admin-' + @suffix),
  (@revoked, @issuer, N'revoked-' + @suffix),
  (@outsider, @issuer, N'outsider-' + @suffix);
INSERT INTO [identity].tenant_groups (id, name, status, created_by) VALUES
  (@group, N'Verify group', N'active', @admin),
  (@suspended, N'Verify suspended', N'suspended', @admin);
INSERT INTO [identity].tenant_group_members (group_id, tenant_id, joined_by) VALUES (@group, @tenant, @admin);
INSERT INTO [identity].tenant_group_admins (group_id, user_id, status, granted_by) VALUES
  (@group, @admin, N'current', @admin),
  (@suspended, @admin, N'current', @admin),
  (@group, @revoked, N'revoked', @admin);

DECLARE @listed TABLE (group_id uniqueidentifier, name nvarchar(128), group_epoch bigint, admin_epoch bigint, billing_tenant_id uniqueidentifier NULL, tenant_id uniqueidentifier NULL);

DECLARE @subject nvarchar(256) = N'admin-' + @suffix;
INSERT INTO @listed EXEC [identity].list_current_groups @issuer, @subject;
IF (SELECT COUNT(*) FROM @listed) <> 1
  OR NOT EXISTS (SELECT 1 FROM @listed WHERE group_id = @group AND tenant_id = @tenant AND group_epoch = 1 AND admin_epoch = 1)
  THROW 50000, N'A current admin must see exactly their active group and its workspace.', 1;

DELETE FROM @listed;
SET @subject = N'revoked-' + @suffix;
INSERT INTO @listed EXEC [identity].list_current_groups @issuer, @subject;
IF EXISTS (SELECT 1 FROM @listed) THROW 50000, N'A revoked admin must not see the group.', 1;

DELETE FROM @listed;
SET @subject = N'outsider-' + @suffix;
INSERT INTO @listed EXEC [identity].list_current_groups @issuer, @subject;
IF EXISTS (SELECT 1 FROM @listed) THROW 50000, N'A user in no group must see no groups.', 1;

EXEC [governance].assert_group_admin @group, @admin, 1, 1;

DECLARE @denied bit = 1;
BEGIN TRY EXEC [governance].assert_group_admin @group, @admin, 2, 1; SET @denied = 0; END TRY
BEGIN CATCH IF ERROR_NUMBER() <> 50001 THROW; END CATCH;
IF @denied = 0 THROW 50000, N'assert_group_admin accepted a wrong group epoch.', 1;

BEGIN TRY EXEC [governance].assert_group_admin @group, @admin, 1, 2; SET @denied = 0; END TRY
BEGIN CATCH IF ERROR_NUMBER() <> 50001 THROW; END CATCH;
IF @denied = 0 THROW 50000, N'assert_group_admin accepted a wrong admin epoch.', 1;

BEGIN TRY EXEC [governance].assert_group_admin @group, @revoked, 1, 1; SET @denied = 0; END TRY
BEGIN CATCH IF ERROR_NUMBER() <> 50001 THROW; END CATCH;
IF @denied = 0 THROW 50000, N'assert_group_admin accepted a revoked admin.', 1;

BEGIN TRY EXEC [governance].assert_group_admin @suspended, @admin, 1, 1; SET @denied = 0; END TRY
BEGIN CATCH IF ERROR_NUMBER() <> 50001 THROW; END CATCH;
IF @denied = 0 THROW 50000, N'assert_group_admin accepted a suspended group.', 1;

ROLLBACK TRANSACTION;

SELECT N'012_tenant_groups' AS migration, N'passed' AS status;
