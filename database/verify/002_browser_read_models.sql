SET NOCOUNT ON;

IF OBJECT_ID(N'projection.snapshots', N'U') IS NULL
  OR OBJECT_ID(N'projection.read_snapshot', N'P') IS NULL
  OR OBJECT_ID(N'projection.publish_snapshot', N'P') IS NULL
  OR DATABASE_PRINCIPAL_ID(N'platform_projection_writer') IS NULL
  THROW 50000, N'Browser read-model migration is incomplete.', 1;

SELECT N'002_browser_read_models' AS migration, N'passed' AS status;
