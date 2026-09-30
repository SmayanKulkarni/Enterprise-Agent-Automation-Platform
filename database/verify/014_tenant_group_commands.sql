SET NOCOUNT ON;

IF OBJECT_ID(N'governance.command_receipts', N'U') IS NULL
  OR OBJECT_ID(N'governance.grant_tenant_admin', N'P') IS NULL
  OR OBJECT_ID(N'governance.revoke_tenant_admin', N'P') IS NULL
  OR OBJECT_ID(N'governance.create_group', N'P') IS NULL
  OR OBJECT_ID(N'governance.add_tenant', N'P') IS NULL
  OR OBJECT_ID(N'governance.remove_tenant', N'P') IS NULL
  THROW 50000, N'Tenant group command objects are incomplete.', 1;

IF (
  SELECT COUNT(*) FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id IN (OBJECT_ID(N'governance.create_group'), OBJECT_ID(N'governance.add_tenant'), OBJECT_ID(N'governance.remove_tenant'))
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_governance_browser')
) <> 3 THROW 50000, N'platform_governance_browser cannot execute the group commands.', 1;

IF EXISTS (
  SELECT 1 FROM sys.database_permissions
  WHERE class = 1 AND major_id IN (OBJECT_ID(N'governance.grant_tenant_admin'), OBJECT_ID(N'governance.revoke_tenant_admin'))
    AND grantee_principal_id <> DATABASE_PRINCIPAL_ID(N'dbo')
) THROW 50000, N'Internal group helpers must not be granted to any role.', 1;

IF EXISTS (
  SELECT 1 FROM sys.database_permissions AS permission
  INNER JOIN sys.database_principals AS grantee ON grantee.principal_id = permission.grantee_principal_id
  WHERE grantee.name = N'platform_governance_browser'
    AND permission.permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'SELECT')
) THROW 50000, N'platform_governance_browser must not touch tables directly.', 1;

IF OBJECT_ID(N'tempdb..#verify_member') IS NOT NULL DROP PROCEDURE #verify_member;
IF OBJECT_ID(N'tempdb..#verify_group') IS NOT NULL DROP PROCEDURE #verify_group;

EXEC(N'
CREATE PROCEDURE #verify_member @tenant_id uniqueidentifier, @user_id uniqueidentifier, @profile nvarchar(32) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @membership_id uniqueidentifier = NEWID();
  IF NOT EXISTS (SELECT 1 FROM [identity].tenants WHERE id = @tenant_id)
    INSERT INTO [identity].tenants (id, slug, status) VALUES (@tenant_id, N''verify-'' + CONVERT(nvarchar(36), @tenant_id), N''active'');
  IF NOT EXISTS (SELECT 1 FROM [identity].users WHERE id = @user_id)
    INSERT INTO [identity].users (id, issuer, subject) VALUES (@user_id, N''https://verify.invalid'', CONVERT(nvarchar(36), @user_id));
  INSERT INTO [identity].memberships (id, tenant_id, user_id, status) VALUES (@membership_id, @tenant_id, @user_id, N''current'');
  IF @profile IS NOT NULL
    INSERT INTO [identity].membership_profiles (tenant_id, membership_id, profile_key) VALUES (@tenant_id, @membership_id, @profile);
END;
');

EXEC(N'
CREATE PROCEDURE #verify_group @group_id uniqueidentifier, @tenant_id uniqueidentifier, @user_id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  EXEC #verify_member @tenant_id, @user_id, N''admin'';
  INSERT INTO [identity].tenant_groups (id, name, status, created_by) VALUES (@group_id, N''Verify group'', N''active'', @user_id);
  INSERT INTO [identity].tenant_group_members (group_id, tenant_id, joined_by) VALUES (@group_id, @tenant_id, @user_id);
  INSERT INTO [identity].tenant_group_admins (group_id, user_id, status, granted_by) VALUES (@group_id, @user_id, N''current'', @user_id);
END;
');

DECLARE @digest_a char(64) = REPLICATE('a', 64);
DECLARE @digest_b char(64) = REPLICATE('b', 64);
DECLARE @receipt nvarchar(max) = N'{"ok":true}';
DECLARE @u1 uniqueidentifier = NEWID(), @u2 uniqueidentifier = NEWID();
DECLARE @t1 uniqueidentifier = NEWID(), @t2 uniqueidentifier = NEWID();
DECLARE @g uniqueidentifier = NEWID(), @k2 uniqueidentifier = NEWID(), @k3 uniqueidentifier = NEWID();
DECLARE @one nvarchar(max) = CONCAT(N'["', @t1, N'"]');
DECLARE @r TABLE (receipt_json nvarchar(max), replayed bit);
DECLARE @error int, @before bigint;

BEGIN TRANSACTION;

EXEC #verify_member @t1, @u1, N'admin';
EXEC #verify_member @t2, @u1, N'admin';

INSERT INTO @r EXEC [governance].create_group @user_id = @u1, @name = N'  Verify group  ', @tenant_ids = @one, @billing_tenant_id = NULL, @idempotency_key = @g, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 0)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_groups WHERE id = @g AND name = N'Verify group' AND epoch = 1 AND status = N'active' AND billing_tenant_id IS NULL)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_group_members WHERE group_id = @g AND tenant_id = @t1)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_group_admins WHERE group_id = @g AND user_id = @u1 AND status = N'current' AND epoch = 1)
  OR NOT EXISTS (SELECT 1 FROM [identity].group_admin_grants AS x INNER JOIN [identity].memberships AS m ON m.id = x.membership_id WHERE x.group_id = @g AND x.tenant_id = @t1 AND m.user_id = @u1 AND x.created_membership = 0 AND x.created_profile = 0)
  THROW 50000, N'create_group did not materialize the group, its member, its admin and the creator grant.', 1;

INSERT INTO [identity].users (id, issuer, subject) VALUES (@u2, N'https://verify.invalid', CONVERT(nvarchar(36), @u2));
INSERT INTO [identity].tenant_group_admins (group_id, user_id, status, granted_by) VALUES (@g, @u2, N'current', @u1);

DELETE FROM @r;
INSERT INTO @r EXEC [governance].add_tenant @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @tenant_id = @t2, @idempotency_key = @k2, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 0)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_groups WHERE id = @g AND epoch = 2)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_group_members WHERE group_id = @g AND tenant_id = @t2)
  OR NOT EXISTS (
    SELECT 1 FROM [identity].memberships AS m
    INNER JOIN [identity].membership_profiles AS p ON p.membership_id = m.id AND p.tenant_id = m.tenant_id AND p.profile_key = N'admin'
    WHERE m.tenant_id = @t2 AND m.user_id = @u2 AND m.status = N'current'
  )
  OR NOT EXISTS (SELECT 1 FROM [identity].group_admin_grants AS x INNER JOIN [identity].memberships AS m ON m.id = x.membership_id WHERE x.group_id = @g AND x.tenant_id = @t2 AND m.user_id = @u2 AND x.created_membership = 1 AND x.created_profile = 1)
  OR NOT EXISTS (SELECT 1 FROM [identity].group_admin_grants AS x INNER JOIN [identity].memberships AS m ON m.id = x.membership_id WHERE x.group_id = @g AND x.tenant_id = @t2 AND m.user_id = @u1 AND x.created_membership = 0 AND x.created_profile = 0)
  THROW 50000, N'add_tenant did not bump the epoch or materialize admin rights for every group admin.', 1;

DELETE FROM @r;
INSERT INTO @r EXEC [governance].add_tenant @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @tenant_id = @t2, @idempotency_key = @k2, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 1)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_groups WHERE id = @g AND epoch = 2)
  OR (SELECT COUNT(*) FROM [governance].command_receipts WHERE actor_user_id = @u1 AND idempotency_key = @k2) <> 1
  THROW 50000, N'A replay with the old epoch must return the stored receipt and change nothing.', 1;

UPDATE [identity].tenant_groups SET billing_tenant_id = @t2 WHERE id = @g;
SELECT @before = epoch FROM [identity].memberships WHERE tenant_id = @t2 AND user_id = @u2;

DELETE FROM @r;
INSERT INTO @r EXEC [governance].remove_tenant @group_id = @g, @user_id = @u1, @group_epoch = 2, @admin_epoch = 1, @tenant_id = @t2, @idempotency_key = @k3, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 0)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_groups WHERE id = @g AND epoch = 3 AND billing_tenant_id IS NULL)
  OR EXISTS (SELECT 1 FROM [identity].tenant_group_members WHERE group_id = @g AND tenant_id = @t2)
  OR EXISTS (SELECT 1 FROM [identity].group_admin_grants WHERE group_id = @g AND tenant_id = @t2)
  OR NOT EXISTS (SELECT 1 FROM [identity].memberships WHERE tenant_id = @t2 AND user_id = @u2 AND status = N'revoked' AND epoch = @before + 1)
  OR EXISTS (SELECT 1 FROM [identity].membership_profiles AS p INNER JOIN [identity].memberships AS m ON m.id = p.membership_id WHERE m.tenant_id = @t2 AND m.user_id = @u2)
  THROW 50000, N'remove_tenant did not revoke the group-created rights, bump the epoch and clear billing.', 1;
IF NOT EXISTS (
  SELECT 1 FROM [identity].memberships AS m
  INNER JOIN [identity].membership_profiles AS p ON p.membership_id = m.id AND p.tenant_id = m.tenant_id AND p.profile_key = N'admin'
  WHERE m.tenant_id = @t2 AND m.user_id = @u1 AND m.status = N'current'
) THROW 50000, N'remove_tenant took away the rights of a direct admin.', 1;

SET @error = NULL;
BEGIN TRY
  EXEC [governance].remove_tenant @group_id = @g, @user_id = @u1, @group_epoch = 2, @admin_epoch = 1, @tenant_id = @t2, @idempotency_key = @k3, @request_digest = @digest_b, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50004 THROW 50000, N'The same idempotency key with another digest must throw 50004.', 1;

BEGIN TRANSACTION;
EXEC #verify_member @t1, @u1, NULL;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].create_group @user_id = @u1, @name = N'Verify group', @tenant_ids = @one, @billing_tenant_id = NULL, @idempotency_key = @g, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'create_group must refuse a caller who does not administer a listed workspace.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @k3, @t1, @u1;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].create_group @user_id = @u1, @name = N'Verify group', @tenant_ids = @one, @billing_tenant_id = NULL, @idempotency_key = @g, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50004 THROW 50000, N'create_group must refuse a workspace that already belongs to a group.', 1;

DECLARE @big nvarchar(max) = (SELECT N'[' + STRING_AGG(N'"' + CONVERT(nvarchar(36), NEWID()) + N'"', N',') + N']' FROM (SELECT TOP (51) 1 AS n FROM sys.all_objects) AS x);
SET @error = NULL;
BEGIN TRY
  EXEC [governance].create_group @user_id = @u1, @name = N'Verify group', @tenant_ids = @big, @billing_tenant_id = NULL, @idempotency_key = @g, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50002 THROW 50000, N'create_group must refuse more than 50 workspaces.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @k3, @t1, @u1;
EXEC #verify_member @t2, @u1, NULL;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].add_tenant @group_id = @k3, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @tenant_id = @t2, @idempotency_key = @k2, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'add_tenant must refuse a group admin who does not administer the workspace.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @k3, @t1, @u1;
EXEC #verify_member @t2, @u1, N'admin';
SET @error = NULL;
BEGIN TRY
  EXEC [governance].add_tenant @group_id = @k3, @user_id = @u1, @group_epoch = 0, @admin_epoch = 1, @tenant_id = @t2, @idempotency_key = @k2, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50003 THROW 50000, N'add_tenant must refuse a stale group epoch.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @k3, @t1, @u1;
EXEC #verify_member @t2, @u1, N'admin';
SET @error = NULL;
BEGIN TRY
  EXEC [governance].remove_tenant @group_id = @k3, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @tenant_id = @t2, @idempotency_key = @k2, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50002 THROW 50000, N'remove_tenant must refuse a workspace that is not a member.', 1;

DROP PROCEDURE #verify_group;
DROP PROCEDURE #verify_member;

SELECT N'014_tenant_group_commands' AS migration, N'passed' AS status;
