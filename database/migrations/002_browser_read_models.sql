/* Atomic, rebuildable browser snapshots. Owner services publish safe records only. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF SCHEMA_ID(N'projection') IS NULL EXEC(N'CREATE SCHEMA [projection] AUTHORIZATION dbo;');

CREATE TABLE [projection].snapshots (
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  collection nvarchar(40) NOT NULL,
  records_json nvarchar(max) NOT NULL CHECK (ISJSON(records_json) = 1 AND LEFT(LTRIM(records_json), 1) = N'['),
  watermark bigint NOT NULL CHECK (watermark >= 0),
  completeness nvarchar(16) NOT NULL CHECK (completeness IN (N'full', N'partial')),
  classification nvarchar(32) NOT NULL CHECK (classification IN (N'ordinary', N'restricted-operational', N'fixture')),
  redaction nvarchar(16) NOT NULL CHECK (redaction IN (N'none', N'applied')),
  published_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  expires_at datetime2(7) NOT NULL,
  CONSTRAINT PK_projection_snapshots PRIMARY KEY (tenant_id, collection)
);

EXEC(N'
CREATE OR ALTER PROCEDURE [projection].read_snapshot
  @tenant_id uniqueidentifier,
  @user_id uniqueidentifier,
  @tenant_epoch bigint,
  @membership_epoch bigint,
  @collection nvarchar(40)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT s.records_json, s.watermark, s.completeness, s.classification,
    s.redaction, s.published_at, s.expires_at
  FROM [identity].tenants AS t
  INNER JOIN [identity].memberships AS m ON m.tenant_id = t.id
  LEFT JOIN [projection].snapshots AS s ON s.tenant_id = t.id AND s.collection = @collection
  WHERE t.id = @tenant_id AND t.status = N''active'' AND t.epoch = @tenant_epoch
    AND m.user_id = @user_id AND m.status = N''current'' AND m.epoch = @membership_epoch;
  IF @@ROWCOUNT = 0 THROW 50001, N''DENIED'', 1;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [projection].publish_snapshot
  @tenant_id uniqueidentifier,
  @collection nvarchar(40),
  @records_json nvarchar(max),
  @watermark bigint,
  @completeness nvarchar(16),
  @classification nvarchar(32),
  @redaction nvarchar(16),
  @expires_at datetime2(7)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  IF @tenant_id IS NULL OR @collection IS NULL OR @records_json IS NULL
    OR @watermark IS NULL OR @completeness IS NULL OR @classification IS NULL OR @redaction IS NULL OR @expires_at IS NULL
    OR @watermark < 0 OR @expires_at <= SYSUTCDATETIME()
    OR @completeness NOT IN (N''full'', N''partial'')
    OR @classification NOT IN (N''ordinary'', N''restricted-operational'', N''fixture'')
    OR @redaction NOT IN (N''none'', N''applied'')
    OR ISJSON(@records_json) <> 1 OR LEFT(LTRIM(@records_json), 1) <> N''[''
    -- ponytail: one bounded collection snapshot; use paged rows if collections outgrow 200 KB.
    OR DATALENGTH(@records_json) > 400000
    OR @collection NOT IN (N''cases'', N''interventions'', N''capabilities'', N''installations'', N''memory'', N''evaluations'', N''improvements'', N''packages'', N''operations'', N''deployments'', N''readiness'', N''vendor-assessments'', N''access-grants'')
    THROW 50002, N''INVALID_SNAPSHOT'', 1;
  IF EXISTS (
    SELECT 1 FROM OPENJSON(@records_json)
    WHERE [type] <> 5 OR TRY_CONVERT(uniqueidentifier, JSON_VALUE([value], N''$.id'')) IS NULL
  ) THROW 50002, N''INVALID_SNAPSHOT'', 1;
  IF EXISTS (
    SELECT JSON_VALUE([value], N''$.id'') FROM OPENJSON(@records_json)
    GROUP BY JSON_VALUE([value], N''$.id'') HAVING COUNT(*) > 1
  ) THROW 50002, N''INVALID_SNAPSHOT'', 1;

  BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM [projection].snapshots WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id AND collection = @collection)
  BEGIN
    IF EXISTS (SELECT 1 FROM [projection].snapshots WHERE tenant_id = @tenant_id AND collection = @collection AND watermark >= @watermark)
      THROW 50003, N''STALE_SNAPSHOT'', 1;
    UPDATE [projection].snapshots
    SET records_json = @records_json, watermark = @watermark, completeness = @completeness,
      classification = @classification, redaction = @redaction,
      published_at = SYSUTCDATETIME(), expires_at = @expires_at
    WHERE tenant_id = @tenant_id AND collection = @collection;
  END
  ELSE
    INSERT INTO [projection].snapshots (tenant_id, collection, records_json, watermark, completeness, classification, redaction, expires_at)
    VALUES (@tenant_id, @collection, @records_json, @watermark, @completeness, @classification, @redaction, @expires_at);
  COMMIT TRANSACTION;
END;
');

CREATE ROLE platform_projection_writer AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::[projection].read_snapshot TO platform_identity_runtime;
GRANT EXECUTE ON OBJECT::[projection].publish_snapshot TO platform_projection_writer;

COMMIT TRANSACTION;
