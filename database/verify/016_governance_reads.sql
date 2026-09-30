SET NOCOUNT ON;

IF OBJECT_ID(N'governance.read_overview', N'P') IS NULL
  OR OBJECT_ID(N'governance.read_run_series', N'P') IS NULL
  OR OBJECT_ID(N'governance.read_workflows', N'P') IS NULL
  THROW 50000, N'Governance read procedures are incomplete.', 1;

IF (
  SELECT COUNT(*) FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id IN (OBJECT_ID(N'governance.read_overview'), OBJECT_ID(N'governance.read_run_series'), OBJECT_ID(N'governance.read_workflows'))
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_governance_browser')
) <> 3 THROW 50000, N'platform_governance_browser cannot execute the governance read procedures.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'governance.read_workflows')) NOT LIKE N'%TOP (100)%'
  THROW 50000, N'read_workflows must cap the portfolio at 100 rows.', 1;

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
CREATE PROCEDURE #verify_fact @tenant_id uniqueidentifier, @definition_id uniqueidentifier, @status nvarchar(32), @started_minutes int, @duration_minutes int, @tokens bigint, @cost decimal(18,6), @estimated bit = 0, @waiting_minutes int = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @started datetime2(7) = DATEADD(minute, @started_minutes, SYSUTCDATETIME());
  INSERT INTO [workflow].run_facts (tenant_id, run_id, definition_id, stable_definition_id, owner_id, trigger_kind, status, started_at, finished_at, tokens, cost, usage_estimated, waiting_expires_at)
  VALUES (@tenant_id, NEWID(), @definition_id, @definition_id, N''verify'', N''manual'', @status, @started, DATEADD(minute, @duration_minutes, @started), @tokens, @cost, @estimated, DATEADD(minute, @waiting_minutes, SYSUTCDATETIME()));
END;
');

DECLARE @u1 uniqueidentifier = NEWID(), @u2 uniqueidentifier = NEWID();
DECLARE @t1 uniqueidentifier = NEWID(), @t2 uniqueidentifier = NEWID(), @t3 uniqueidentifier = NEWID();
DECLARE @g uniqueidentifier = NEWID(), @def1 uniqueidentifier = NEWID(), @def2 uniqueidentifier = NEWID(), @def3 uniqueidentifier = NEWID();
DECLARE @now datetime2(7) = SYSUTCDATETIME();
DECLARE @from datetime2(7) = DATEADD(hour, -1, @now), @to datetime2(7) = DATEADD(minute, 1, @now);
DECLARE @error int;
DECLARE @series TABLE (tenant_id uniqueidentifier, slug nvarchar(128), bucket_start datetime2(7), completed int, failed int, unknown_outcome int, cost decimal(38,6), tokens bigint, estimated_runs int);
DECLARE @workflows TABLE (tenant_id uniqueidentifier, slug nvarchar(128), stable_definition_id uniqueidentifier, name nvarchar(max), runs int, completed int, p95_ms float, cost decimal(38,6), estimated_runs int);

BEGIN TRANSACTION;
EXEC #verify_group @g, @t1, @u1;
EXEC #verify_second_workspace @g, @t2, @u1;
EXEC #verify_member @t1, @u2, N'operator';
EXEC #verify_member @t3, @u1, N'admin';

SET @error = NULL;
BEGIN TRY EXEC [governance].read_overview @group_id = @g, @user_id = @u2, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_overview must refuse a caller who is not a group admin.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_run_series @group_id = @g, @user_id = @u2, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to, @bucket_minutes = 5; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_run_series must refuse a caller who is not a group admin.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_workflows @group_id = @g, @user_id = @u2, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_workflows must refuse a caller who is not a group admin.', 1;

SET @error = NULL;
BEGIN TRY EXEC [governance].read_overview @group_id = @g, @user_id = @u1, @group_epoch = 0, @admin_epoch = 1, @from = @from, @to = @to; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_overview must refuse a wrong group epoch.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_run_series @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 0, @from = @from, @to = @to, @bucket_minutes = 5; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_run_series must refuse a wrong admin epoch.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_workflows @group_id = @g, @user_id = @u1, @group_epoch = 0, @admin_epoch = 1, @from = @from, @to = @to; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_workflows must refuse a wrong group epoch.', 1;

SET @error = NULL;
BEGIN TRY EXEC [governance].read_overview @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to, @tenant_id = @t3; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_overview must refuse a workspace outside the group.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_run_series @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to, @bucket_minutes = 5, @tenant_id = @t3; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_run_series must refuse a workspace outside the group.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_workflows @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to, @tenant_id = @t3; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50001 THROW 50000, N'read_workflows must refuse a workspace outside the group.', 1;

SET @error = NULL;
BEGIN TRY EXEC [governance].read_run_series @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to, @bucket_minutes = 7; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50002 THROW 50000, N'read_run_series must refuse a bucket size outside 1, 5, 60 and 180.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_overview @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = @to, @to = @from; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50002 THROW 50000, N'read_overview must refuse a window that ends before it starts.', 1;
SET @error = NULL;
BEGIN TRY EXEC [governance].read_workflows @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = '2026-01-01', @to = '2026-03-01'; END TRY
BEGIN CATCH SET @error = ERROR_NUMBER(); END CATCH;
IF ISNULL(@error, 0) <> 50002 THROW 50000, N'read_workflows must refuse a window longer than 31 days.', 1;

EXEC #verify_fact @t1, @def1, N'completed', -10, 1, 100, 1.5;
EXEC #verify_fact @t1, @def1, N'failed', -20, 1, 50, 0.5, 1;
EXEC #verify_fact @t1, @def1, N'waiting-approval', -5, NULL, 0, 0, 0, 60;
EXEC #verify_fact @t1, @def1, N'waiting-approval', -6, NULL, 0, 0, 0, -60;
EXEC #verify_fact @t1, @def2, N'completed', -90, 1, 7, 7;
EXEC #verify_fact @t3, @def3, N'completed', -15, 1, 999, 99;

INSERT INTO @series EXEC [governance].read_run_series @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to, @bucket_minutes = 1;
IF (SELECT SUM(completed) FROM @series) <> 1 OR (SELECT SUM(failed) FROM @series) <> 1 OR (SELECT SUM(cost) FROM @series) <> 2.0 OR (SELECT SUM(tokens) FROM @series) <> 150 OR (SELECT SUM(estimated_runs) FROM @series) <> 1
  THROW 50000, N'read_run_series did not total the fact rows of the current window.', 1;
IF EXISTS (SELECT 1 FROM @series WHERE tenant_id = @t3) THROW 50000, N'read_run_series returned a workspace outside the group.', 1;
IF (SELECT COUNT(*) FROM @series) <> 4 THROW 50000, N'read_run_series must return one row per non-empty bucket and workspace.', 1;

INSERT INTO @workflows EXEC [governance].read_workflows @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to;
IF (SELECT COUNT(*) FROM @workflows) <> 1 OR NOT EXISTS (SELECT 1 FROM @workflows WHERE stable_definition_id = @def1 AND tenant_id = @t1 AND runs = 4 AND completed = 1 AND cost = 2.0 AND estimated_runs = 1)
  THROW 50000, N'read_workflows did not group the current window by workflow.', 1;
IF EXISTS (SELECT 1 FROM @workflows WHERE stable_definition_id IN (@def2, @def3)) THROW 50000, N'read_workflows returned a run outside the window or the group.', 1;

EXEC [governance].read_overview @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to;
EXEC [governance].read_overview @group_id = @g, @user_id = @u1, @group_epoch = 1, @admin_epoch = 1, @from = @from, @to = @to, @tenant_id = @t2;
ROLLBACK TRANSACTION;

DROP PROCEDURE #verify_fact;
DROP PROCEDURE #verify_second_workspace;
DROP PROCEDURE #verify_group;
DROP PROCEDURE #verify_member;

SELECT N'016_governance_reads' AS migration, N'passed' AS status;
