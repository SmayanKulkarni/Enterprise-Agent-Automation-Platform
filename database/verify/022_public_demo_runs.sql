SET NOCOUNT ON;
SET XACT_ABORT ON;

IF SCHEMA_ID(N'public_demo') IS NULL THROW 50000, N'The public_demo schema is missing.', 1;

DECLARE @procedure sysname;
DECLARE procedures CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES (N'write_run'), (N'read_own_run'), (N'purge_runs')) AS p(name);
OPEN procedures; FETCH NEXT FROM procedures INTO @procedure;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sys.database_permissions
    WHERE class = 1 AND permission_name = N'EXECUTE' AND state = N'G'
      AND major_id = OBJECT_ID(N'public_demo.' + @procedure)
      AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_workflow_browser')
  ) THROW 50000, N'A demo procedure is not granted to the browser role.', 1;
  IF EXISTS (
    SELECT 1 FROM sys.database_permissions
    WHERE class = 1 AND major_id = OBJECT_ID(N'public_demo.' + @procedure) AND permission_name = N'EXECUTE'
      AND grantee_principal_id <> DATABASE_PRINCIPAL_ID(N'platform_workflow_browser')
      AND grantee_principal_id <> DATABASE_PRINCIPAL_ID(N'dbo')
  ) THROW 50000, N'A demo procedure is granted beyond the browser role.', 1;
  FETCH NEXT FROM procedures INTO @procedure;
END;
CLOSE procedures; DEALLOCATE procedures;

IF EXISTS (
  SELECT 1 FROM sys.database_permissions
  WHERE class = 1 AND major_id IN (OBJECT_ID(N'public_demo.runs'), OBJECT_ID(N'public_demo.definitions'))
    AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'platform_workflow_browser')
) THROW 50000, N'The browser role must not touch demo tables directly.', 1;

DECLARE @digest char(64) = REPLICATE(N'a', 64), @graph nvarchar(max) = N'{"nodes":[]}', @run nvarchar(max) = N'{"id":"x"}';
DECLARE @first uniqueidentifier = NEWID(), @second uniqueidentifier = NEWID(), @key char(32) = REPLICATE(N'b', 32), @started datetime2(7) = SYSUTCDATETIME();
DECLARE @bad bit = 0, @third uniqueidentifier = NEWID();

BEGIN TRY EXEC [public_demo].write_run @third, @digest, N'not json', @key, N'sample', N'return', @started, @run; END TRY BEGIN CATCH IF ERROR_NUMBER() = 50002 SET @bad = 1; END CATCH;
IF @bad = 0 THROW 50000, N'Invalid JSON must be rejected.', 1;
SET @bad = 0;
BEGIN TRY EXEC [public_demo].write_run @third, @digest, @graph, @key, N'other', N'return', @started, @run; END TRY BEGIN CATCH IF ERROR_NUMBER() = 50002 SET @bad = 1; END CATCH;
IF @bad = 0 THROW 50000, N'An unknown source must be rejected.', 1;


BEGIN TRANSACTION;
EXEC [public_demo].write_run @first, @digest, @graph, @key, N'sample', N'return', @started, @run;
EXEC [public_demo].write_run @second, @digest, @graph, @key, N'github', N'accept', @started, @run;
IF (SELECT COUNT(*) FROM [public_demo].definitions WHERE digest = @digest) <> 1 THROW 50000, N'The definition revision must be stored once.', 1;
IF (SELECT COUNT(*) FROM [public_demo].runs WHERE claim_key = @key) <> 2 THROW 50000, N'Runs were not stored.', 1;

UPDATE [public_demo].runs SET created_at = DATEADD(day, -31, SYSUTCDATETIME()) WHERE id = @first;
DECLARE @removed TABLE (removed int);
INSERT INTO @removed EXEC [public_demo].purge_runs 30;
IF NOT EXISTS (SELECT 1 FROM @removed WHERE removed >= 1) THROW 50000, N'The purge removed nothing.', 1;
IF EXISTS (SELECT 1 FROM [public_demo].runs WHERE id = @first) THROW 50000, N'An expired run survived the purge.', 1;
IF NOT EXISTS (SELECT 1 FROM [public_demo].runs WHERE id = @second) THROW 50000, N'A fresh run was purged.', 1;
IF NOT EXISTS (SELECT 1 FROM [public_demo].definitions WHERE digest = @digest) THROW 50000, N'A referenced definition was purged.', 1;

CREATE TABLE #own (run_json nvarchar(max), definition_digest char(64), graph_json nvarchar(max));
INSERT INTO #own EXEC [public_demo].read_own_run @key;
IF (SELECT COUNT(*) FROM #own) <> 1 THROW 50000, N'read_own_run must return one run.', 1;
DELETE FROM #own;
INSERT INTO #own EXEC [public_demo].read_own_run N'cccccccccccccccccccccccccccccccc';
IF EXISTS (SELECT 1 FROM #own) THROW 50000, N'Another address must not see this run.', 1;
DROP TABLE #own;
ROLLBACK TRANSACTION;

SELECT N'022_public_demo_runs' AS migration, N'passed' AS status;
