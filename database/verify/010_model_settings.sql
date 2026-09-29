IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'workflow.records') AND definition LIKE N'%model-settings%') THROW 50000, N'Model settings record kind is missing.', 1;
IF OBJECT_DEFINITION(OBJECT_ID(N'workflow.write_record')) NOT LIKE N'%model-settings%' THROW 50000, N'write_record does not accept model settings.', 1;
SELECT N'010_model_settings' AS migration, N'passed' AS status;
