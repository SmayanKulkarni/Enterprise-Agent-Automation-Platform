SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @constraint sysname, @sql nvarchar(max);

SELECT @constraint = name
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID(N'workflow.records')
  AND definition LIKE N'%webhook-credential%';

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
    N'memory-item', N'memory-lifecycle', N'memory-retrieval',
    N'openrouter-connection'
  )
);

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].write_record
  @tenant_id uniqueidentifier,
  @user_id uniqueidentifier,
  @tenant_epoch bigint,
  @membership_epoch bigint,
  @profile nvarchar(32),
  @kind nvarchar(24),
  @id uniqueidentifier,
  @expected_version bigint,
  @state nvarchar(32),
  @data_json nvarchar(max),
  @idempotency_key uniqueidentifier,
  @request_digest char(64),
  @receipt_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  EXEC [workflow].check_profile
    @tenant_id, @user_id, @tenant_epoch, @membership_epoch, @profile;

  IF @kind NOT IN (
    N''installation'', N''run'', N''effect'', N''summary'', N''grant'', N''circuit'',
    N''webhook-credential'', N''webhook-dispatch'', N''memory-import'',
    N''memory-item'', N''memory-lifecycle'', N''memory-retrieval'',
    N''openrouter-connection''
  )
  OR @expected_version < 0
  OR ISJSON(@data_json) <> 1
  OR ISJSON(@receipt_json) <> 1
  OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64)
    THROW 50002, N''INVALID'', 1;

  BEGIN TRANSACTION;

  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max), @version bigint;

  SELECT
    @prior_digest = request_digest,
    @prior_receipt = receipt_json
  FROM [workflow].command_receipts WITH (UPDLOCK, HOLDLOCK)
  WHERE tenant_id = @tenant_id
    AND idempotency_key = @idempotency_key;

  IF @prior_receipt IS NOT NULL
  BEGIN
    IF @prior_digest <> @request_digest
      THROW 50004, N''CONFLICT'', 1;

    SELECT @prior_receipt AS receipt_json, CONVERT(bit, 1) AS replayed;
    COMMIT TRANSACTION;
    RETURN;
  END;

  SELECT @version = version
  FROM [workflow].records WITH (UPDLOCK, HOLDLOCK)
  WHERE tenant_id = @tenant_id
    AND kind = @kind
    AND id = @id;

  IF ISNULL(@version, 0) <> @expected_version
    THROW 50003, N''STALE'', 1;

  IF @version IS NULL
    INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json)
    VALUES (@tenant_id, @kind, @id, 1, @state, @data_json);
  ELSE
    UPDATE [workflow].records
    SET version = @version + 1,
        state = @state,
        data_json = @data_json,
        updated_at = SYSUTCDATETIME()
    WHERE tenant_id = @tenant_id
      AND kind = @kind
      AND id = @id;

  INSERT INTO [workflow].command_receipts
    (tenant_id, idempotency_key, request_digest, receipt_json)
  VALUES
    (@tenant_id, @idempotency_key, @request_digest, @receipt_json);

  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed;
  COMMIT TRANSACTION;
END;
');

COMMIT TRANSACTION;
