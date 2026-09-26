SET NOCOUNT ON;

IF OBJECT_ID(N'identity.membership_profiles', N'U') IS NULL
  OR OBJECT_ID(N'workflow.definitions', N'U') IS NULL
  OR OBJECT_ID(N'workflow.records', N'U') IS NULL
  OR OBJECT_ID(N'workflow.command_receipts', N'U') IS NULL
  THROW 50000, N'Workflow tables are incomplete.', 1;

IF OBJECT_ID(N'workflow.check_profile', N'P') IS NULL
  OR OBJECT_ID(N'workflow.create_graph_draft', N'P') IS NULL
  OR OBJECT_ID(N'workflow.save_graph_draft', N'P') IS NULL
  OR OBJECT_ID(N'workflow.read_record', N'P') IS NULL
  OR OBJECT_ID(N'workflow.write_record', N'P') IS NULL
  OR OBJECT_ID(N'workflow.publish_definition', N'P') IS NULL
  OR OBJECT_ID(N'workflow.worker_write_record', N'P') IS NULL
  OR DATABASE_PRINCIPAL_ID(N'platform_workflow_browser') IS NULL
  OR DATABASE_PRINCIPAL_ID(N'platform_workflow_worker') IS NULL
  THROW 50000, N'Workflow procedures or roles are incomplete.', 1;

IF EXISTS (
  SELECT 1 FROM sys.database_permissions AS permission
  INNER JOIN sys.database_principals AS grantee ON grantee.principal_id = permission.grantee_principal_id
  WHERE grantee.name IN (N'platform_workflow_browser', N'platform_workflow_worker')
    AND permission.permission_name IN (N'INSERT', N'UPDATE', N'DELETE')
)
  THROW 50000, N'Workflow roles must not write tables directly.', 1;

SELECT N'005_diagram_workflow_v1' AS migration, N'passed' AS status;
