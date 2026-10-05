SET NOCOUNT ON;
SET XACT_ABORT ON;

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'workflow.records')
    AND definition LIKE N'%mcp-credential%' AND definition LIKE N'%memory-consolidation%' AND definition LIKE N'%model-settings%' AND definition LIKE N'%openrouter-connection%'
) THROW 50000, N'The mcp-credential record kind is missing from the records constraint.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'workflow.write_record')) NOT LIKE N'%mcp-credential%'
  THROW 50000, N'write_record does not accept mcp-credential records.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'workflow.worker_write_record')) LIKE N'%mcp-credential%'
  THROW 50000, N'The worker must not write mcp-credential records.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'workflow.write_record')) NOT LIKE N'%upsert_run_fact%'
  THROW 50000, N'write_record must keep the run fact upsert.', 1;

IF NOT EXISTS (
  SELECT 1 FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id = OBJECT_ID(N'workflow.write_record')
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_workflow_browser')
) THROW 50000, N'ALTER dropped the browser write grant.', 1;

DECLARE @tenant uniqueidentifier = NEWID();
BEGIN TRANSACTION;
INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json)
SELECT @tenant, kind, NEWID(), 1, N'verify', N'{}'
FROM (VALUES
  (N'installation'), (N'run'), (N'effect'), (N'summary'), (N'grant'), (N'circuit'),
  (N'webhook-credential'), (N'webhook-dispatch'), (N'memory-import'), (N'memory-item'),
  (N'memory-lifecycle'), (N'memory-retrieval'), (N'memory-consolidation'),
  (N'openrouter-connection'), (N'model-settings'), (N'mcp-credential')
) AS kinds(kind);
IF (SELECT COUNT(*) FROM [workflow].records WHERE tenant_id = @tenant) <> 16
  THROW 50000, N'Not every record kind was accepted.', 1;
ROLLBACK TRANSACTION;

SELECT N'021_mcp_credential_records' AS migration, N'passed' AS status;
