SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

EXEC(N'
CREATE OR ALTER PROCEDURE [workflow].read_run_history
  @tenant_id uniqueidentifier,
  @user_id uniqueidentifier,
  @tenant_epoch bigint,
  @membership_epoch bigint,
  @page_size int,
  @before_created_at nvarchar(33) = NULL,
  @before_id uniqueidentifier = NULL,
  @run_id uniqueidentifier = NULL
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;

  EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;

  DECLARE @before datetime2(7) = TRY_CONVERT(datetime2(7), @before_created_at, 126);
  IF @page_size < 1 OR @page_size > 100
    OR (@before_created_at IS NULL AND @before_id IS NOT NULL)
    OR (@before_created_at IS NOT NULL AND (@before_id IS NULL OR @before IS NULL))
    OR (@run_id IS NOT NULL AND (@before_created_at IS NOT NULL OR @before_id IS NOT NULL))
    THROW 50002, N''INVALID'', 1;

  DECLARE @selected TABLE (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    kind nvarchar(24) NOT NULL,
    version bigint NOT NULL,
    state nvarchar(32) NOT NULL,
    data_json nvarchar(max) NOT NULL,
    created_at datetime2(7) NOT NULL
  );

  IF @run_id IS NOT NULL
    INSERT INTO @selected (id, kind, version, state, data_json, created_at)
    SELECT id, kind, version, state, data_json, created_at
    FROM [workflow].records
    WHERE tenant_id = @tenant_id AND kind = N''run'' AND id = @run_id;
  ELSE
    INSERT INTO @selected (id, kind, version, state, data_json, created_at)
    SELECT TOP (@page_size + 1) id, kind, version, state, data_json, created_at
    FROM [workflow].records
    WHERE tenant_id = @tenant_id
      AND kind = N''run''
      AND (@before IS NULL OR created_at < @before OR (created_at = @before AND id < @before_id))
    ORDER BY created_at DESC, id DESC;

  DECLARE @has_more bit = CASE WHEN @run_id IS NULL AND (SELECT COUNT(*) FROM @selected) > @page_size THEN 1 ELSE 0 END;
  ;WITH overflow AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS position
    FROM @selected
  )
  DELETE selected
  FROM @selected AS selected
  INNER JOIN overflow ON overflow.id = selected.id
  WHERE overflow.position > @page_size;

  SELECT id, kind, version, state, data_json, CONVERT(nvarchar(33), created_at, 126) AS cursor_created_at
  FROM @selected
  ORDER BY created_at DESC, id DESC;

  SELECT effect.id, effect.kind, effect.version, effect.state, effect.data_json
  FROM [workflow].records AS effect
  INNER JOIN @selected AS run ON JSON_VALUE(effect.data_json, N''$.runId'') = CONVERT(nvarchar(36), run.id)
  WHERE effect.tenant_id = @tenant_id AND effect.kind = N''effect'';

  SELECT retrieval.id, retrieval.kind, retrieval.version, retrieval.state, retrieval.data_json
  FROM [workflow].records AS retrieval
  INNER JOIN @selected AS run ON JSON_VALUE(retrieval.data_json, N''$.runId'') = CONVERT(nvarchar(36), run.id)
  WHERE retrieval.tenant_id = @tenant_id AND retrieval.kind = N''memory-retrieval'';

  SELECT @has_more AS has_more;
END;
');

GRANT EXECUTE ON OBJECT::[workflow].read_run_history TO platform_workflow_browser;

COMMIT TRANSACTION;
