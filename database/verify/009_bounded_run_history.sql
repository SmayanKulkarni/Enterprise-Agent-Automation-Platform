SET NOCOUNT ON;

IF OBJECT_ID(N'workflow.read_run_history', N'P') IS NULL
  THROW 50000, N'Bounded Run History procedure is missing.', 1;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes AS indexes
  WHERE indexes.object_id = OBJECT_ID(N'workflow.records')
    AND indexes.name = N'IX_workflow_records_run_history'
)
  THROW 50000, N'Run History ordering index is missing.', 1;

SELECT N'009_bounded_run_history' AS migration, N'passed' AS status;
