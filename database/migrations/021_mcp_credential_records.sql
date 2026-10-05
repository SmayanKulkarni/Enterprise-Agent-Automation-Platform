SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @constraint sysname, @sql nvarchar(max), @definition nvarchar(max), @marker nvarchar(64) = N'N''model-settings''';

SELECT @constraint = name
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID(N'workflow.records')
  AND definition LIKE N'%memory-consolidation%'
  AND definition LIKE N'%model-settings%';

IF @constraint IS NULL
  THROW 50000, N'The workflow records kind constraint was not found.', 1;

SET @sql = N'ALTER TABLE [workflow].[records] DROP CONSTRAINT ' + QUOTENAME(@constraint);
EXEC(@sql);

ALTER TABLE [workflow].[records]
ADD CONSTRAINT CK_workflow_records_kind CHECK (
  kind IN (
    N'installation', N'run', N'effect', N'summary', N'grant', N'circuit',
    N'webhook-credential', N'webhook-dispatch', N'memory-import',
    N'memory-item', N'memory-lifecycle', N'memory-retrieval', N'memory-consolidation',
    N'openrouter-connection', N'model-settings', N'mcp-credential'
  )
);

SET @definition = OBJECT_DEFINITION(OBJECT_ID(N'workflow.write_record'));

IF @definition IS NULL OR CHARINDEX(N'PROCEDURE', @definition) = 0 OR CHARINDEX(@marker, @definition) = 0 OR CHARINDEX(N'mcp-credential', @definition) > 0
  THROW 50000, N'workflow.write_record has an unexpected definition.', 1;

SET @definition = N'ALTER ' + SUBSTRING(@definition, CHARINDEX(N'PROCEDURE', @definition), LEN(@definition));
SET @definition = REPLACE(@definition, @marker, @marker + N', N''mcp-credential''');
EXEC(@definition);

COMMIT TRANSACTION;
