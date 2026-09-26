IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'workflow.records') AND definition LIKE N'%openrouter-connection%') THROW 50000, N'OpenRouter connection record kind is missing.', 1;
SELECT N'008_openrouter_tenant_connection' AS migration, N'passed' AS status;
