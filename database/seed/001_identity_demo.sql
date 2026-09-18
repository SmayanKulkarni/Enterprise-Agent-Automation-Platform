/* Non-production demo data. Requires AZURE_SQL_ALLOW_DEMO_SEED=true. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

DECLARE @tenant_id uniqueidentifier = '11111111-1111-4111-8111-111111111111';
DECLARE @user_id uniqueidentifier = '22222222-2222-4222-8222-222222222222';
DECLARE @membership_id uniqueidentifier = '44444444-4444-4444-8444-444444444444';

IF NOT EXISTS (SELECT 1 FROM [identity].tenants WHERE id = @tenant_id)
  INSERT INTO [identity].tenants (id, slug, status) VALUES (@tenant_id, N'demo-platform', N'active');

IF NOT EXISTS (SELECT 1 FROM [identity].users WHERE issuer = N'https://demo.example.invalid' AND subject = N'demo-operator')
  INSERT INTO [identity].users (id, issuer, subject, display_name) VALUES (@user_id, N'https://demo.example.invalid', N'demo-operator', N'Demo Operator');

IF NOT EXISTS (SELECT 1 FROM [identity].memberships WHERE tenant_id = @tenant_id AND user_id = @user_id)
  INSERT INTO [identity].memberships (id, tenant_id, user_id, status) VALUES (@membership_id, @tenant_id, @user_id, N'current');

COMMIT TRANSACTION;
