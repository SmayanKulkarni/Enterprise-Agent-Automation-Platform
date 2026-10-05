SET NOCOUNT ON;
SET XACT_ABORT OFF;

IF OBJECT_DEFINITION(OBJECT_ID(N'workflow.upsert_run_fact')) NOT LIKE N'%rejected%expired%cancelled%superseded%'
  THROW 50000, N'upsert_run_fact must treat rejected, expired, cancelled and superseded as terminal.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'governance.read_overview')) NOT LIKE N'%NOT IN (N''rejected''%'
  OR OBJECT_DEFINITION(OBJECT_ID(N'governance.read_workflows')) NOT LIKE N'%NOT IN (N''rejected''%'
  THROW 50000, N'Governance reads must exclude non-failure terminal outcomes from run counts.', 1;

IF (
  SELECT COUNT(*) FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id IN (OBJECT_ID(N'governance.read_overview'), OBJECT_ID(N'governance.read_workflows'))
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_governance_browser')
) <> 2 THROW 50000, N'CREATE OR ALTER dropped the governance read grants.', 1;
