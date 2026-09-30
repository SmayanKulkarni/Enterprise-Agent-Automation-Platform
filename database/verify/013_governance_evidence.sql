SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID(N'workflow.run_facts', N'U') IS NULL OR OBJECT_ID(N'workflow.upsert_run_fact', N'P') IS NULL
  THROW 50000, N'Run facts objects are incomplete.', 1;

IF (SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID(N'workflow.run_facts') AND name IN (N'IX_workflow_run_facts_window', N'IX_workflow_run_facts_waiting')) <> 2
  THROW 50000, N'Run facts indexes are incomplete.', 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'workflow.run_facts') AND name = N'usage_estimated')
  THROW 50000, N'Run facts usage_estimated is missing.', 1;

IF EXISTS (
  SELECT 1 FROM sys.database_permissions
  WHERE class = 1 AND major_id = OBJECT_ID(N'workflow.run_facts') AND permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
) THROW 50000, N'No role may write run_facts directly.', 1;

IF EXISTS (
  SELECT 1 FROM sys.database_permissions
  WHERE class = 1 AND major_id = OBJECT_ID(N'workflow.upsert_run_fact')
    AND grantee_principal_id <> DATABASE_PRINCIPAL_ID(N'dbo')
) THROW 50000, N'upsert_run_fact must not be granted to any role.', 1;

IF (
  SELECT COUNT(*) FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND ((major_id = OBJECT_ID(N'workflow.write_record') AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_workflow_browser'))
      OR (major_id = OBJECT_ID(N'workflow.worker_write_record') AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_workflow_worker'))
      OR (major_id = OBJECT_ID(N'workflow.admit_webhook_run') AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_workflow_worker')))
) <> 3 THROW 50000, N'The three run writers lost their grants.', 1;

IF OBJECT_ID(N'tempdb..#worker_out') IS NOT NULL DROP TABLE #worker_out;
IF OBJECT_ID(N'tempdb..#admit_out') IS NOT NULL DROP TABLE #admit_out;
IF OBJECT_ID(N'tempdb..#write_out') IS NOT NULL DROP TABLE #write_out;
CREATE TABLE #worker_out (id uniqueidentifier, kind nvarchar(24), version bigint, state nvarchar(32), data_json nvarchar(max));
CREATE TABLE #admit_out (admitted bit);
CREATE TABLE #write_out (receipt_json nvarchar(max), replayed bit);

BEGIN TRANSACTION;

DECLARE @tenant uniqueidentifier = NEWID(), @user uniqueidentifier = NEWID(), @membership uniqueidentifier = NEWID(),
  @definition uniqueidentifier = NEWID(), @stable uniqueidentifier = NEWID(),
  @run uniqueidentifier = NEWID(), @failed_run uniqueidentifier = NEWID(), @unknown_run uniqueidentifier = NEWID(),
  @webhook_run uniqueidentifier = NEWID(), @browser_run uniqueidentifier = NEWID(), @installation uniqueidentifier = NEWID(),
  @key_run uniqueidentifier = NEWID(), @key_installation uniqueidentifier = NEWID(), @rejected_run uniqueidentifier = NEWID(),
  @tenant_epoch bigint, @membership_epoch bigint, @finished datetime2(7), @json nvarchar(max), @base nvarchar(max),
  @digest char(64) = REPLICATE(N'a', 64), @long nvarchar(200) = REPLICATE(N'x', 100);

INSERT INTO [identity].tenants (id, slug, status) VALUES (@tenant, N'verify-013-' + CONVERT(nvarchar(36), @tenant), N'active');
INSERT INTO [identity].users (id, issuer, subject) VALUES (@user, N'https://verify.invalid', CONVERT(nvarchar(36), @user));
INSERT INTO [identity].memberships (id, tenant_id, user_id, status) VALUES (@membership, @tenant, @user, N'current');
INSERT INTO [identity].membership_profiles (tenant_id, membership_id, profile_key) VALUES (@tenant, @membership, N'editor');
SELECT @tenant_epoch = epoch FROM [identity].tenants WHERE id = @tenant;
SELECT @membership_epoch = epoch FROM [identity].memberships WHERE id = @membership;

SET @base = N'"definitionId":"' + CONVERT(nvarchar(36), @definition) + N'","stableDefinitionId":"' + CONVERT(nvarchar(36), @stable) + N'","ownerId":"' + CONVERT(nvarchar(36), @user) + N'"';

SET @json = N'{' + @base + N',"status":"running","history":[{"nodeId":"a","kind":"agent","state":"failed","detail":"ignored"}],"usage":{"tokens":120,"cost":0.0042}}';
INSERT INTO #worker_out EXEC [workflow].worker_write_record @tenant, N'run', @run, 0, N'running', @json;
IF NOT EXISTS (
  SELECT 1 FROM [workflow].run_facts
  WHERE tenant_id = @tenant AND run_id = @run AND definition_id = @definition AND stable_definition_id = @stable
    AND owner_id = CONVERT(nvarchar(128), @user) AND trigger_kind = N'manual' AND status = N'running' AND reason IS NULL
    AND started_at IS NOT NULL AND finished_at IS NULL AND tokens = 120 AND cost = 0.0042 AND usage_estimated = 0
    AND waiting_binding_digest IS NULL AND waiting_expires_at IS NULL
) THROW 50000, N'worker_write_record did not derive the run fact row.', 1;

SET @json = N'{' + @base + N',"status":"waiting-approval","history":[],"usage":{"tokens":120,"cost":0.0042},"waiting":{"nodeId":"n","bindingDigest":"' + @digest + N'","expiresAt":"2026-01-01T01:00:00.000Z"}}';
INSERT INTO #worker_out EXEC [workflow].worker_write_record @tenant, N'run', @run, 1, N'waiting-approval', @json;
IF NOT EXISTS (
  SELECT 1 FROM [workflow].run_facts
  WHERE tenant_id = @tenant AND run_id = @run AND status = N'waiting-approval' AND finished_at IS NULL
    AND waiting_binding_digest = @digest AND waiting_expires_at = N'2026-01-01T01:00:00'
) THROW 50000, N'A waiting-approval write did not fill the waiting columns.', 1;

SET @json = N'{' + @base + N',"status":"completed","history":[{"nodeId":"a","kind":"agent","state":"failed","detail":"ignored"}]}';
INSERT INTO #worker_out EXEC [workflow].worker_write_record @tenant, N'run', @run, 2, N'completed', @json;
IF NOT EXISTS (
  SELECT 1 FROM [workflow].run_facts
  WHERE tenant_id = @tenant AND run_id = @run AND status = N'completed' AND finished_at IS NOT NULL AND reason IS NULL
    AND waiting_binding_digest IS NULL AND waiting_expires_at IS NULL AND tokens = 120 AND cost = 0.0042
) THROW 50000, N'A completed write did not clear waiting, set finished_at and keep the stored usage.', 1;

SELECT @finished = finished_at FROM [workflow].run_facts WHERE tenant_id = @tenant AND run_id = @run;
SET @json = N'{' + @base + N',"status":"completed","history":[],"usage":{"tokens":150,"cost":1e-7}}';
INSERT INTO #worker_out EXEC [workflow].worker_write_record @tenant, N'run', @run, 3, N'completed', @json;
IF NOT EXISTS (
  SELECT 1 FROM [workflow].run_facts
  WHERE tenant_id = @tenant AND run_id = @run AND finished_at = @finished AND tokens = 150 AND cost = 0
) THROW 50000, N'An exponent-form cost or a repeated terminal state was mishandled.', 1;

SET @json = N'{' + @base + N',"status":"failed","history":[{"nodeId":"a","kind":"agent","state":"failed","detail":"FIRST_FAILURE"},{"nodeId":"b","kind":"agent","state":"completed"},{"nodeId":"c","kind":"mcp","state":"failed","detail":"' + @long + N'"}]}';
INSERT INTO #worker_out EXEC [workflow].worker_write_record @tenant, N'run', @failed_run, 0, N'failed', @json;
IF NOT EXISTS (
  SELECT 1 FROM [workflow].run_facts
  WHERE tenant_id = @tenant AND run_id = @failed_run AND status = N'failed' AND finished_at IS NOT NULL AND reason = REPLICATE(N'x', 64)
) THROW 50000, N'A failed run must carry the last failure detail cut to 64 characters.', 1;

SET @json = N'{' + @base + N',"status":"unknown-outcome","history":[{"nodeId":"a","kind":"mcp","state":"unknown-outcome","detail":"RECONCILIATION_REQUIRED"}]}';
INSERT INTO #worker_out EXEC [workflow].worker_write_record @tenant, N'run', @unknown_run, 0, N'unknown-outcome', @json;
IF NOT EXISTS (
  SELECT 1 FROM [workflow].run_facts
  WHERE tenant_id = @tenant AND run_id = @unknown_run AND status = N'unknown-outcome' AND finished_at IS NOT NULL AND reason = N'RECONCILIATION_REQUIRED'
) THROW 50000, N'An unknown-outcome run must carry its reason.', 1;

SET @json = N'{"definitionId":"' + CONVERT(nvarchar(36), @definition) + N'","stableDefinitionId":"' + CONVERT(nvarchar(36), @stable) + N'","ownerId":"webhook:' + CONVERT(nvarchar(36), @definition) + N'","inputDigest":"' + @digest + N'","status":"queued","history":[]}';
INSERT INTO #admit_out EXEC [workflow].admit_webhook_run @tenant, @webhook_run, @definition, @digest, @json;
DELETE FROM #admit_out;
INSERT INTO #admit_out EXEC [workflow].admit_webhook_run @tenant, @webhook_run, @definition, @digest, @json;
IF NOT EXISTS (SELECT 1 FROM #admit_out WHERE admitted = 0)
  THROW 50000, N'A replayed webhook admission must report admitted = 0.', 1;
IF (SELECT COUNT(*) FROM [workflow].run_facts WHERE tenant_id = @tenant AND run_id = @webhook_run AND trigger_kind = N'webhook' AND status = N'queued' AND tokens = 0 AND cost = 0 AND finished_at IS NULL) <> 1
  THROW 50000, N'admit_webhook_run did not upsert exactly one webhook fact row.', 1;

SET @json = N'{' + @base + N',"status":"queued","history":[]}';
INSERT INTO #write_out EXEC [workflow].write_record @tenant, @user, @tenant_epoch, @membership_epoch, N'editor', N'run', @browser_run, 0, N'queued', @json, @key_run, @digest, N'{}';
IF NOT EXISTS (SELECT 1 FROM [workflow].run_facts WHERE tenant_id = @tenant AND run_id = @browser_run AND trigger_kind = N'manual' AND status = N'queued')
  THROW 50000, N'write_record for a run did not upsert its fact row.', 1;

INSERT INTO #write_out EXEC [workflow].write_record @tenant, @user, @tenant_epoch, @membership_epoch, N'editor', N'installation', @installation, 0, N'healthy', N'{}', @key_installation, @digest, N'{}';
IF (SELECT COUNT(*) FROM [workflow].run_facts WHERE tenant_id = @tenant) <> 5
  THROW 50000, N'Only run records may produce fact rows.', 1;

BEGIN TRY
  SET @json = N'{"status":"running","history":[]}';
  INSERT INTO #worker_out EXEC [workflow].worker_write_record @tenant, N'run', @rejected_run, 0, N'running', @json;
  THROW 50000, N'A run without identifiers must be rejected.', 1;
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() <> 50002 THROW;
END CATCH;

IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

DROP TABLE #worker_out;
DROP TABLE #admit_out;
DROP TABLE #write_out;

IF (SELECT COUNT(*) FROM [workflow].records WHERE kind = N'run') <> (SELECT COUNT(*) FROM [workflow].run_facts)
  THROW 50000, N'Run record and run fact counts differ.', 1;

IF EXISTS (
  SELECT 1 FROM [workflow].records AS r
  WHERE r.kind = N'run' AND NOT EXISTS (SELECT 1 FROM [workflow].run_facts AS f WHERE f.tenant_id = r.tenant_id AND f.run_id = r.id AND f.status = r.state)
) THROW 50000, N'A run record has no matching fact row.', 1;

SELECT N'013_governance_evidence' AS migration, N'passed' AS status;
