SET NOCOUNT ON;
SET XACT_ABORT OFF;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'workflow.records') AND definition LIKE N'%memory-consolidation%' AND definition LIKE N'%model-settings%')
  THROW 50000, N'The memory-consolidation record kind is missing from the records constraint.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'workflow.worker_write_record')) NOT LIKE N'%memory-consolidation%'
  THROW 50000, N'worker_write_record does not accept memory-consolidation records.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'workflow.write_record')) LIKE N'%memory-consolidation%'
  THROW 50000, N'Only the worker may write memory-consolidation records.', 1;

IF OBJECT_DEFINITION(OBJECT_ID(N'workflow.worker_write_record')) NOT LIKE N'%upsert_run_fact%'
  THROW 50000, N'worker_write_record must keep the run fact upsert.', 1;

IF NOT EXISTS (
  SELECT 1 FROM sys.database_permissions
  WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
    AND major_id = OBJECT_ID(N'workflow.worker_write_record')
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_workflow_worker')
) THROW 50000, N'CREATE OR ALTER dropped the worker write grant.', 1;

SELECT N'020_memory_consolidation_records' AS migration, N'passed' AS status;
