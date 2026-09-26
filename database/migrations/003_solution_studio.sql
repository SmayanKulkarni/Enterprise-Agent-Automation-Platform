/* Tenant-fenced Solution Studio drafts, immutable revisions, evidence and command receipts. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF SCHEMA_ID(N'studio') IS NULL EXEC(N'CREATE SCHEMA [studio] AUTHORIZATION dbo;');

CREATE TABLE [studio].draft_heads (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  id uniqueidentifier NOT NULL,
  author_id uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  current_revision bigint NOT NULL CHECK (current_revision > 0),
  state nvarchar(16) NOT NULL CHECK (state IN (N'draft', N'candidate', N'approved', N'signed', N'published', N'rejected')),
  current_digest char(64) NOT NULL,
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  updated_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_studio_draft_heads PRIMARY KEY (tenant_id, id)
);

CREATE TABLE [studio].draft_revisions (
  tenant_id uniqueidentifier NOT NULL,
  draft_id uniqueidentifier NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  state nvarchar(16) NOT NULL CHECK (state IN (N'draft', N'candidate', N'approved', N'signed', N'published', N'rejected')),
  digest char(64) NOT NULL,
  author_id uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  draft_json nvarchar(max) NOT NULL CHECK (ISJSON(draft_json) = 1 AND LEFT(LTRIM(draft_json), 1) = N'{'),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_studio_draft_revisions PRIMARY KEY (tenant_id, draft_id, revision),
  CONSTRAINT FK_studio_revision_head FOREIGN KEY (tenant_id, draft_id) REFERENCES [studio].draft_heads (tenant_id, id)
);

CREATE TABLE [studio].run_evidence (
  tenant_id uniqueidentifier NOT NULL,
  id uniqueidentifier NOT NULL,
  draft_id uniqueidentifier NOT NULL,
  revision bigint NOT NULL,
  subject_digest char(64) NOT NULL,
  kind nvarchar(16) NOT NULL CHECK (kind IN (N'checks', N'simulation', N'evaluation')),
  status nvarchar(16) NOT NULL CHECK (status IN (N'passed', N'failed', N'blocked', N'inconclusive')),
  report_json nvarchar(max) NOT NULL CHECK (ISJSON(report_json) = 1 AND LEFT(LTRIM(report_json), 1) = N'{'),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_studio_run_evidence PRIMARY KEY (tenant_id, id),
  CONSTRAINT FK_studio_run_revision FOREIGN KEY (tenant_id, draft_id, revision) REFERENCES [studio].draft_revisions (tenant_id, draft_id, revision)
);

CREATE TABLE [studio].review_evidence (
  tenant_id uniqueidentifier NOT NULL,
  id uniqueidentifier NOT NULL,
  draft_id uniqueidentifier NOT NULL,
  revision bigint NOT NULL,
  candidate_digest char(64) NOT NULL,
  decision nvarchar(16) NOT NULL CHECK (decision IN (N'approved', N'rejected', N'signed', N'published')),
  actor_id uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  reason nvarchar(2000) NOT NULL,
  evidence_ids_json nvarchar(max) NOT NULL CHECK (ISJSON(evidence_ids_json) = 1 AND LEFT(LTRIM(evidence_ids_json), 1) = N'['),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_studio_review_evidence PRIMARY KEY (tenant_id, id),
  CONSTRAINT FK_studio_review_revision FOREIGN KEY (tenant_id, draft_id, revision) REFERENCES [studio].draft_revisions (tenant_id, draft_id, revision)
);

CREATE TABLE [studio].command_receipts (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  idempotency_key nvarchar(128) NOT NULL,
  request_digest char(64) NOT NULL,
  receipt_json nvarchar(max) NOT NULL CHECK (ISJSON(receipt_json) = 1 AND LEFT(LTRIM(receipt_json), 1) = N'{'),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_studio_command_receipts PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE INDEX IX_studio_draft_heads_tenant_updated ON [studio].draft_heads (tenant_id, updated_at DESC) INCLUDE (id, current_revision, state, current_digest);
CREATE INDEX IX_studio_run_evidence_revision ON [studio].run_evidence (tenant_id, draft_id, revision, created_at DESC);
CREATE INDEX IX_studio_review_evidence_revision ON [studio].review_evidence (tenant_id, draft_id, revision, created_at DESC);

EXEC(N'
CREATE OR ALTER PROCEDURE [studio].assert_context
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (
    SELECT 1 FROM [identity].tenants AS t
    INNER JOIN [identity].memberships AS m ON m.tenant_id = t.id
    WHERE t.id = @tenant_id AND t.status = N''active'' AND t.epoch = @tenant_epoch
      AND m.user_id = @user_id AND m.status = N''current'' AND m.epoch = @membership_epoch
  ) BEGIN ;THROW 50001, N''DENIED'', 1; END;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [studio].create_draft
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint,
  @draft_id uniqueidentifier, @draft_json nvarchar(max), @digest char(64)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;
  IF @draft_id IS NULL OR @draft_json IS NULL OR @digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) OR ISJSON(@draft_json) <> 1 OR LEFT(LTRIM(@draft_json), 1) <> N''{''
    OR LOWER(@draft_json) LIKE N''%"secret"%'' OR LOWER(@draft_json) LIKE N''%"password"%'' OR LOWER(@draft_json) LIKE N''%"executable"%''
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM [studio].draft_heads WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND id = @draft_id) BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
  INSERT INTO [studio].draft_heads (tenant_id, id, author_id, current_revision, state, current_digest) VALUES (@tenant_id, @draft_id, @user_id, 1, N''draft'', @digest);
  INSERT INTO [studio].draft_revisions (tenant_id, draft_id, revision, state, digest, author_id, draft_json) VALUES (@tenant_id, @draft_id, 1, N''draft'', @digest, @user_id, @draft_json);
  COMMIT TRANSACTION;
  SELECT h.id, h.tenant_id, h.current_revision AS revision, h.state, h.current_digest AS digest, h.author_id, r.draft_json, r.created_at
  FROM [studio].draft_heads AS h INNER JOIN [studio].draft_revisions AS r ON r.tenant_id = h.tenant_id AND r.draft_id = h.id AND r.revision = h.current_revision
  WHERE h.tenant_id = @tenant_id AND h.id = @draft_id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [studio].get_draft
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint, @draft_id uniqueidentifier
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;
  SELECT h.id, h.tenant_id, h.current_revision AS revision, h.state, h.current_digest AS digest, h.author_id, r.draft_json, r.created_at
  FROM [studio].draft_heads AS h INNER JOIN [studio].draft_revisions AS r ON r.tenant_id = h.tenant_id AND r.draft_id = h.id AND r.revision = h.current_revision
  WHERE h.tenant_id = @tenant_id AND h.id = @draft_id;
  IF @@ROWCOUNT = 0 BEGIN ;THROW 50001, N''DENIED'', 1; END;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [studio].list_drafts
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;
  SELECT h.id, h.tenant_id, h.current_revision AS revision, h.state, h.current_digest AS digest, h.author_id, r.draft_json, r.created_at
  FROM [studio].draft_heads AS h INNER JOIN [studio].draft_revisions AS r ON r.tenant_id = h.tenant_id AND r.draft_id = h.id AND r.revision = h.current_revision
  WHERE h.tenant_id = @tenant_id ORDER BY h.updated_at DESC, h.id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [studio].save_draft
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint,
  @draft_id uniqueidentifier, @expected_revision bigint, @draft_json nvarchar(max), @digest char(64), @idempotency_key nvarchar(128), @request_digest char(64)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;
  IF @expected_revision < 1 OR @idempotency_key IS NULL OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) OR @digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) OR ISJSON(@draft_json) <> 1 OR LEFT(LTRIM(@draft_json), 1) <> N''{'' BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM [studio].command_receipts WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key)
  BEGIN
    IF EXISTS (SELECT 1 FROM [studio].command_receipts WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key AND request_digest = @request_digest)
    BEGIN
      COMMIT TRANSACTION;
      EXEC [studio].get_draft @tenant_id, @user_id, @tenant_epoch, @membership_epoch, @draft_id;
      RETURN;
    END;
    ;THROW 50004, N''CONFLICT'', 1;
  END;
  DECLARE @current bigint; SELECT @current = current_revision FROM [studio].draft_heads WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND id = @draft_id AND state = N''draft'';
  IF @current IS NULL BEGIN ;THROW 50001, N''DENIED'', 1; END;
  IF @current <> @expected_revision BEGIN ;THROW 50003, N''STALE'', 1; END;
  DECLARE @next bigint = @current + 1;
  INSERT INTO [studio].draft_revisions (tenant_id, draft_id, revision, state, digest, author_id, draft_json) VALUES (@tenant_id, @draft_id, @next, N''draft'', @digest, @user_id, @draft_json);
  UPDATE [studio].draft_heads SET current_revision = @next, current_digest = @digest, updated_at = SYSUTCDATETIME() WHERE tenant_id = @tenant_id AND id = @draft_id;
  DECLARE @receipt_json nvarchar(max) = (SELECT @idempotency_key AS commandId, CONVERT(nvarchar(36), @draft_id) AS objectId, @next AS revision, N''draft'' AS state, @digest AS digest, JSON_QUERY(N''[]'') AS evidenceIds FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
  INSERT INTO [studio].command_receipts (tenant_id, idempotency_key, request_digest, receipt_json) VALUES (@tenant_id, @idempotency_key, @request_digest, @receipt_json);
  COMMIT TRANSACTION;
  EXEC [studio].get_draft @tenant_id, @user_id, @tenant_epoch, @membership_epoch, @draft_id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [studio].append_run
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint, @draft_id uniqueidentifier, @evidence_id uniqueidentifier, @revision bigint, @subject_digest char(64), @kind nvarchar(16), @status nvarchar(16), @report_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;
  IF ISJSON(@report_json) <> 1 OR LEFT(LTRIM(@report_json), 1) <> N''{'' OR @subject_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) BEGIN ;THROW 50002, N''INVALID'', 1; END;
  INSERT INTO [studio].run_evidence (tenant_id, id, draft_id, revision, subject_digest, kind, status, report_json) VALUES (@tenant_id, @evidence_id, @draft_id, @revision, @subject_digest, @kind, @status, @report_json);
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [studio].append_review
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint, @draft_id uniqueidentifier, @evidence_id uniqueidentifier, @revision bigint, @candidate_digest char(64), @decision nvarchar(16), @actor_id uniqueidentifier, @reason nvarchar(2000), @evidence_ids_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;
  IF @actor_id <> @user_id OR @reason IS NULL OR ISJSON(@evidence_ids_json) <> 1 OR LEFT(LTRIM(@evidence_ids_json), 1) <> N''['' OR @candidate_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) BEGIN ;THROW 50002, N''INVALID'', 1; END;
  INSERT INTO [studio].review_evidence (tenant_id, id, draft_id, revision, candidate_digest, decision, actor_id, reason, evidence_ids_json) VALUES (@tenant_id, @evidence_id, @draft_id, @revision, @candidate_digest, @decision, @actor_id, @reason, @evidence_ids_json);
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [studio].remember_command
  @tenant_id uniqueidentifier, @idempotency_key nvarchar(128), @request_digest char(64), @receipt_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @idempotency_key IS NULL OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64) OR ISJSON(@receipt_json) <> 1 OR LEFT(LTRIM(@receipt_json), 1) <> N''{'' BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM [studio].command_receipts WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key)
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM [studio].command_receipts WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key AND request_digest = @request_digest) BEGIN ;THROW 50004, N''CONFLICT'', 1; END;
    SELECT receipt_json FROM [studio].command_receipts WHERE tenant_id = @tenant_id AND idempotency_key = @idempotency_key; COMMIT TRANSACTION; RETURN;
  END;
  INSERT INTO [studio].command_receipts (tenant_id, idempotency_key, request_digest, receipt_json) VALUES (@tenant_id, @idempotency_key, @request_digest, @receipt_json);
  SELECT @receipt_json AS receipt_json; COMMIT TRANSACTION;
END;
');

CREATE ROLE platform_studio_runtime AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::[studio].create_draft TO platform_studio_runtime;
GRANT EXECUTE ON OBJECT::[studio].get_draft TO platform_studio_runtime;
GRANT EXECUTE ON OBJECT::[studio].list_drafts TO platform_studio_runtime;
GRANT EXECUTE ON OBJECT::[studio].save_draft TO platform_studio_runtime;
GRANT EXECUTE ON OBJECT::[studio].append_run TO platform_studio_runtime;
GRANT EXECUTE ON OBJECT::[studio].append_review TO platform_studio_runtime;
GRANT EXECUTE ON OBJECT::[studio].remember_command TO platform_studio_runtime;

COMMIT TRANSACTION;
