SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'workflow') IS NULL EXEC(N'CREATE SCHEMA [workflow] AUTHORIZATION dbo;');

CREATE TABLE [identity].membership_profiles (
  tenant_id uniqueidentifier NOT NULL,
  membership_id uniqueidentifier NOT NULL REFERENCES [identity].memberships (id),
  profile_key nvarchar(32) NOT NULL CHECK (profile_key IN (N'editor', N'admin', N'operator')),
  CONSTRAINT PK_identity_membership_profiles PRIMARY KEY (tenant_id, membership_id, profile_key),
  CONSTRAINT FK_identity_membership_profiles_tenant FOREIGN KEY (tenant_id) REFERENCES [identity].tenants (id)
);

CREATE TABLE [workflow].definitions (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  id uniqueidentifier NOT NULL,
  draft_id uniqueidentifier NOT NULL,
  draft_revision bigint NOT NULL,
  digest char(64) NOT NULL,
  definition_json nvarchar(max) NOT NULL CHECK (ISJSON(definition_json) = 1),
  published_by uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_workflow_definitions PRIMARY KEY (tenant_id, id),
  CONSTRAINT UQ_workflow_definition_revision UNIQUE (tenant_id, draft_id, draft_revision)
);

CREATE TABLE [workflow].records (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  kind nvarchar(24) NOT NULL CHECK (kind IN (N'installation', N'run', N'effect', N'summary', N'grant', N'circuit', N'memory-import', N'webhook-credential')),
  id uniqueidentifier NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  state nvarchar(32) NOT NULL,
  data_json nvarchar(max) NOT NULL CHECK (ISJSON(data_json) = 1),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  updated_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_workflow_records PRIMARY KEY (tenant_id, kind, id)
);
CREATE INDEX IX_workflow_records_list ON [workflow].records (tenant_id, kind, created_at DESC) INCLUDE (id, version, state);

CREATE TABLE [workflow].command_receipts (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  idempotency_key uniqueidentifier NOT NULL,
  request_digest char(64) NOT NULL,
  receipt_json nvarchar(max) NOT NULL CHECK (ISJSON(receipt_json) = 1),
  CONSTRAINT PK_workflow_command_receipts PRIMARY KEY (tenant_id, idempotency_key)
);

EXEC(N'
CREATE OR ALTER PROCEDURE [identity].list_current_tenants
  @issuer nvarchar(512), @subject nvarchar(256)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT t.id AS tenant_id, t.epoch AS tenant_epoch, m.epoch AS membership_epoch, p.profile_key
  FROM [identity].users AS u
  INNER JOIN [identity].memberships AS m ON m.user_id = u.id AND m.status = N''current''
  INNER JOIN [identity].tenants AS t ON t.id = m.tenant_id AND t.status = N''active''
  LEFT JOIN [identity].membership_profiles AS p ON p.membership_id = m.id AND p.tenant_id = t.id
  WHERE u.issuer = @issuer AND u.subject = @subject
  ORDER BY t.id, p.profile_key;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].assert_profile
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint, @profile nvarchar(32)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (
    SELECT 1 FROM [identity].tenants AS t
    INNER JOIN [identity].memberships AS m ON m.tenant_id = t.id
    INNER JOIN [identity].membership_profiles AS p ON p.tenant_id = t.id AND p.membership_id = m.id
    WHERE t.id = @tenant_id AND t.status = N''active'' AND t.epoch = @tenant_epoch
      AND m.user_id = @user_id AND m.status = N''current'' AND m.epoch = @membership_epoch
      AND (p.profile_key = @profile OR p.profile_key = N''admin'')
  ) BEGIN ;THROW 50001, N''DENIED'', 1; END;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].read_record
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint,
  @kind nvarchar(24), @id uniqueidentifier = NULL
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;
  SELECT id, kind, version, state, data_json, created_at, updated_at FROM [workflow].records
  WHERE tenant_id = @tenant_id AND kind = @kind AND (@id IS NULL OR id = @id)
  ORDER BY created_at DESC;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].check_profile
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint, @profile nvarchar(32)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC [workflow].assert_profile @tenant_id, @user_id, @tenant_epoch, @membership_epoch, @profile;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].create_graph_draft
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint,
  @draft_id uniqueidentifier, @draft_json nvarchar(max), @digest char(64), @idempotency_key uniqueidentifier
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  EXEC [workflow].assert_profile @tenant_id, @user_id, @tenant_epoch, @membership_epoch, N''editor'';
  IF ISJSON(@draft_json) <> 1 OR ISNULL(JSON_VALUE(@draft_json, ''$.kind''), N'''') <> N''graph-v1''
    OR @digest IS NULL OR @digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) OR @idempotency_key IS NULL
    OR LOWER(@draft_json) LIKE N''%"secret"%'' OR LOWER(@draft_json) LIKE N''%"password"%''
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max);
  SELECT @prior_digest = request_digest, @prior_receipt = receipt_json FROM [studio].command_receipts WITH (UPDLOCK, HOLDLOCK)
    WHERE tenant_id = @tenant_id AND idempotency_key = CONVERT(nvarchar(36), @idempotency_key);
  IF @prior_receipt IS NOT NULL
  BEGIN
    IF @prior_digest <> @digest OR JSON_VALUE(@prior_receipt, ''$.objectId'') <> CONVERT(nvarchar(36), @draft_id)
      BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
  END
  ELSE
  BEGIN
    IF EXISTS (SELECT 1 FROM [studio].draft_heads WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND id = @draft_id)
      BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
    INSERT INTO [studio].draft_heads (tenant_id, id, author_id, current_revision, state, current_digest)
      VALUES (@tenant_id, @draft_id, @user_id, 1, N''draft'', @digest);
    INSERT INTO [studio].draft_revisions (tenant_id, draft_id, revision, state, digest, author_id, draft_json)
      VALUES (@tenant_id, @draft_id, 1, N''draft'', @digest, @user_id, @draft_json);
    DECLARE @receipt_json nvarchar(max) = (SELECT CONVERT(nvarchar(36), @idempotency_key) AS commandId, CONVERT(nvarchar(36), @draft_id) AS objectId, 1 AS revision, N''draft'' AS state, @digest AS digest, JSON_QUERY(N''[]'') AS evidenceIds FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
    INSERT INTO [studio].command_receipts (tenant_id, idempotency_key, request_digest, receipt_json)
      VALUES (@tenant_id, CONVERT(nvarchar(36), @idempotency_key), @digest, @receipt_json);
  END;
  SELECT h.id, h.tenant_id, r.revision, r.state, r.digest, r.author_id, r.draft_json, r.created_at
  FROM [studio].draft_heads AS h INNER JOIN [studio].draft_revisions AS r ON r.tenant_id = h.tenant_id AND r.draft_id = h.id AND r.revision = 1
  WHERE h.tenant_id = @tenant_id AND h.id = @draft_id;
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].save_graph_draft
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint,
  @draft_id uniqueidentifier, @expected_revision bigint, @draft_json nvarchar(max), @digest char(64),
  @idempotency_key nvarchar(128), @request_digest char(64)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  EXEC [workflow].assert_profile @tenant_id, @user_id, @tenant_epoch, @membership_epoch, N''editor'';
  IF @expected_revision < 1 OR @idempotency_key IS NULL OR @request_digest IS NULL OR @digest IS NULL
    OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) OR @digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64)
    OR ISJSON(@draft_json) <> 1 OR ISNULL(JSON_VALUE(@draft_json, ''$.kind''), N'''') <> N''graph-v1''
    OR LOWER(@draft_json) LIKE N''%"secret"%'' OR LOWER(@draft_json) LIKE N''%"password"%''
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max), @revision bigint;
  SELECT @prior_digest = request_digest, @prior_receipt = receipt_json FROM [studio].command_receipts WITH (UPDLOCK, HOLDLOCK)
    WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key;
  IF @prior_receipt IS NOT NULL
  BEGIN
    IF @prior_digest <> @request_digest OR JSON_VALUE(@prior_receipt, ''$.objectId'') <> CONVERT(nvarchar(36), @draft_id)
      BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
    SET @revision = TRY_CONVERT(bigint, JSON_VALUE(@prior_receipt, ''$.revision''));
  END
  ELSE
  BEGIN
    DECLARE @current bigint;
    SELECT @current = current_revision FROM [studio].draft_heads WITH (UPDLOCK, HOLDLOCK)
      WHERE tenant_id = @tenant_id AND id = @draft_id AND state = N''draft'';
    IF @current IS NULL BEGIN ;THROW 50001, N''DENIED'', 1; END;
    IF @current <> @expected_revision BEGIN ;THROW 50003, N''STALE'', 1; END;
    SET @revision = @current + 1;
    INSERT INTO [studio].draft_revisions (tenant_id, draft_id, revision, state, digest, author_id, draft_json)
      VALUES (@tenant_id, @draft_id, @revision, N''draft'', @digest, @user_id, @draft_json);
    UPDATE [studio].draft_heads SET current_revision = @revision, current_digest = @digest, updated_at = SYSUTCDATETIME()
      WHERE tenant_id = @tenant_id AND id = @draft_id;
    DECLARE @receipt_json nvarchar(max) = (SELECT @idempotency_key AS commandId, CONVERT(nvarchar(36), @draft_id) AS objectId, @revision AS revision, N''draft'' AS state, @digest AS digest, JSON_QUERY(N''[]'') AS evidenceIds FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
    INSERT INTO [studio].command_receipts (tenant_id, idempotency_key, request_digest, receipt_json)
      VALUES (@tenant_id, @idempotency_key, @request_digest, @receipt_json);
  END;
  SELECT h.id, h.tenant_id, r.revision, r.state, r.digest, r.author_id, r.draft_json, r.created_at
  FROM [studio].draft_heads AS h INNER JOIN [studio].draft_revisions AS r ON r.tenant_id = h.tenant_id AND r.draft_id = h.id AND r.revision = @revision
  WHERE h.tenant_id = @tenant_id AND h.id = @draft_id;
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].read_definitions
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint,
  @id uniqueidentifier = NULL
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;
  SELECT id, draft_id, draft_revision, digest, definition_json, published_by, created_at FROM [workflow].definitions
  WHERE tenant_id = @tenant_id AND (@id IS NULL OR id = @id) ORDER BY created_at DESC;
END;
');

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
  IF @kind NOT IN (N''installation'', N''run'', N''effect'', N''summary'', N''grant'', N''circuit'', N''memory-import'', N''webhook-credential'') OR @expected_version < 0
    OR ISJSON(@data_json) <> 1 OR ISJSON(@receipt_json) <> 1 OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64)
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max);
  SELECT @prior_digest = request_digest, @prior_receipt = receipt_json FROM [workflow].command_receipts WITH (UPDLOCK, HOLDLOCK)
    WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key;
  IF @prior_receipt IS NOT NULL
  BEGIN
    IF @prior_digest <> @request_digest BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
    SELECT @prior_receipt AS receipt_json, CONVERT(bit, 1) AS replayed; COMMIT TRANSACTION; RETURN;
  END;
  DECLARE @version bigint;
  SELECT @version = version FROM [workflow].records WITH (UPDLOCK, HOLDLOCK)
    WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  IF ISNULL(@version, 0) <> @expected_version BEGIN ;THROW 50003, N''STALE'', 1; END;
  IF @version IS NULL
    INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json)
    VALUES (@tenant_id, @kind, @id, 1, @state, @data_json);
  ELSE
    UPDATE [workflow].records SET version = @version + 1, state = @state, data_json = @data_json, updated_at = SYSUTCDATETIME()
    WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  INSERT INTO [workflow].command_receipts (tenant_id, idempotency_key, request_digest, receipt_json)
    VALUES (@tenant_id, @idempotency_key, @request_digest, @receipt_json);
  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed; COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].publish_definition
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint,
  @id uniqueidentifier, @draft_id uniqueidentifier, @revision bigint, @draft_digest char(64),
  @digest char(64), @definition_json nvarchar(max), @review_digest char(64)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  EXEC [workflow].assert_profile @tenant_id, @user_id, @tenant_epoch, @membership_epoch, N''admin'';
  IF ISJSON(@definition_json) <> 1 OR @digest <> @review_digest BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  IF NOT EXISTS (
    SELECT 1 FROM [studio].draft_heads AS h WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN [studio].run_evidence AS e ON e.tenant_id = h.tenant_id AND e.draft_id = h.id
    WHERE h.tenant_id = @tenant_id AND h.id = @draft_id AND h.current_revision = @revision AND h.current_digest = @draft_digest
      AND e.revision = @revision AND e.subject_digest = @draft_digest AND e.kind = N''checks'' AND e.status = N''passed''
      AND JSON_VALUE(e.report_json, ''$.classification'') = N''live''
      AND JSON_VALUE(e.report_json, ''$.candidateDigest'') = @digest
  ) BEGIN ;THROW 50003, N''STALE'', 1; END;
  DECLARE @existing_digest char(64);
  SELECT @existing_digest = digest FROM [workflow].definitions WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND draft_id = @draft_id AND draft_revision = @revision;
  IF @existing_digest IS NOT NULL
  BEGIN
    IF @existing_digest <> @digest BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
    COMMIT TRANSACTION; RETURN;
  END;
  INSERT INTO [workflow].definitions (tenant_id, id, draft_id, draft_revision, digest, definition_json, published_by)
    VALUES (@tenant_id, @id, @draft_id, @revision, @digest, @definition_json, @user_id);
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
  IF @kind NOT IN (N''run'', N''effect'', N''summary'', N''installation'', N''circuit'') OR @expected_version < 0 OR ISJSON(@data_json) <> 1
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  DECLARE @version bigint;
  SELECT @version = version FROM [workflow].records WITH (UPDLOCK, HOLDLOCK)
    WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  IF ISNULL(@version, 0) <> @expected_version BEGIN ;THROW 50003, N''STALE'', 1; END;
  IF @kind = N''installation'' AND NOT EXISTS (
    SELECT 1 FROM [workflow].records
    WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id AND state IN (N''offline'', N''healthy'')
      AND @state = N''healthy'' AND JSON_VALUE(data_json, ''$.route'') = N''private''
      AND JSON_VALUE(data_json, ''$.tokenHash'') = JSON_VALUE(@data_json, ''$.tokenHash'')
      AND JSON_VALUE(data_json, ''$.manifest.digest'') = JSON_VALUE(@data_json, ''$.manifest.digest'')
  ) BEGIN ;THROW 50001, N''DENIED'', 1; END;
  IF @version IS NULL
    INSERT INTO [workflow].records (tenant_id, kind, id, version, state, data_json)
    VALUES (@tenant_id, @kind, @id, 1, @state, @data_json);
  ELSE
    UPDATE [workflow].records SET version = @version + 1, state = @state, data_json = @data_json, updated_at = SYSUTCDATETIME()
    WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  SELECT id, kind, version, state, data_json FROM [workflow].records WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].worker_read_record
  @tenant_id uniqueidentifier, @kind nvarchar(24), @id uniqueidentifier
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, kind, version, state, data_json FROM [workflow].records WHERE tenant_id = @tenant_id AND kind = @kind AND id = @id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].worker_read_definition
  @tenant_id uniqueidentifier, @id uniqueidentifier
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, draft_id, draft_revision, digest, definition_json FROM [workflow].definitions
  WHERE tenant_id = @tenant_id AND id = @id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].worker_list_records
  @tenant_id uniqueidentifier, @kind nvarchar(24)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, kind, version, state, data_json FROM [workflow].records
  WHERE tenant_id = @tenant_id AND kind = @kind ORDER BY created_at DESC;
END;
');

CREATE ROLE platform_workflow_browser AUTHORIZATION dbo;
CREATE ROLE platform_workflow_worker AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::[workflow].read_record TO platform_workflow_browser;
GRANT EXECUTE ON OBJECT::[workflow].check_profile TO platform_workflow_browser;
GRANT EXECUTE ON OBJECT::[workflow].create_graph_draft TO platform_workflow_browser;
GRANT EXECUTE ON OBJECT::[workflow].save_graph_draft TO platform_workflow_browser;
GRANT EXECUTE ON OBJECT::[workflow].read_definitions TO platform_workflow_browser;
GRANT EXECUTE ON OBJECT::[workflow].write_record TO platform_workflow_browser;
GRANT EXECUTE ON OBJECT::[workflow].publish_definition TO platform_workflow_browser;
GRANT EXECUTE ON OBJECT::[workflow].worker_read_record TO platform_workflow_worker;
GRANT EXECUTE ON OBJECT::[workflow].worker_read_definition TO platform_workflow_worker;
GRANT EXECUTE ON OBJECT::[workflow].worker_list_records TO platform_workflow_worker;
GRANT EXECUTE ON OBJECT::[workflow].worker_write_record TO platform_workflow_worker;

COMMIT TRANSACTION;
