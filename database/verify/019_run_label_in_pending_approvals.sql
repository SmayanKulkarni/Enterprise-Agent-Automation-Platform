SET NOCOUNT ON;
SET XACT_ABORT OFF;

IF NOT EXISTS (SELECT 1 FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID(N'governance.read_pending_approvals'), 0) WHERE name = N'run_label')
  THROW 50000, N'read_pending_approvals must expose run_label.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'governance.read_pending_approvals')) NOT LIKE N'%LEFT(JSON_VALUE(r.data_json, ''$.label''), 120)%'
  THROW 50000, N'run_label must be a bounded extract of the run label, never data_json.', 1;

IF NOT EXISTS (
  SELECT 1 FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id = OBJECT_ID(N'governance.read_pending_approvals')
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_governance_browser')
) THROW 50000, N'CREATE OR ALTER dropped the read_pending_approvals grant.', 1;
