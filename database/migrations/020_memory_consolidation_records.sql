/* Memory consolidation decisions: one content-free workflow.records row per staged memory item, written only by the worker. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @constraint sysname, @sql nvarchar(max);

SELECT @constraint = name
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID(N'workflow.records')
  AND definition LIKE N'%model-settings%';

IF @constraint IS NOT NULL
BEGIN
  SET @sql = N'ALTER TABLE [workflow].[records] DROP CONSTRAINT ' + QUOTENAME(@constraint);
  EXEC(@sql);
END;

ALTER TABLE [workflow].[records]
ADD CONSTRAINT CK_workflow_records_kind CHECK (
  kind IN (
    N'installation', N'run', N'effect', N'summary', N'grant', N'circuit',
    N'webhook-credential', N'webhook-dispatch', N'memory-import',
    N'memory-item', N'memory-lifecycle', N'memory-retrieval', N'memory-consolidation',
    N'openrouter-connection', N'model-settings'
  )
);

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].worker_write_record
  @tenant_id uniqueidentifier, @kind nvarchar(24), @id uniqueidentifier, @expected_version bigint,
  @state nvarchar(32), @data_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @kind NOT IN (N''run'', N''effect'', N''summary'', N''installation'', N''circuit'', N''webhook-dispatch'', N''memory-item'', N''memory-lifecycle'', N''memory-retrieval'', N''memory-consolidation'') OR @expected_version < 0 OR ISJSON(@data_json) <> 1
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  DECLARE @version bigint;
  SELECT @version = version FROM [workflow].records WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  IF ISNULL(@version, 0) <> @expected_version BEGIN ;THROW 50003, N''STALE'', 1; END;
  IF @version IS NULL INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json) VALUES (@tenant_id, @kind, @id, 1, @state, @data_json);
  ELSE UPDATE [workflow].records SET version = @version + 1, state = @state, data_json = @data_json, updated_at = SYSUTCDATETIME() WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  IF @kind = N''run'' EXEC [workflow].upsert_run_fact @tenant_id, @id, @state, @data_json;
  SELECT id, kind, version, state, data_json FROM [workflow].records WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  COMMIT TRANSACTION;
END;
');

COMMIT TRANSACTION;
