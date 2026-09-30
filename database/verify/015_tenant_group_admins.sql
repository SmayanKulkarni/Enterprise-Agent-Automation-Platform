SET NOCOUNT ON;

IF OBJECT_ID(N'governance.add_admin', N'P') IS NULL
  OR OBJECT_ID(N'governance.remove_admin', N'P') IS NULL
  OR OBJECT_ID(N'governance.set_billing_tenant', N'P') IS NULL
  OR OBJECT_ID(N'governance.read_members', N'P') IS NULL
  THROW 50000, N'Tenant group admin objects are incomplete.', 1;

IF (
  SELECT COUNT(*) FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id IN (OBJECT_ID(N'governance.add_admin'), OBJECT_ID(N'governance.remove_admin'), OBJECT_ID(N'governance.set_billing_tenant'), OBJECT_ID(N'governance.read_members'))
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_governance_browser')
) <> 4 THROW 50000, N'platform_governance_browser cannot execute the group admin procedures.', 1;

IF EXISTS (
  SELECT 1 FROM sys.database_permissions AS permission
  INNER JOIN sys.database_principals AS grantee ON grantee.principal_id = permission.grantee_principal_id
  WHERE grantee.name = N'platform_governance_browser'
    AND permission.permission_name IN (N'INSERT', N'UPDATE', N'DELETE', N'SELECT')
) THROW 50000, N'platform_governance_browser must not touch tables directly.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'governance.read_members')) NOT LIKE N'%TOP (200)%'
  THROW 50000, N'read_members must cap the eligible co-admin list at 200 rows.', 1;

IF OBJECT_ID(N'tempdb..#verify_member') IS NOT NULL DROP PROCEDURE #verify_member;
IF OBJECT_ID(N'tempdb..#verify_group') IS NOT NULL DROP PROCEDURE #verify_group;
IF OBJECT_ID(N'tempdb..#verify_second_workspace') IS NOT NULL DROP PROCEDURE #verify_second_workspace;

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
  INSERT INTO [identity].group_admin_grants (group_id, tenant_id, membership_id, created_membership, created_profile)
  SELECT @group_id, @tenant_id, id, 0, 0 FROM [identity].memberships WHERE tenant_id = @tenant_id AND user_id = @user_id;
END;
');

EXEC(N'
CREATE PROCEDURE #verify_second_workspace @group_id uniqueidentifier, @tenant_id uniqueidentifier, @user_id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  EXEC #verify_member @tenant_id, @user_id, N''admin'';
  INSERT INTO [identity].tenant_group_members (group_id, tenant_id, joined_by) VALUES (@group_id, @tenant_id, @user_id);
  INSERT INTO [identity].group_admin_grants (group_id, tenant_id, membership_id, created_membership, created_profile)
  SELECT @group_id, @tenant_id, id, 0, 0 FROM [identity].memberships WHERE tenant_id = @tenant_id AND user_id = @user_id;
END;
');

DECLARE @digest_a char(64) = REPLICATE('a', 64);
DECLARE @digest_b char(64) = REPLICATE('b', 64);
DECLARE @receipt nvarchar(max) = N'{"ok":true}';
DECLARE @u1 uniqueidentifier = NEWID(), @u2 uniqueidentifier = NEWID(), @u3 uniqueidentifier = NEWID();
DECLARE @t1 uniqueidentifier = NEWID(), @t2 uniqueidentifier = NEWID(), @t3 uniqueidentifier = NEWID();
DECLARE @g uniqueidentifier = NEWID();
DECLARE @k1 uniqueidentifier = NEWID(), @k2 uniqueidentifier = NEWID(), @k3 uniqueidentifier = NEWID(), @k4 uniqueidentifier = NEWID();
DECLARE @r TABLE (receipt_json nvarchar(max), replayed bit);
DECLARE @error int, @before_t1 bigint, @before_t2 bigint;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_second_workspace @g, @t2, @u1;
EXEC #verify_member @t1, @u2, N'operator';
EXEC #verify_member @t3, @u3, N'admin';

INSERT INTO @r EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @candidate_user_id = @u2, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 0)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_groups WHERE id = @g AND epoch = 2)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_group_admins WHERE group_id = @g AND user_id = @u2 AND status = N'current' AND epoch = 1 AND granted_by = @u1)
  OR (
    SELECT COUNT(*) FROM [identity].memberships AS m
    INNER JOIN [identity].membership_profiles AS p ON p.membership_id = m.id AND p.tenant_id = m.tenant_id AND p.profile_key = N'admin'
    WHERE m.user_id = @u2 AND m.tenant_id IN (@t1, @t2) AND m.status = N'current'
  ) <> 2
  OR NOT EXISTS (SELECT 1 FROM [identity].group_admin_grants AS x INNER JOIN [identity].memberships AS m ON m.id = x.membership_id WHERE x.group_id = @g AND x.tenant_id = @t1 AND m.user_id = @u2 AND x.created_membership = 0 AND x.created_profile = 1)
  OR NOT EXISTS (SELECT 1 FROM [identity].group_admin_grants AS x INNER JOIN [identity].memberships AS m ON m.id = x.membership_id WHERE x.group_id = @g AND x.tenant_id = @t2 AND m.user_id = @u2 AND x.created_membership = 1 AND x.created_profile = 1)
  THROW 50000, N'add_admin did not materialize admin rights in every group workspace and bump the group epoch.', 1;

DELETE FROM @r;
INSERT INTO @r EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @candidate_user_id = @u2, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 1)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_groups WHERE id = @g AND epoch = 2)
  OR (SELECT COUNT(*) FROM [governance].command_receipts WHERE actor_user_id = @u1 AND idempotency_key = @k1) <> 1
  THROW 50000, N'A replay with the old epoch must return the stored receipt and change nothing.', 1;

SELECT @before_t1 = epoch FROM [identity].memberships WHERE tenant_id = @t1 AND user_id = @u2;
SELECT @before_t2 = epoch FROM [identity].memberships WHERE tenant_id = @t2 AND user_id = @u2;

DELETE FROM @r;
INSERT INTO @r EXEC [governance].remove_admin @group_id = @g, @user_id = @u1, @group_epoch = 2, @admin_epoch = 1, @target_user_id = @u2, @idempotency_key = @k2, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 0)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_groups WHERE id = @g AND epoch = 3)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_group_admins WHERE group_id = @g AND user_id = @u2 AND status = N'revoked' AND epoch = 2)
  OR EXISTS (SELECT 1 FROM [identity].group_admin_grants AS x INNER JOIN [identity].memberships AS m ON m.id = x.membership_id WHERE x.group_id = @g AND m.user_id = @u2)
  OR EXISTS (SELECT 1 FROM [identity].membership_profiles AS p INNER JOIN [identity].memberships AS m ON m.id = p.membership_id WHERE m.tenant_id = @t2 AND m.user_id = @u2)
  OR NOT EXISTS (SELECT 1 FROM [identity].memberships WHERE tenant_id = @t2 AND user_id = @u2 AND status = N'revoked' AND epoch = @before_t2 + 1)
  OR EXISTS (SELECT 1 FROM [identity].membership_profiles AS p INNER JOIN [identity].memberships AS m ON m.id = p.membership_id WHERE m.tenant_id = @t1 AND m.user_id = @u2 AND p.profile_key = N'admin')
  THROW 50000, N'remove_admin did not revoke the group-created rights and bump the epochs.', 1;
IF NOT EXISTS (SELECT 1 FROM [identity].memberships AS m INNER JOIN [identity].membership_profiles AS p ON p.membership_id = m.id AND p.tenant_id = m.tenant_id AND p.profile_key = N'operator' WHERE m.tenant_id = @t1 AND m.user_id = @u2 AND m.status = N'current' AND m.epoch = @before_t1 + 1)
  THROW 50000, N'remove_admin took away a profile the user held directly.', 1;

DELETE FROM @r;
INSERT INTO @r EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 3, @admin_epoch = 1, @candidate_user_id = @u2, @idempotency_key = @k3, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 0)
  OR (SELECT COUNT(*) FROM [identity].tenant_group_admins WHERE group_id = @g AND user_id = @u2) <> 1
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_group_admins WHERE group_id = @g AND user_id = @u2 AND status = N'current' AND epoch = 3)
  OR NOT EXISTS (SELECT 1 FROM [identity].memberships AS m INNER JOIN [identity].membership_profiles AS p ON p.membership_id = m.id AND p.tenant_id = m.tenant_id AND p.profile_key = N'admin' WHERE m.tenant_id = @t2 AND m.user_id = @u2 AND m.status = N'current')
  THROW 50000, N'add_admin must re-activate a revoked admin row instead of inserting a new one.', 1;

DELETE FROM @r;
INSERT INTO @r EXEC [governance].remove_admin @group_id = @g, @user_id = @u1, @group_epoch = 4, @admin_epoch = 1, @target_user_id = @u1, @idempotency_key = @k4, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 0)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_group_admins WHERE group_id = @g AND user_id = @u1 AND status = N'revoked')
  OR EXISTS (SELECT 1 FROM [identity].group_admin_grants AS x INNER JOIN [identity].memberships AS m ON m.id = x.membership_id WHERE x.group_id = @g AND m.user_id = @u1)
  OR (
    SELECT COUNT(*) FROM [identity].memberships AS m
    INNER JOIN [identity].membership_profiles AS p ON p.membership_id = m.id AND p.tenant_id = m.tenant_id AND p.profile_key = N'admin'
    WHERE m.user_id = @u1 AND m.tenant_id IN (@t1, @t2) AND m.status = N'current'
  ) <> 2
  THROW 50000, N'A self-removed admin must lose only group-created rights and keep directly held profiles.', 1;
ROLLBACK TRANSACTION;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_member @t1, @u2, N'operator';
SET @error = NULL;
BEGIN TRY
  EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @candidate_user_id = @u3, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50002 THROW 50000, N'add_admin must refuse a user with no membership in any group workspace.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_member @t1, @u2, N'operator';
UPDATE [identity].memberships SET status = N'revoked' WHERE tenant_id = @t1 AND user_id = @u2;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @candidate_user_id = @u2, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50002 THROW 50000, N'add_admin must refuse a user whose membership is revoked.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @candidate_user_id = @u1, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50004 THROW 50000, N'add_admin must refuse a user who is already a current admin.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_member @t1, @u2, N'operator';
INSERT INTO [identity].users (id, issuer, subject)
SELECT TOP (19) NEWID(), N'https://verify.invalid', CONVERT(nvarchar(36), NEWID()) FROM sys.all_objects;
INSERT INTO [identity].tenant_group_admins (group_id, user_id, status, granted_by)
SELECT @g, x.id, N'current', @u1 FROM [identity].users AS x WHERE x.issuer = N'https://verify.invalid' AND x.id NOT IN (@u1, @u2, @u3);
IF (SELECT COUNT(*) FROM [identity].tenant_group_admins WHERE group_id = @g AND status = N'current') <> 20
  THROW 50000, N'The admin limit case did not seed 20 current admins.', 1;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @candidate_user_id = @u2, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50004 THROW 50000, N'add_admin must refuse a 21st current admin.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].remove_admin @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @target_user_id = @u1, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50004 THROW 50000, N'remove_admin must refuse to remove the last current admin.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_member @t1, @u2, N'operator';
SET @error = NULL;
BEGIN TRY
  EXEC [governance].remove_admin @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @target_user_id = @u2, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50002 THROW 50000, N'remove_admin must refuse a user who is not a current admin.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_member @t1, @u2, N'operator';
SET @error = NULL;
BEGIN TRY
  EXEC [governance].add_admin @group_id = @g, @user_id = @u2, @group_epoch = 1, @admin_epoch = 1, @candidate_user_id = @u2, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'add_admin must refuse a caller who is not a group admin.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_member @t1, @u2, N'operator';
SET @error = NULL;
BEGIN TRY
  EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 0, @admin_epoch = 1, @candidate_user_id = @u2, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50003 THROW 50000, N'add_admin must refuse a stale group epoch.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_member @t1, @u2, N'operator';
INSERT INTO @r EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @candidate_user_id = @u2, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].add_admin @group_id = @g, @user_id = @u1, @group_epoch = 2, @admin_epoch = 1, @candidate_user_id = @u2, @idempotency_key = @k1, @request_digest = @digest_b, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50004 THROW 50000, N'The same idempotency key with another digest must throw 50004.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_second_workspace @g, @t2, @u1;
DELETE FROM @r;
INSERT INTO @r EXEC [governance].set_billing_tenant @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @tenant_id = @t2, @idempotency_key = @k1, @request_digest = @digest_a, @receipt_json = @receipt;
IF NOT EXISTS (SELECT 1 FROM @r WHERE replayed = 0)
  OR NOT EXISTS (SELECT 1 FROM [identity].tenant_groups WHERE id = @g AND epoch = 2 AND billing_tenant_id = @t2)
  THROW 50000, N'set_billing_tenant did not set the billing workspace and bump the epoch.', 1;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].set_billing_tenant @group_id = @g, @user_id = @u1, @group_epoch = 2, @admin_epoch = 1, @tenant_id = @t3, @idempotency_key = @k2, @request_digest = @digest_a, @receipt_json = @receipt;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50002 THROW 50000, N'set_billing_tenant must refuse a workspace that is not a member.', 1;

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_member @t1, @u2, N'operator';
INSERT INTO [identity].users (id, issuer, subject)
SELECT TOP (205) NEWID(), N'https://verify.invalid', CONVERT(nvarchar(36), NEWID()) FROM sys.all_objects AS a CROSS JOIN sys.all_objects AS b;
INSERT INTO [identity].memberships (id, tenant_id, user_id, status)
SELECT NEWID(), @t1, x.id, N'current' FROM [identity].users AS x WHERE x.issuer = N'https://verify.invalid' AND NOT EXISTS (SELECT 1 FROM [identity].memberships AS m WHERE m.tenant_id = @t1 AND m.user_id = x.id);
EXEC [governance].read_members @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1;
SET @error = NULL;
BEGIN TRY
  EXEC [governance].read_members @group_id = @g, @user_id = @u2, @group_epoch = 1, @admin_epoch = 1;
END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
ROLLBACK TRANSACTION;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_members must refuse a caller who is not a group admin.', 1;

DROP PROCEDURE #verify_second_workspace;
DROP PROCEDURE #verify_group;
DROP PROCEDURE #verify_member;

SELECT N'015_tenant_group_admins' AS migration, N'passed' AS status;
