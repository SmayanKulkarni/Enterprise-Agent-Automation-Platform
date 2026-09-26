/* Durable Tenant-keyed owner facts, receipts, audit facts, and payload-free hints. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

DECLARE @objects TABLE (schema_name sysname NOT NULL, table_name sysname NOT NULL);
INSERT INTO @objects (schema_name, table_name) VALUES
  (N'identity', N'external_identities'), (N'identity', N'profiles'), (N'identity', N'exact_approvals'),
  (N'lifecycle', N'packages'), (N'lifecycle', N'versions'), (N'lifecycle', N'artifacts'), (N'lifecycle', N'publications'), (N'lifecycle', N'installations'), (N'lifecycle', N'revisions'), (N'lifecycle', N'activations'),
  (N'case', N'cases'), (N'case', N'events'), (N'case', N'activities'), (N'case', N'timers'), (N'case', N'interventions'), (N'case', N'responses'), (N'case', N'effect_intents'),
  (N'gateway', N'adapter_releases'), (N'gateway', N'installations'), (N'gateway', N'credential_references'), (N'gateway', N'attempts'), (N'gateway', N'receipts'), (N'gateway', N'reconciliation_checkpoints'),
  (N'memory', N'provenance'), (N'memory', N'records'), (N'memory', N'holds'), (N'memory', N'lifecycle_reports'), (N'memory', N'validated_experiences'), (N'memory', N'evaluation_ledger'), (N'memory', N'candidates'),
  (N'technical', N'customer_environments'), (N'technical', N'handoffs'),
  (N'vendor', N'vendors'), (N'vendor', N'assessment_versions'), (N'vendor', N'assessment_evidence'), (N'vendor', N'access_grants'),
  (N'deployment', N'manifests'), (N'deployment', N'recovery_exercises'), (N'deployment', N'teardown_receipts'),
  (N'demo', N'scenarios'), (N'demo', N'runs'), (N'demo', N'run_resources');

DECLARE @schema sysname, @table sysname, @sql nvarchar(max);
DECLARE object_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT schema_name, table_name FROM @objects;
OPEN object_cursor;
FETCH NEXT FROM object_cursor INTO @schema, @table;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @sql = N'IF SCHEMA_ID(N''' + REPLACE(@schema, N'''', N'''''') + N''') IS NULL EXEC(N''CREATE SCHEMA ' + QUOTENAME(@schema) + N' AUTHORIZATION dbo;'');'
    + N'CREATE TABLE ' + QUOTENAME(@schema) + N'.' + QUOTENAME(@table) + N' ('
    + N'tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id), '
    + N'id uniqueidentifier NOT NULL, version bigint NOT NULL DEFAULT (1) CHECK (version >= 0), '
    + N'state nvarchar(64) NOT NULL, data_json nvarchar(max) NOT NULL CHECK (ISJSON(data_json) = 1), '
    + N'created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()), updated_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()), '
    + N'CONSTRAINT ' + QUOTENAME(N'PK_' + @schema + N'_' + @table) + N' PRIMARY KEY (tenant_id, id)); '
    + N'CREATE INDEX ' + QUOTENAME(N'IX_' + @schema + N'_' + @table + N'_state') + N' ON ' + QUOTENAME(@schema) + N'.' + QUOTENAME(@table) + N' (tenant_id, state, updated_at DESC);';
  EXEC(@sql);
  FETCH NEXT FROM object_cursor INTO @schema, @table;
END;
CLOSE object_cursor;
DEALLOCATE object_cursor;

IF SCHEMA_ID(N'operations') IS NULL EXEC(N'CREATE SCHEMA [operations] AUTHORIZATION dbo;');
CREATE TABLE [operations].command_receipts (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  idempotency_key uniqueidentifier NOT NULL,
  request_digest char(64) NOT NULL,
  receipt_json nvarchar(max) NOT NULL CHECK (ISJSON(receipt_json) = 1 AND LEFT(LTRIM(receipt_json), 1) = N'{'),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_operations_command_receipts PRIMARY KEY (tenant_id, idempotency_key),
  CONSTRAINT UQ_operations_command_receipts_digest UNIQUE (tenant_id, idempotency_key, request_digest)
);
CREATE TABLE [operations].audit_facts (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  id uniqueidentifier NOT NULL,
  correlation_id uniqueidentifier NOT NULL,
  causation_id uniqueidentifier NULL,
  owner nvarchar(32) NOT NULL,
  name nvarchar(64) NOT NULL,
  subject_id uniqueidentifier NOT NULL,
  digest char(64) NOT NULL,
  fact_json nvarchar(max) NOT NULL CHECK (ISJSON(fact_json) = 1),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_operations_audit_facts PRIMARY KEY (tenant_id, id)
);
CREATE TABLE [operations].projection_checkpoints (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  collection nvarchar(40) NOT NULL,
  watermark bigint NOT NULL CHECK (watermark >= 0),
  updated_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_operations_projection_checkpoints PRIMARY KEY (tenant_id, collection)
);
CREATE TABLE [operations].change_hints (
  sequence bigint IDENTITY(1,1) NOT NULL,
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  collection nvarchar(40) NOT NULL,
  object_id uniqueidentifier NOT NULL,
  watermark bigint NOT NULL CHECK (watermark >= 0),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_operations_change_hints PRIMARY KEY (tenant_id, sequence)
);
CREATE INDEX IX_operations_change_hints_cursor ON [operations].change_hints (tenant_id, sequence) INCLUDE (collection, object_id, watermark);
CREATE INDEX IX_operations_audit_facts_correlation ON [operations].audit_facts (tenant_id, correlation_id, created_at DESC);

EXEC(N'
CREATE OR ALTER PROCEDURE [operations].record_command_receipt
  @tenant_id uniqueidentifier, @idempotency_key uniqueidentifier, @request_digest char(64),
  @receipt_json nvarchar(max), @collection nvarchar(40), @object_id uniqueidentifier, @watermark bigint
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @tenant_id IS NULL OR @idempotency_key IS NULL OR @object_id IS NULL OR @watermark < 0
    OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) OR ISJSON(@receipt_json) <> 1
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM [operations].command_receipts WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key)
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM [operations].command_receipts WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key AND request_digest = @request_digest)
      BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
    SELECT receipt_json FROM [operations].command_receipts WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key;
    COMMIT TRANSACTION;
    RETURN;
  END;
  INSERT INTO [operations].command_receipts (tenant_id, idempotency_key, request_digest, receipt_json) VALUES (@tenant_id, @idempotency_key, @request_digest, @receipt_json);
  MERGE [operations].projection_checkpoints WITH (HOLDLOCK) AS target
  USING (SELECT @tenant_id AS tenant_id, @collection AS collection, @watermark AS watermark) AS source
  ON target.tenant_id = source.tenant_id AND target.collection = source.collection
  WHEN MATCHED AND source.watermark > target.watermark THEN UPDATE SET watermark = source.watermark, updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN INSERT (tenant_id, collection, watermark) VALUES (source.tenant_id, source.collection, source.watermark);
  INSERT INTO [operations].change_hints (tenant_id, collection, object_id, watermark) VALUES (@tenant_id, @collection, @object_id, @watermark);
  COMMIT TRANSACTION;
  SELECT @receipt_json AS receipt_json;
END;
');

CREATE ROLE platform_connected_runtime AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::[operations].record_command_receipt TO platform_connected_runtime;

COMMIT TRANSACTION;
