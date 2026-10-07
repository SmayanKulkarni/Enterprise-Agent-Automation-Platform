/* Public demo: bounded, self-purging run storage in its own schema. Holds no tenant, identity or group data, so no tenant or group read can reach it. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'public_demo') IS NULL EXEC(N'CREATE SCHEMA [public_demo] AUTHORIZATION dbo;');

CREATE TABLE [public_demo].definitions (
  digest char(64) NOT NULL CONSTRAINT PK_demo_definitions PRIMARY KEY CHECK (digest NOT LIKE N'%[^0-9a-f]%'),
  graph_json nvarchar(max) NOT NULL CHECK (ISJSON(graph_json) = 1 AND DATALENGTH(graph_json) <= 262144),
  created_at datetime2(7) NOT NULL CONSTRAINT DF_demo_definitions_created_at DEFAULT (SYSUTCDATETIME())
);

CREATE TABLE [public_demo].runs (
  id uniqueidentifier NOT NULL CONSTRAINT PK_demo_runs PRIMARY KEY,
  definition_digest char(64) NOT NULL CONSTRAINT FK_demo_runs_definition REFERENCES [public_demo].definitions (digest),
  claim_key char(32) NOT NULL,
  source nvarchar(16) NOT NULL CHECK (source IN (N'sample', N'github')),
  branch nvarchar(16) NOT NULL CHECK (branch IN (N'accept', N'return')),
  started_at datetime2(7) NOT NULL,
  run_json nvarchar(max) NOT NULL CHECK (ISJSON(run_json) = 1 AND DATALENGTH(run_json) <= 262144),
  created_at datetime2(7) NOT NULL CONSTRAINT DF_demo_runs_created_at DEFAULT (SYSUTCDATETIME())
);
CREATE INDEX IX_demo_runs_created ON [public_demo].runs (created_at) INCLUDE (definition_digest);
CREATE INDEX IX_demo_runs_claim ON [public_demo].runs (claim_key, created_at DESC);

EXEC(N'
CREATE OR ALTER PROCEDURE [public_demo].purge_runs
  @retention_days int = 30
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @retention_days < 1 OR @retention_days > 365 BEGIN ;THROW 50002, N''INVALID'', 1; END;
  DECLARE @cutoff datetime2(7) = DATEADD(day, -@retention_days, SYSUTCDATETIME());
  BEGIN TRANSACTION;
  DELETE FROM [public_demo].runs WHERE created_at < @cutoff;
  DECLARE @removed int = @@ROWCOUNT;
  DELETE FROM [public_demo].definitions WHERE NOT EXISTS (SELECT 1 FROM [public_demo].runs AS r WHERE r.definition_digest = [public_demo].definitions.digest);
  COMMIT TRANSACTION;
  SELECT @removed AS removed;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [public_demo].write_run
  @id uniqueidentifier, @digest char(64), @graph_json nvarchar(max), @claim_key char(32), @source nvarchar(16),
  @branch nvarchar(16), @started_at datetime2(7), @run_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @id IS NULL OR @digest IS NULL OR @claim_key IS NULL OR @started_at IS NULL OR ISJSON(@graph_json) <> 1 OR ISJSON(@run_json) <> 1
    OR DATALENGTH(@graph_json) > 262144 OR DATALENGTH(@run_json) > 262144 OR @source NOT IN (N''sample'', N''github'') OR @branch NOT IN (N''accept'', N''return'')
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  BEGIN TRANSACTION;
  IF (SELECT COUNT_BIG(*) FROM [public_demo].runs WITH (TABLOCKX)) >= 5000
    BEGIN ;THROW 50005, N''FULL'', 1; END;
  IF NOT EXISTS (SELECT 1 FROM [public_demo].definitions WITH (UPDLOCK, HOLDLOCK) WHERE digest = @digest)
    INSERT INTO [public_demo].definitions (digest, graph_json) VALUES (@digest, @graph_json);
  INSERT INTO [public_demo].runs (id, definition_digest, claim_key, source, branch, started_at, run_json)
  VALUES (@id, @digest, @claim_key, @source, @branch, @started_at, @run_json);
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [public_demo].read_own_run
  @claim_key char(32)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  IF @claim_key IS NULL BEGIN ;THROW 50002, N''INVALID'', 1; END;
  SELECT TOP (1) r.run_json, r.definition_digest, d.graph_json
  FROM [public_demo].runs AS r
  INNER JOIN [public_demo].definitions AS d ON d.digest = r.definition_digest
  WHERE r.claim_key = @claim_key
  ORDER BY r.created_at DESC;
END;
');

GRANT EXECUTE ON OBJECT::[public_demo].write_run TO platform_workflow_browser;
GRANT EXECUTE ON OBJECT::[public_demo].read_own_run TO platform_workflow_browser;
GRANT EXECUTE ON OBJECT::[public_demo].purge_runs TO platform_workflow_browser;

COMMIT TRANSACTION;
