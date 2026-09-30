/* Exact run, token and spend evidence: one workflow.run_facts row per run record, kept in step by the three run writers. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRANSACTION;

CREATE TABLE [workflow].run_facts (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  run_id uniqueidentifier NOT NULL,
  definition_id uniqueidentifier NOT NULL,
  stable_definition_id uniqueidentifier NOT NULL,
  owner_id nvarchar(128) NOT NULL,
  trigger_kind nvarchar(16) NOT NULL CHECK (trigger_kind IN (N'manual', N'webhook')),
  status nvarchar(32) NOT NULL,
  reason nvarchar(64) NULL,
  started_at datetime2(7) NOT NULL,
  finished_at datetime2(7) NULL,
  tokens bigint NOT NULL CONSTRAINT DF_workflow_run_facts_tokens DEFAULT (0),
  cost decimal(18,6) NOT NULL CONSTRAINT DF_workflow_run_facts_cost DEFAULT (0),
  usage_estimated bit NOT NULL CONSTRAINT DF_workflow_run_facts_usage_estimated DEFAULT (0),
  waiting_binding_digest char(64) NULL,
  waiting_expires_at datetime2(7) NULL,
  CONSTRAINT PK_workflow_run_facts PRIMARY KEY (tenant_id, run_id)
);
CREATE INDEX IX_workflow_run_facts_window ON [workflow].run_facts (tenant_id, started_at)
  INCLUDE (status, tokens, cost, finished_at, definition_id, stable_definition_id, usage_estimated);
CREATE INDEX IX_workflow_run_facts_waiting ON [workflow].run_facts (status, tenant_id)
  INCLUDE (run_id, waiting_expires_at) WHERE status = N'waiting-approval';

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].upsert_run_fact
  @tenant_id uniqueidentifier, @run_id uniqueidentifier, @state nvarchar(32), @data_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @definition_id uniqueidentifier = TRY_CONVERT(uniqueidentifier, JSON_VALUE(@data_json, ''$.definitionId'')),
    @stable_definition_id uniqueidentifier = TRY_CONVERT(uniqueidentifier, JSON_VALUE(@data_json, ''$.stableDefinitionId'')),
    @owner_id nvarchar(128) = CONVERT(nvarchar(128), JSON_VALUE(@data_json, ''$.ownerId'')),
    @terminal bit = CASE WHEN @state IN (N''completed'', N''failed'', N''unknown-outcome'') THEN 1 ELSE 0 END,
    @failed bit = CASE WHEN @state IN (N''failed'', N''unknown-outcome'') THEN 1 ELSE 0 END,
    @waiting bit = CASE WHEN @state = N''waiting-approval'' THEN 1 ELSE 0 END,
    @has_usage bit = CASE WHEN JSON_QUERY(@data_json, ''$.usage'') IS NULL THEN 0 ELSE 1 END,
    @reason nvarchar(64), @tokens bigint, @cost decimal(18,6),
    @waiting_digest char(64), @waiting_expires datetime2(7),
    @stored_status nvarchar(32), @stored bit = 0;
  IF @definition_id IS NULL OR @stable_definition_id IS NULL OR @owner_id IS NULL
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  IF @has_usage = 1
    SELECT @tokens = TRY_CONVERT(bigint, TRY_CONVERT(float, JSON_VALUE(@data_json, ''$.usage.tokens''))),
      @cost = TRY_CONVERT(decimal(18,6), TRY_CONVERT(float, JSON_VALUE(@data_json, ''$.usage.cost'')));
  IF @tokens < 0 SET @tokens = NULL;
  IF @cost < 0 SET @cost = NULL;
  IF @failed = 1
    SELECT TOP (1) @reason = LEFT(JSON_VALUE(h.value, ''$.detail''), 64)
    FROM OPENJSON(@data_json, ''$.history'') AS h
    WHERE JSON_VALUE(h.value, ''$.state'') IN (N''failed'', N''unknown-outcome'')
    ORDER BY TRY_CONVERT(int, h.[key]) DESC;
  IF @waiting = 1
    SELECT @waiting_digest = CONVERT(char(64), JSON_VALUE(@data_json, ''$.waiting.bindingDigest'')),
      @waiting_expires = TRY_CONVERT(datetime2(7), JSON_VALUE(@data_json, ''$.waiting.expiresAt''));
  SELECT @stored_status = status, @stored = 1
  FROM [workflow].run_facts WITH (UPDLOCK, HOLDLOCK)
  WHERE tenant_id = @tenant_id AND run_id = @run_id;
  IF @stored = 0
    INSERT INTO [workflow].run_facts
      (tenant_id, run_id, definition_id, stable_definition_id, owner_id, trigger_kind, status, reason, started_at, finished_at, tokens, cost, waiting_binding_digest, waiting_expires_at)
    VALUES
      (@tenant_id, @run_id, @definition_id, @stable_definition_id, @owner_id,
       CASE WHEN @owner_id LIKE N''webhook:%'' THEN N''webhook'' ELSE N''manual'' END,
       @state, @reason, SYSUTCDATETIME(), CASE WHEN @terminal = 1 THEN SYSUTCDATETIME() END,
       ISNULL(@tokens, 0), ISNULL(@cost, 0), @waiting_digest, @waiting_expires);
  ELSE
    UPDATE [workflow].run_facts
    SET status = @state,
        reason = @reason,
        finished_at = CASE WHEN @terminal = 0 THEN NULL WHEN @stored_status <> @state THEN SYSUTCDATETIME() ELSE finished_at END,
        tokens = ISNULL(@tokens, tokens),
        cost = ISNULL(@cost, cost),
        waiting_binding_digest = @waiting_digest,
        waiting_expires_at = @waiting_expires
    WHERE tenant_id = @tenant_id AND run_id = @run_id;
END;
');

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
    N''openrouter-connection'', N''model-settings''
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

  IF @kind = N''run''
    EXEC [workflow].upsert_run_fact @tenant_id, @id, @state, @data_json;

  INSERT INTO [workflow].command_receipts
    (tenant_id, idempotency_key, request_digest, receipt_json)
  VALUES
    (@tenant_id, @idempotency_key, @request_digest, @receipt_json);

  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed;
  COMMIT TRANSACTION;
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
  IF @kind = N''run'' EXEC [workflow].upsert_run_fact @tenant_id, @id, @state, @data_json;
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
  EXEC [workflow].upsert_run_fact @tenant_id, @run_id, N''queued'', @run_json;
  INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json) VALUES (@tenant_id, N''webhook-dispatch'', @run_id, 1, N''pending'', (SELECT CONVERT(nvarchar(36), @definition_id) AS definitionId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));
  SELECT CONVERT(bit, 1) AS admitted;
  COMMIT TRANSACTION;
END;
');

INSERT INTO [workflow].run_facts
  (tenant_id, run_id, definition_id, stable_definition_id, owner_id, trigger_kind, status, reason, started_at, finished_at, tokens, cost, usage_estimated, waiting_binding_digest, waiting_expires_at)
SELECT r.tenant_id, r.id, d.definition_id, d.stable_definition_id, d.owner_id,
  CASE WHEN d.owner_id LIKE N'webhook:%' THEN N'webhook' ELSE N'manual' END,
  r.state,
  CASE WHEN r.state IN (N'failed', N'unknown-outcome') THEN (
    SELECT TOP (1) LEFT(JSON_VALUE(h.value, '$.detail'), 64)
    FROM OPENJSON(r.data_json, '$.history') AS h
    WHERE JSON_VALUE(h.value, '$.state') IN (N'failed', N'unknown-outcome')
    ORDER BY TRY_CONVERT(int, h.[key]) DESC
  ) END,
  r.created_at,
  CASE WHEN r.state IN (N'completed', N'failed', N'unknown-outcome') THEN r.updated_at END,
  ISNULL(u.tokens, 0), ISNULL(u.cost, 0), 1,
  CASE WHEN r.state = N'waiting-approval' THEN CONVERT(char(64), JSON_VALUE(r.data_json, '$.waiting.bindingDigest')) END,
  CASE WHEN r.state = N'waiting-approval' THEN TRY_CONVERT(datetime2(7), JSON_VALUE(r.data_json, '$.waiting.expiresAt')) END
FROM [workflow].records AS r
CROSS APPLY (
  SELECT TRY_CONVERT(uniqueidentifier, JSON_VALUE(r.data_json, '$.definitionId')) AS definition_id,
    TRY_CONVERT(uniqueidentifier, JSON_VALUE(r.data_json, '$.stableDefinitionId')) AS stable_definition_id,
    CONVERT(nvarchar(128), JSON_VALUE(r.data_json, '$.ownerId')) AS owner_id
) AS d
OUTER APPLY (
  SELECT SUM(ISNULL(TRY_CONVERT(bigint, TRY_CONVERT(float, p.tokens_text)), 0)) AS tokens,
    TRY_CONVERT(decimal(18,6), SUM(ISNULL(TRY_CONVERT(decimal(18,6), TRY_CONVERT(float, p.cost_text)), 0))) AS cost
  FROM OPENJSON(r.data_json, '$.history') WITH (kind nvarchar(16) '$.kind', state nvarchar(32) '$.state', detail nvarchar(4000) '$.detail') AS h
  CROSS APPLY (SELECT REVERSE(h.detail) AS reversed) AS v
  CROSS APPLY (SELECT CHARINDEX(N':', v.reversed) AS last_colon) AS c1
  CROSS APPLY (SELECT CASE WHEN c1.last_colon > 0 THEN CHARINDEX(N':', v.reversed, c1.last_colon + 1) ELSE 0 END AS prior_colon) AS c2
  CROSS APPLY (
    SELECT CASE WHEN c2.prior_colon > c1.last_colon THEN REVERSE(SUBSTRING(v.reversed, 1, c1.last_colon - 1)) END AS cost_text,
      CASE WHEN c2.prior_colon > c1.last_colon THEN REVERSE(SUBSTRING(v.reversed, c1.last_colon + 1, c2.prior_colon - c1.last_colon - 1)) END AS tokens_text
  ) AS p
  WHERE h.kind = N'agent' AND h.state = N'completed' AND h.detail IS NOT NULL
) AS u
WHERE r.kind = N'run'
  AND d.definition_id IS NOT NULL AND d.stable_definition_id IS NOT NULL AND d.owner_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM [workflow].run_facts AS f WHERE f.tenant_id = r.tenant_id AND f.run_id = r.id);

COMMIT TRANSACTION;
