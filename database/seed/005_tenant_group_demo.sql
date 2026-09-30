/* Non-production tenant group for the admin test account. Requires AZURE_SQL_ALLOW_DEMO_SEED=true and ADMIN_TEST_CLERK_SUBJECT. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

DECLARE @issuer nvarchar(512) = N'$(ADMIN_ISSUER)';
DECLARE @subject nvarchar(256) = N'$(ADMIN_SUBJECT)';
DECLARE @group_id uniqueidentifier = 'a0000000-0000-4000-8000-000000000001';
DECLARE @user_id uniqueidentifier;

SELECT @user_id = id FROM [identity].users WHERE issuer = @issuer AND subject = @subject;

IF @user_id IS NOT NULL
BEGIN
  DECLARE @tenants TABLE (tenant_id uniqueidentifier NOT NULL PRIMARY KEY);
  INSERT INTO @tenants (tenant_id)
  SELECT DISTINCT t.id
  FROM STRING_SPLIT(N'$(ADMIN_TENANTS)', N',') AS s
  INNER JOIN [identity].tenants AS t ON t.id = TRY_CAST(s.value AS uniqueidentifier)
  WHERE NOT EXISTS (SELECT 1 FROM [identity].tenant_group_members AS g WHERE g.tenant_id = t.id AND g.group_id <> @group_id);

  IF EXISTS (SELECT 1 FROM @tenants)
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM [identity].tenant_groups WHERE id = @group_id)
      INSERT INTO [identity].tenant_groups (id, name, status, created_by) VALUES (@group_id, N'Local group', N'active', @user_id);

    INSERT INTO [identity].tenant_group_members (group_id, tenant_id, joined_by)
    SELECT @group_id, x.tenant_id, @user_id FROM @tenants AS x
    WHERE NOT EXISTS (SELECT 1 FROM [identity].tenant_group_members AS g WHERE g.group_id = @group_id AND g.tenant_id = x.tenant_id);

    IF NOT EXISTS (SELECT 1 FROM [identity].tenant_group_admins WHERE group_id = @group_id AND user_id = @user_id)
      INSERT INTO [identity].tenant_group_admins (group_id, user_id, status, granted_by) VALUES (@group_id, @user_id, N'current', @user_id);

    INSERT INTO [identity].group_admin_grants (group_id, tenant_id, membership_id, created_membership, created_profile)
    SELECT @group_id, m.tenant_id, m.id, 0, 0
    FROM [identity].memberships AS m
    INNER JOIN @tenants AS x ON x.tenant_id = m.tenant_id
    WHERE m.user_id = @user_id
      AND NOT EXISTS (SELECT 1 FROM [identity].group_admin_grants AS g WHERE g.group_id = @group_id AND g.tenant_id = m.tenant_id AND g.membership_id = m.id);
  END;
END;

COMMIT TRANSACTION;
