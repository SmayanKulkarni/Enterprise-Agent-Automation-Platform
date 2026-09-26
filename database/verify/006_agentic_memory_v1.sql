SET NOCOUNT ON;

IF OBJECT_ID(N'workflow.write_record', N'P') IS NULL OR OBJECT_ID(N'workflow.worker_write_record', N'P') IS NULL
  THROW 50000, N'Agentic memory procedures are incomplete.', 1;

SELECT N'006_agentic_memory_v1' AS migration, N'passed' AS status;
