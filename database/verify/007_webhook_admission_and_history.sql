SET NOCOUNT ON;

IF OBJECT_ID(N'workflow.admit_webhook_run', N'P') IS NULL OR OBJECT_ID(N'workflow.worker_pending_webhook_dispatches', N'P') IS NULL
  THROW 50000, N'Webhook admission procedure is incomplete.', 1;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'workflow.records') AND name = N'IX_workflow_records_run_history')
  THROW 50000, N'Run History index is incomplete.', 1;

SELECT N'007_webhook_admission_and_history' AS migration, N'passed' AS status;
