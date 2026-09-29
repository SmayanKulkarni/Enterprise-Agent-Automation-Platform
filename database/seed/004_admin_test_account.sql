/* Non-production admin test account. Requires AZURE_SQL_ALLOW_DEMO_SEED=true and ADMIN_TEST_CLERK_SUBJECT. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

DECLARE @issuer nvarchar(512) = N'$(ADMIN_ISSUER)';
DECLARE @subject nvarchar(256) = N'$(ADMIN_SUBJECT)';
DECLARE @user_id uniqueidentifier;

SELECT @user_id = id FROM [identity].users WHERE issuer = @issuer AND subject = @subject;
IF @user_id IS NULL
BEGIN
  SET @user_id = NEWID();
  INSERT INTO [identity].users (id, issuer, subject, display_name) VALUES (@user_id, @issuer, @subject, N'Admin Test Account');
END;

DECLARE @tenants TABLE (tenant_id uniqueidentifier NOT NULL PRIMARY KEY);
INSERT INTO @tenants (tenant_id)
SELECT DISTINCT t.id
FROM STRING_SPLIT(N'$(ADMIN_TENANTS)', N',') AS s
INNER JOIN [identity].tenants AS t ON t.id = TRY_CAST(s.value AS uniqueidentifier);

INSERT INTO [identity].memberships (id, tenant_id, user_id, status)
SELECT NEWID(), x.tenant_id, @user_id, N'current'
FROM @tenants AS x
WHERE NOT EXISTS (SELECT 1 FROM [identity].memberships AS m WHERE m.tenant_id = x.tenant_id AND m.user_id = @user_id);

UPDATE m SET status = N'current', epoch = m.epoch + 1
FROM [identity].memberships AS m
INNER JOIN @tenants AS x ON x.tenant_id = m.tenant_id
WHERE m.user_id = @user_id AND m.status <> N'current';

INSERT INTO [identity].membership_profiles (tenant_id, membership_id, profile_key)
SELECT m.tenant_id, m.id, N'admin'
FROM [identity].memberships AS m
INNER JOIN @tenants AS x ON x.tenant_id = m.tenant_id
WHERE m.user_id = @user_id
  AND NOT EXISTS (SELECT 1 FROM [identity].membership_profiles AS p WHERE p.tenant_id = m.tenant_id AND p.membership_id = m.id AND p.profile_key = N'admin');

COMMIT TRANSACTION;
