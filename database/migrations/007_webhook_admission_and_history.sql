SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @constraint sysname;
DECLARE @statement nvarchar(max);
SELECT @constraint = name FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'workflow.records') AND definition LIKE N'%webhook-credential%';
IF @constraint IS NOT NULL
BEGIN
  SET @statement = N'ALTER TABLE [workflow].[records] DROP CONSTRAINT ' + QUOTENAME(@constraint);
  EXEC(@statement);
END;
ALTER TABLE [workflow].records ADD CONSTRAINT CK_workflow_records_kind CHECK (kind IN (N'installation', N'run', N'effect', N'summary', N'grant', N'circuit', N'webhook-credential', N'webhook-dispatch', N'memory-import', N'memory-item', N'memory-lifecycle', N'memory-retrieval'));
CREATE INDEX IX_workflow_records_run_history ON [workflow].records (tenant_id, kind, created_at DESC, id DESC) INCLUDE (version, state);

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].write_record
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint,
  @profile nvarchar(32), @kind nvarchar(24), @id uniqueidentifier, @expected_version bigint,
  @state nvarchar(32), @data_json nvarchar(max), @idempotency_key uniqueidentifier, @request_digest char(64), @receipt_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  EXEC [workflow].assert_profile @tenant_id, @user_id, @tenant_epoch, @membership_epoch, @profile;
  IF @kind NOT IN (N''installation'', N''run'', N''effect'', N''summary'', N''grant'', N''circuit'', N''webhook-credential'', N''memory-import'', N''memory-item'', N''memory-lifecycle'', N''memory-retrieval'') OR @expected_version < 0
    OR ISJSON(@data_json) <> 1 OR ISJSON(@receipt_json) <> 1 OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64)
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max), @version bigint;
  SELECT @prior_digest = request_digest, @prior_receipt = receipt_json FROM [workflow].command_receipts WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key;
  IF @prior_receipt IS NOT NULL
  BEGIN
    IF @prior_digest <> @request_digest BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
    SELECT @prior_receipt AS receipt_json, CONVERT(bit, 1) AS replayed; COMMIT TRANSACTION; RETURN;
  END;
  SELECT @version = version FROM [workflow].records WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  IF ISNULL(@version, 0) <> @expected_version BEGIN ;THROW 50003, N''STALE'', 1; END;
  IF @version IS NULL INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json) VALUES (@tenant_id, @kind, @id, 1, @state, @data_json);
  ELSE UPDATE [workflow].records SET version = @version + 1, state = @state, data_json = @data_json, updated_at = SYSUTCDATETIME() WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  INSERT INTO [workflow].command_receipts (tenant_id, idempotency_key, request_digest, receipt_json) VALUES (@tenant_id, @idempotency_key, @request_digest, @receipt_json);
  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed; COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].worker_write_record
  @tenant_id uniqueidentifier, @kind nvarchar(24), @id uniqueidentifier, @expected_version bigint,
  @state nvarchar(32), @data_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @kind NOT IN (N''run'', N''effect'', N''summary'', N''installation'', N''circuit'', N''webhook-dispatch'', N''memory-item'', N''memory-lifecycle'', N''memory-retrieval'') OR @expected_version < 0 OR ISJSON(@data_json) <> 1
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  DECLARE @version bigint;
  SELECT @version = version FROM [workflow].records WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  IF ISNULL(@version, 0) <> @expected_version BEGIN ;THROW 50003, N''STALE'', 1; END;
  IF @version IS NULL INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json) VALUES (@tenant_id, @kind, @id, 1, @state, @data_json);
  ELSE UPDATE [workflow].records SET version = @version + 1, state = @state, data_json = @data_json, updated_at = SYSUTCDATETIME() WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  SELECT id, kind, version, state, data_json FROM [workflow].records WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].admit_webhook_run
  @tenant_id uniqueidentifier, @run_id uniqueidentifier, @definition_id uniqueidentifier, @input_digest char(64), @run_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @input_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) OR ISJSON(@run_json) <> 1
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  DECLARE @existing_definition uniqueidentifier, @existing_digest char(64);
  SELECT @existing_definition = TRY_CONVERT(uniqueidentifier, JSON_VALUE(data_json, ''$.definitionId'')), @existing_digest = JSON_VALUE(data_json, ''$.inputDigest'')
    FROM [workflow].records WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND kind = N''run'' AND id = @run_id;
  IF @existing_digest IS NOT NULL
  BEGIN
    IF @existing_definition <> @definition_id OR @existing_digest <> @input_digest BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
    SELECT CONVERT(bit, 0) AS admitted; COMMIT TRANSACTION; RETURN;
  END;
  INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json) VALUES (@tenant_id, N''run'', @run_id, 1, N''queued'', @run_json);
  INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json) VALUES (@tenant_id, N''webhook-dispatch'', @run_id, 1, N''pending'', (SELECT CONVERT(nvarchar(36), @definition_id) AS definitionId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));
  SELECT CONVERT(bit, 1) AS admitted;
  COMMIT TRANSACTION;
END;
');
GRANT EXECUTE ON OBJECT::[workflow].admit_webhook_run TO platform_workflow_worker;

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].worker_pending_webhook_dispatches
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT tenant_id, id FROM [workflow].records WHERE kind = N''webhook-dispatch'' AND state = N''pending'' ORDER BY created_at ASC, id ASC;
END;
');
GRANT EXECUTE ON OBJECT::[workflow].worker_pending_webhook_dispatches TO platform_workflow_worker;

COMMIT TRANSACTION;
