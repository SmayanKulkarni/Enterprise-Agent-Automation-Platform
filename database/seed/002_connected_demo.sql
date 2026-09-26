/* Non-production connected-platform fixtures. Requires AZURE_SQL_ALLOW_DEMO_SEED=true. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

DECLARE @alpha uniqueidentifier = 'a1111111-1111-4111-8111-111111111111';
DECLARE @bravo uniqueidentifier = 'b2222222-2222-4222-8222-222222222222';
DECLARE @technical_package uniqueidentifier = 'c3333333-3333-4333-8333-333333333333';
DECLARE @vendor_package uniqueidentifier = 'd4444444-4444-4444-8444-444444444444';
DECLARE @technical_case uniqueidentifier = 'e5555555-5555-4555-8555-555555555555';
DECLARE @vendor_case uniqueidentifier = 'f6666666-6666-4666-8666-666666666666';

IF NOT EXISTS (SELECT 1 FROM [identity].tenants WHERE id = @alpha)
  INSERT INTO [identity].tenants (id, slug, status) VALUES (@alpha, N'connected-alpha', N'active');
IF NOT EXISTS (SELECT 1 FROM [identity].tenants WHERE id = @bravo)
  INSERT INTO [identity].tenants (id, slug, status) VALUES (@bravo, N'connected-bravo', N'active');

DECLARE @users TABLE (id uniqueidentifier NOT NULL, subject nvarchar(64) NOT NULL, profile nvarchar(32) NOT NULL);
INSERT INTO @users (id, subject, profile) VALUES
  ('10000000-0000-4000-8000-000000000001', N'connected-user-1', N'operator'),
  ('10000000-0000-4000-8000-000000000002', N'connected-user-2', N'engineer'),
  ('10000000-0000-4000-8000-000000000003', N'connected-user-3', N'reviewer'),
  ('10000000-0000-4000-8000-000000000004', N'connected-user-4', N'risk-owner'),
  ('10000000-0000-4000-8000-000000000005', N'connected-user-5', N'implementer'),
  ('10000000-0000-4000-8000-000000000006', N'connected-user-6', N'customer'),
  ('10000000-0000-4000-8000-000000000007', N'connected-user-7', N'admin'),
  ('10000000-0000-4000-8000-000000000008', N'connected-user-8', N'auditor');

INSERT INTO [identity].users (id, issuer, subject, display_name)
SELECT u.id, N'https://demo.example.invalid', u.subject, u.subject
FROM @users AS u
WHERE NOT EXISTS (SELECT 1 FROM [identity].users AS current_user WHERE current_user.issuer = N'https://demo.example.invalid' AND current_user.subject = u.subject);

DECLARE @tenant_id uniqueidentifier;
DECLARE tenant_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT id FROM (VALUES (@alpha), (@bravo)) AS tenants(id);
OPEN tenant_cursor;
FETCH NEXT FROM tenant_cursor INTO @tenant_id;
WHILE @@FETCH_STATUS = 0
BEGIN
  INSERT INTO [identity].memberships (id, tenant_id, user_id, status)
  SELECT NEWID(), @tenant_id, u.id, N'current'
  FROM @users AS u
  WHERE NOT EXISTS (SELECT 1 FROM [identity].memberships AS membership WHERE membership.tenant_id = @tenant_id AND membership.user_id = u.id);
  INSERT INTO [identity].profiles (tenant_id, id, version, state, data_json)
  SELECT @tenant_id, u.id, 1, N'current', (SELECT u.profile AS profile FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
  FROM @users AS u
  WHERE NOT EXISTS (SELECT 1 FROM [identity].profiles AS profile WHERE profile.tenant_id = @tenant_id AND profile.id = u.id);
  FETCH NEXT FROM tenant_cursor INTO @tenant_id;
END;
CLOSE tenant_cursor;
DEALLOCATE tenant_cursor;

IF NOT EXISTS (SELECT 1 FROM [lifecycle].packages WHERE tenant_id = @alpha AND id = @technical_package)
  INSERT INTO [lifecycle].packages (tenant_id, id, state, data_json) VALUES (@alpha, @technical_package, N'published', N'{"name":"Technical Implementation","version":"1.0.0","classification":"fixture"}');
IF NOT EXISTS (SELECT 1 FROM [lifecycle].packages WHERE tenant_id = @alpha AND id = @vendor_package)
  INSERT INTO [lifecycle].packages (tenant_id, id, state, data_json) VALUES (@alpha, @vendor_package, N'published', N'{"name":"Vendor Risk and Access","version":"1.0.0","classification":"fixture"}');
IF NOT EXISTS (SELECT 1 FROM [case].cases WHERE tenant_id = @alpha AND id = @technical_case)
  INSERT INTO [case].cases (tenant_id, id, state, data_json) VALUES (@alpha, @technical_case, N'awaiting-approval', N'{"kind":"technical-implementation","classification":"fixture"}');
IF NOT EXISTS (SELECT 1 FROM [case].cases WHERE tenant_id = @alpha AND id = @vendor_case)
  INSERT INTO [case].cases (tenant_id, id, state, data_json) VALUES (@alpha, @vendor_case, N'awaiting-approval', N'{"kind":"vendor-risk-access","classification":"fixture"}');

DECLARE @expires_at datetime2(7) = DATEADD(day, 1, SYSUTCDATETIME());
EXEC [projection].publish_snapshot @tenant_id = @alpha, @collection = N'packages',
  @records_json = N'[{"id":"c3333333-3333-4333-8333-333333333333","name":"Technical Implementation","classification":"fixture"},{"id":"d4444444-4444-4444-8444-444444444444","name":"Vendor Risk and Access","classification":"fixture"}]',
  @watermark = 1, @completeness = N'full', @classification = N'fixture', @redaction = N'none', @expires_at = @expires_at;
EXEC [projection].publish_snapshot @tenant_id = @alpha, @collection = N'cases',
  @records_json = N'[{"id":"e5555555-5555-4555-8555-555555555555","state":"awaiting-approval","classification":"fixture"},{"id":"f6666666-6666-4666-8666-666666666666","state":"awaiting-approval","classification":"fixture"}]',
  @watermark = 1, @completeness = N'partial', @classification = N'fixture', @redaction = N'none', @expires_at = @expires_at;

COMMIT TRANSACTION;
