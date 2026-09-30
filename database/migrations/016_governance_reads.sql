/* Fenced group reads over workflow.run_facts: overview KPIs, run series and workflow portfolio. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRANSACTION;

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].read_overview
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint,
  @from datetime2(7), @to datetime2(7), @tenant_id uniqueidentifier = NULL
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC [governance].assert_group_admin @group_id, @user_id, @group_epoch, @admin_epoch;
  IF @from IS NULL OR @to IS NULL OR @to <= @from OR DATEDIFF_BIG(millisecond, @from, @to) > 2678400000
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  IF @tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [identity].tenant_group_members WHERE group_id = @group_id AND tenant_id = @tenant_id)
    BEGIN ;THROW 50001, N''DENIED'', 1; END;

  DECLARE @span_ms bigint = DATEDIFF_BIG(millisecond, @from, @to);
  DECLARE @previous_from datetime2(7) = DATEADD(millisecond, -CONVERT(int, @span_ms % 1000), DATEADD(second, -CONVERT(int, @span_ms / 1000), @from));
  DECLARE @scope TABLE (tenant_id uniqueidentifier NOT NULL PRIMARY KEY, slug nvarchar(128) NOT NULL);
  DECLARE @windows TABLE (window_name nvarchar(8) NOT NULL PRIMARY KEY, window_from datetime2(7) NOT NULL, window_to datetime2(7) NOT NULL);
  DECLARE @runs TABLE (tenant_id uniqueidentifier NOT NULL, window_name nvarchar(8) NOT NULL, status nvarchar(32) NOT NULL, tokens bigint NOT NULL, cost decimal(18,6) NOT NULL, usage_estimated bit NOT NULL, duration_ms bigint NULL);

  INSERT INTO @scope (tenant_id, slug)
  SELECT gm.tenant_id, t.slug
  FROM [identity].tenant_group_members AS gm
  INNER JOIN [identity].tenants AS t ON t.id = gm.tenant_id
  WHERE gm.group_id = @group_id AND (@tenant_id IS NULL OR gm.tenant_id = @tenant_id);

  INSERT INTO @windows (window_name, window_from, window_to) VALUES (N''current'', @from, @to), (N''previous'', @previous_from, @from);

  INSERT INTO @runs (tenant_id, window_name, status, tokens, cost, usage_estimated, duration_ms)
  SELECT f.tenant_id, w.window_name, f.status, f.tokens, f.cost, f.usage_estimated,
    CASE WHEN f.finished_at IS NOT NULL THEN DATEDIFF_BIG(millisecond, f.started_at, f.finished_at) END
  FROM @scope AS s
  CROSS JOIN @windows AS w
  INNER JOIN [workflow].run_facts AS f ON f.tenant_id = s.tenant_id AND f.started_at >= w.window_from AND f.started_at < w.window_to;

  SELECT s.tenant_id, s.slug, w.window_name AS [window],
    COUNT(r.status) AS runs,
    ISNULL(SUM(CASE WHEN r.status = N''completed'' THEN 1 ELSE 0 END), 0) AS completed,
    ISNULL(SUM(CASE WHEN r.status = N''failed'' THEN 1 ELSE 0 END), 0) AS failed,
    ISNULL(SUM(CASE WHEN r.status = N''unknown-outcome'' THEN 1 ELSE 0 END), 0) AS unknown_outcome,
    MAX(p.p95_ms) AS p95_ms,
    ISNULL(SUM(r.tokens), 0) AS tokens,
    ISNULL(SUM(r.cost), 0) AS cost,
    ISNULL(SUM(CASE WHEN r.usage_estimated = 1 THEN 1 ELSE 0 END), 0) AS estimated_runs
  FROM @scope AS s
  CROSS JOIN @windows AS w
  LEFT JOIN @runs AS r ON r.tenant_id = s.tenant_id AND r.window_name = w.window_name
  LEFT JOIN (
    SELECT DISTINCT tenant_id, window_name, PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) OVER (PARTITION BY tenant_id, window_name) AS p95_ms
    FROM @runs
  ) AS p ON p.tenant_id = s.tenant_id AND p.window_name = w.window_name
  GROUP BY s.tenant_id, s.slug, w.window_name
  ORDER BY s.slug, s.tenant_id, w.window_name;

  SELECT w.window_name AS [window],
    COUNT(r.status) AS runs,
    ISNULL(SUM(CASE WHEN r.status = N''completed'' THEN 1 ELSE 0 END), 0) AS completed,
    ISNULL(SUM(CASE WHEN r.status = N''failed'' THEN 1 ELSE 0 END), 0) AS failed,
    ISNULL(SUM(CASE WHEN r.status = N''unknown-outcome'' THEN 1 ELSE 0 END), 0) AS unknown_outcome,
    MAX(p.p95_ms) AS p95_ms,
    ISNULL(SUM(r.tokens), 0) AS tokens,
    ISNULL(SUM(r.cost), 0) AS cost,
    ISNULL(SUM(CASE WHEN r.usage_estimated = 1 THEN 1 ELSE 0 END), 0) AS estimated_runs
  FROM @windows AS w
  LEFT JOIN @runs AS r ON r.window_name = w.window_name
  LEFT JOIN (
    SELECT DISTINCT window_name, PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) OVER (PARTITION BY window_name) AS p95_ms
    FROM @runs
  ) AS p ON p.window_name = w.window_name
  GROUP BY w.window_name
  ORDER BY w.window_name;

  SELECT f.tenant_id, COUNT(*) AS pending_approvals
  FROM @scope AS s
  INNER JOIN [workflow].run_facts AS f ON f.tenant_id = s.tenant_id AND f.status = N''waiting-approval'' AND f.waiting_expires_at > SYSUTCDATETIME()
  GROUP BY f.tenant_id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].read_run_series
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint,
  @from datetime2(7), @to datetime2(7), @bucket_minutes int, @tenant_id uniqueidentifier = NULL
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC [governance].assert_group_admin @group_id, @user_id, @group_epoch, @admin_epoch;
  IF @from IS NULL OR @to IS NULL OR @to <= @from OR DATEDIFF_BIG(millisecond, @from, @to) > 2678400000 OR @bucket_minutes IS NULL OR @bucket_minutes NOT IN (1, 5, 60, 180)
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  IF @tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [identity].tenant_group_members WHERE group_id = @group_id AND tenant_id = @tenant_id)
    BEGIN ;THROW 50001, N''DENIED'', 1; END;

  DECLARE @scope TABLE (tenant_id uniqueidentifier NOT NULL PRIMARY KEY, slug nvarchar(128) NOT NULL);
  INSERT INTO @scope (tenant_id, slug)
  SELECT gm.tenant_id, t.slug
  FROM [identity].tenant_group_members AS gm
  INNER JOIN [identity].tenants AS t ON t.id = gm.tenant_id
  WHERE gm.group_id = @group_id AND (@tenant_id IS NULL OR gm.tenant_id = @tenant_id);

  SELECT b.tenant_id, s.slug, b.bucket_start,
    SUM(CASE WHEN b.status = N''completed'' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN b.status = N''failed'' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN b.status = N''unknown-outcome'' THEN 1 ELSE 0 END) AS unknown_outcome,
    SUM(b.cost) AS cost,
    SUM(b.tokens) AS tokens,
    SUM(CASE WHEN b.usage_estimated = 1 THEN 1 ELSE 0 END) AS estimated_runs
  FROM (
    SELECT f.tenant_id, f.status, f.cost, f.tokens, f.usage_estimated,
      DATEADD(minute, CONVERT(int, DATEDIFF_BIG(millisecond, @from, f.started_at) / (@bucket_minutes * 60000)) * @bucket_minutes, @from) AS bucket_start
    FROM @scope AS sc
    INNER JOIN [workflow].run_facts AS f ON f.tenant_id = sc.tenant_id AND f.started_at >= @from AND f.started_at < @to
  ) AS b
  INNER JOIN @scope AS s ON s.tenant_id = b.tenant_id
  GROUP BY b.tenant_id, s.slug, b.bucket_start
  ORDER BY b.bucket_start, s.slug, b.tenant_id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].read_workflows
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint,
  @from datetime2(7), @to datetime2(7), @tenant_id uniqueidentifier = NULL
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC [governance].assert_group_admin @group_id, @user_id, @group_epoch, @admin_epoch;
  IF @from IS NULL OR @to IS NULL OR @to <= @from OR DATEDIFF_BIG(millisecond, @from, @to) > 2678400000
    BEGIN ;THROW 50002, N''INVALID'', 1; END;
  IF @tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [identity].tenant_group_members WHERE group_id = @group_id AND tenant_id = @tenant_id)
    BEGIN ;THROW 50001, N''DENIED'', 1; END;

  DECLARE @scope TABLE (tenant_id uniqueidentifier NOT NULL PRIMARY KEY, slug nvarchar(128) NOT NULL);
  DECLARE @top TABLE (tenant_id uniqueidentifier NOT NULL, stable_definition_id uniqueidentifier NOT NULL, runs int NOT NULL, completed int NOT NULL, p95_ms float NULL, cost decimal(38,6) NOT NULL, estimated_runs int NOT NULL, PRIMARY KEY (tenant_id, stable_definition_id));
  INSERT INTO @scope (tenant_id, slug)
  SELECT gm.tenant_id, t.slug
  FROM [identity].tenant_group_members AS gm
  INNER JOIN [identity].tenants AS t ON t.id = gm.tenant_id
  WHERE gm.group_id = @group_id AND (@tenant_id IS NULL OR gm.tenant_id = @tenant_id);

  INSERT INTO @top (tenant_id, stable_definition_id, runs, completed, p95_ms, cost, estimated_runs)
  SELECT TOP (100) x.tenant_id, x.stable_definition_id, COUNT(*), SUM(CASE WHEN x.status = N''completed'' THEN 1 ELSE 0 END), MAX(x.p95_ms), SUM(x.cost), SUM(CASE WHEN x.usage_estimated = 1 THEN 1 ELSE 0 END)
  FROM (
    SELECT d.tenant_id, d.stable_definition_id, d.status, d.cost, d.usage_estimated,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY d.duration_ms) OVER (PARTITION BY d.tenant_id, d.stable_definition_id) AS p95_ms
    FROM (
      SELECT f.tenant_id, f.stable_definition_id, f.status, f.cost, f.usage_estimated,
        CASE WHEN f.finished_at IS NOT NULL THEN DATEDIFF_BIG(millisecond, f.started_at, f.finished_at) END AS duration_ms
      FROM @scope AS sc
      INNER JOIN [workflow].run_facts AS f ON f.tenant_id = sc.tenant_id AND f.started_at >= @from AND f.started_at < @to
    ) AS d
  ) AS x
  GROUP BY x.tenant_id, x.stable_definition_id
  ORDER BY COUNT(*) DESC, x.tenant_id, x.stable_definition_id;

  SELECT t.tenant_id, s.slug, t.stable_definition_id,
    (SELECT TOP (1) JSON_VALUE(n.value, ''$.title'')
     FROM [studio].draft_heads AS h
     INNER JOIN [studio].draft_revisions AS r ON r.tenant_id = h.tenant_id AND r.draft_id = h.id AND r.revision = h.current_revision
     CROSS APPLY OPENJSON(r.draft_json, ''$.nodes'') AS n
     WHERE h.tenant_id = t.tenant_id AND h.id = t.stable_definition_id AND JSON_VALUE(n.value, ''$.kind'') = N''trigger'') AS name,
    t.runs, t.completed, t.p95_ms, t.cost, t.estimated_runs
  FROM @top AS t
  INNER JOIN @scope AS s ON s.tenant_id = t.tenant_id
  ORDER BY t.runs DESC, t.tenant_id, t.stable_definition_id;
END;
');

GRANT EXECUTE ON OBJECT::[governance].read_overview TO platform_governance_browser;
GRANT EXECUTE ON OBJECT::[governance].read_run_series TO platform_governance_browser;
GRANT EXECUTE ON OBJECT::[governance].read_workflows TO platform_governance_browser;

COMMIT TRANSACTION;
