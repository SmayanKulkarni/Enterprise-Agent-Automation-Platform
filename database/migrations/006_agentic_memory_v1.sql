SET NOCOUNT ON;
SET XACT_ABORT ON;

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
  IF @kind NOT IN (N''installation'', N''run'', N''effect'', N''summary'', N''grant'', N''circuit'', N''memory-import'', N''memory-item'', N''memory-lifecycle'', N''memory-retrieval'') OR @expected_version < 0
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
  IF @kind NOT IN (N''run'', N''effect'', N''summary'', N''installation'', N''circuit'', N''memory-item'', N''memory-lifecycle'', N''memory-retrieval'') OR @expected_version < 0 OR ISJSON(@data_json) <> 1
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
