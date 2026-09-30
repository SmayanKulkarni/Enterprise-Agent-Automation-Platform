SET NOCOUNT ON;

IF OBJECT_ID(N'governance.read_pending_approvals', N'P') IS NULL
  OR OBJECT_ID(N'governance.read_health', N'P') IS NULL
  THROW 50000, N'Governance attention procedures are incomplete.', 1;

IF (
  SELECT COUNT(*) FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id IN (OBJECT_ID(N'governance.read_pending_approvals'), OBJECT_ID(N'governance.read_health'))
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_governance_browser')
) <> 2 THROW 50000, N'platform_governance_browser cannot execute the governance attention procedures.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'governance.read_pending_approvals')) NOT LIKE N'%TOP (200)%'
  OR OBJECT_DEFINITION(OBJECT_ID(N'governance.read_health')) NOT LIKE N'%TOP (100)%'
  THROW 50000, N'The attention procedures must cap their result sets.', 1;

IF (
  SELECT COUNT(*) FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID(N'governance.read_pending_approvals'), 0)
  WHERE name IN (N'tenant_id', N'slug', N'run_id', N'run_version', N'definition_revision', N'workflow_name', N'waiting_json', N'waiting_kind')
) <> 8 OR (
  SELECT COUNT(*) FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID(N'governance.read_pending_approvals'), 0)
) <> 8 THROW 50000, N'read_pending_approvals must expose exactly the allowlisted columns and never data_json.', 1;

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



EXEC(N'
CREATE PROCEDURE #verify_waiting @tenant_id uniqueidentifier, @run_id uniqueidentifier, @definition_id uniqueidentifier, @expires_minutes int, @binding char(64), @kind nvarchar(16)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @expires datetime2(7) = DATEADD(minute, @expires_minutes, SYSUTCDATETIME());
  DECLARE @data nvarchar(max) = CONCAT(N''{"definitionId":"'', @definition_id, N''","definitionRevision":3,"input":{"secret":"SECRET_INPUT"},"outputs":{"agent":{"note":"SECRET_OUTPUT"}},"waiting":{"nodeId":"agent","bindingDigest":"'', @binding, N''","expiresAt":"'', CONVERT(nvarchar(33), @expires, 126), N''Z","review":{"revision":3,"installationId":"'', NEWID(), N''","capability":"write","target":"crm","argumentsDigest":"'', @binding, N''","arguments":[{"name":"q","type":"string"}]}},"history":[{"nodeId":"trigger","kind":"trigger","state":"completed"},{"nodeId":"agent","kind":"'', @kind, N''","state":"waiting"}]}'');
  INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json) VALUES (@tenant_id, N''run'', @run_id, 5, N''waiting-approval'', @data);
  INSERT INTO [workflow].run_facts (tenant_id, run_id, definition_id, stable_definition_id, owner_id, trigger_kind, status, started_at, waiting_binding_digest, waiting_expires_at)
  VALUES (@tenant_id, @run_id, @definition_id, @definition_id, N''verify'', N''manual'', N''waiting-approval'', SYSUTCDATETIME(), @binding, @expires);
END;
');

DECLARE @u1 uniqueidentifier = NEWID(), @u2 uniqueidentifier = NEWID();
DECLARE @t1 uniqueidentifier = NEWID(), @t2 uniqueidentifier = NEWID(), @t3 uniqueidentifier = NEWID();
DECLARE @g uniqueidentifier = NEWID(), @def uniqueidentifier = NEWID();
DECLARE @run_late uniqueidentifier = NEWID(), @run_soon uniqueidentifier = NEWID(), @run_expired uniqueidentifier = NEWID(), @run_outside uniqueidentifier = NEWID();
DECLARE @binding char(64) = REPLICATE('c', 64);
DECLARE @error int;
DECLARE @pending TABLE (tenant_id uniqueidentifier, slug nvarchar(128), run_id uniqueidentifier, run_version bigint, definition_revision nvarchar(max), workflow_name nvarchar(max), waiting_json nvarchar(max), waiting_kind nvarchar(max), seq int IDENTITY(1,1) NOT NULL);

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_second_workspace @g, @t2, @u1;
EXEC #verify_member @t1, @u2, N'operator';
EXEC #verify_member @t3, @u1, N'admin';

SET @error = NULL;
BEGIN TRY EXEC [governance].read_pending_approvals @group_id = @g, @user_id = @u2, @group_epoch = 1, @admin_epoch = 1; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_pending_approvals must refuse a caller who is not a group admin.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_health @group_id = @g, @user_id = @u2, @group_epoch = 1, @admin_epoch = 1; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_health must refuse a caller who is not a group admin.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_health @group_id = @g, @user_id = @u1, @group_epoch = 0, @admin_epoch = 1; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_health must refuse a wrong group epoch.', 1;

EXEC #verify_waiting @t1, @run_late, @def, 120, @binding, N'agent';
EXEC #verify_waiting @t2, @run_soon, @def, 30, @binding, N'approval';
EXEC #verify_waiting @t1, @run_expired, @def, -60, @binding, N'agent';
EXEC #verify_waiting @t3, @run_outside, @def, 10, @binding, N'agent';

INSERT INTO @pending (tenant_id, slug, run_id, run_version, definition_revision, workflow_name, waiting_json, waiting_kind) EXEC [governance].read_pending_approvals @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1;
IF (SELECT COUNT(*) FROM @pending) <> 2 THROW 50000, N'read_pending_approvals must return only unexpired waiting runs of member workspaces.', 1;
IF EXISTS (SELECT 1 FROM @pending WHERE run_id IN (@run_expired, @run_outside)) THROW 50000, N'read_pending_approvals returned an expired run or a run outside the group.', 1;
IF (SELECT run_id FROM @pending WHERE seq = (SELECT MIN(seq) FROM @pending)) <> @run_soon THROW 50000, N'read_pending_approvals must order by soonest expiry.', 1;
IF NOT EXISTS (SELECT 1 FROM @pending WHERE run_id = @run_soon AND waiting_kind = N'approval' AND run_version = 5 AND definition_revision = N'3' AND waiting_json LIKE N'%' + @binding + N'%')
  OR NOT EXISTS (SELECT 1 FROM @pending WHERE run_id = @run_late AND waiting_kind = N'agent')
  THROW 50000, N'read_pending_approvals did not return the waiting object, version and kind.', 1;
IF EXISTS (SELECT 1 FROM @pending WHERE waiting_json LIKE N'%SECRET_%') THROW 50000, N'read_pending_approvals leaked run input or outputs.', 1;

EXEC [governance].read_health @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1;
ROLLBACK TRANSACTION;

DROP PROCEDURE #verify_waiting;
DROP PROCEDURE #verify_second_workspace;
DROP PROCEDURE #verify_group;
DROP PROCEDURE #verify_member;

SELECT N'017_governance_attention' AS migration, N'passed' AS status;
