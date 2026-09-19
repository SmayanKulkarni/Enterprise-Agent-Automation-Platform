SET NOCOUNT ON;

IF SCHEMA_ID(N'studio') IS NULL
  OR OBJECT_ID(N'studio.draft_heads', N'U') IS NULL
  OR OBJECT_ID(N'studio.draft_revisions', N'U') IS NULL
  OR OBJECT_ID(N'studio.run_evidence', N'U') IS NULL
  OR OBJECT_ID(N'studio.review_evidence', N'U') IS NULL
  OR OBJECT_ID(N'studio.command_receipts', N'U') IS NULL
  OR OBJECT_ID(N'studio.save_draft', N'P') IS NULL
  OR OBJECT_ID(N'studio.remember_command', N'P') IS NULL
  OR DATABASE_PRINCIPAL_ID(N'platform_studio_runtime') IS NULL
  THROW 50000, N'Solution Studio migration is incomplete.', 1;

SELECT N'003_solution_studio' AS migration, N'passed' AS status;
