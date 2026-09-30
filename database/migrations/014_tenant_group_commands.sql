SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

CREATE TABLE [governance].command_receipts (
  actor_user_id uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  idempotency_key uniqueidentifier NOT NULL,
  request_digest char(64) NOT NULL,
  receipt_json nvarchar(max) NOT NULL CHECK (ISJSON(receipt_json) = 1),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_governance_command_receipts PRIMARY KEY (actor_user_id, idempotency_key)
);

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].grant_tenant_admin
  @group_id uniqueidentifier, @tenant_id uniqueidentifier, @user_id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @membership_id uniqueidentifier, @status nvarchar(16), @created_membership bit = 0, @created_profile bit = 0;

  SELECT @membership_id = id, @status = status
  FROM [identity].memberships WITH (UPDLOCK, HOLDLOCK)
  WHERE tenant_id = @tenant_id AND user_id = @user_id;

  IF @membership_id IS NULL
  BEGIN
    SET @membership_id = NEWID();
    INSERT INTO [identity].memberships (id, tenant_id, user_id, status) VALUES (@membership_id, @tenant_id, @user_id, N''current'');
    SET @created_membership = 1;
  END
  ELSE IF @status <> N''current''
  BEGIN
    UPDATE [identity].memberships SET status = N''current'', epoch = epoch + 1 WHERE id = @membership_id;
    SET @created_membership = 1;
  END;

  IF NOT EXISTS (SELECT 1 FROM [identity].membership_profiles WHERE tenant_id = @tenant_id AND membership_id = @membership_id AND profile_key = N''admin'')
  BEGIN
    INSERT INTO [identity].membership_profiles (tenant_id, membership_id, profile_key) VALUES (@tenant_id, @membership_id, N''admin'');
    SET @created_profile = 1;
  END;

  IF NOT EXISTS (SELECT 1 FROM [identity].group_admin_grants WHERE group_id = @group_id AND tenant_id = @tenant_id AND membership_id = @membership_id)
    INSERT INTO [identity].group_admin_grants (group_id, tenant_id, membership_id, created_membership, created_profile)
    VALUES (@group_id, @tenant_id, @membership_id, @created_membership, @created_profile);
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].revoke_tenant_admin
  @group_id uniqueidentifier, @tenant_id uniqueidentifier, @user_id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @membership_id uniqueidentifier, @created_membership bit, @created_profile bit;

  SELECT @membership_id = g.membership_id, @created_membership = g.created_membership, @created_profile = g.created_profile
  FROM [identity].group_admin_grants AS g
  INNER JOIN [identity].memberships AS m ON m.id = g.membership_id AND m.tenant_id = @tenant_id AND m.user_id = @user_id
  WHERE g.group_id = @group_id AND g.tenant_id = @tenant_id;

  IF @membership_id IS NULL RETURN;

  IF @created_profile = 1
    DELETE FROM [identity].membership_profiles WHERE tenant_id = @tenant_id AND membership_id = @membership_id AND profile_key = N''admin'';

  IF @created_membership = 1 AND NOT EXISTS (SELECT 1 FROM [identity].membership_profiles WHERE tenant_id = @tenant_id AND membership_id = @membership_id)
    UPDATE [identity].memberships SET status = N''revoked'' WHERE id = @membership_id;

  UPDATE [identity].memberships SET epoch = epoch + 1 WHERE id = @membership_id;
  DELETE FROM [identity].group_admin_grants WHERE group_id = @group_id AND tenant_id = @tenant_id AND membership_id = @membership_id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].create_group
  @user_id uniqueidentifier, @name nvarchar(128), @tenant_ids nvarchar(max), @billing_tenant_id uniqueidentifier,
  @idempotency_key uniqueidentifier, @request_digest char(64), @receipt_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @tenants TABLE (tenant_id uniqueidentifier NOT NULL PRIMARY KEY);
  DECLARE @listed int, @prior_digest char(64), @prior_receipt nvarchar(max);

  SET @name = LTRIM(RTRIM(@name));
  IF ISNULL(LEN(@name), 0) NOT BETWEEN 1 AND 128
    OR ISNULL(ISJSON(@tenant_ids), 0) <> 1
    OR LEFT(LTRIM(@tenant_ids), 1) <> N''[''
    OR ISNULL(ISJSON(@receipt_json), 0) <> 1
    OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64)
    THROW 50002, N''INVALID'', 1;

  INSERT INTO @tenants (tenant_id)
  SELECT DISTINCT TRY_CAST([value] AS uniqueidentifier) FROM OPENJSON(@tenant_ids)
  WHERE [type] = 1 AND TRY_CAST([value] AS uniqueidentifier) IS NOT NULL;
  SELECT @listed = COUNT(*) FROM OPENJSON(@tenant_ids);

  IF @listed < 1 OR @listed > 50 OR @listed <> (SELECT COUNT(*) FROM @tenants)
    OR (@billing_tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM @tenants WHERE tenant_id = @billing_tenant_id))
    THROW 50002, N''INVALID'', 1;

  BEGIN TRANSACTION;

  SELECT @prior_digest = request_digest, @prior_receipt = receipt_json
  FROM [governance].command_receipts WITH (UPDLOCK, HOLDLOCK)
  WHERE actor_user_id = @user_id AND idempotency_key = @idempotency_key;

  IF @prior_receipt IS NOT NULL
  BEGIN
    IF @prior_digest <> @request_digest THROW 50004, N''CONFLICT'', 1;
    SELECT @prior_receipt AS receipt_json, CONVERT(bit, 1) AS replayed;
    COMMIT TRANSACTION;
    RETURN;
  END;

  IF NOT EXISTS (SELECT 1 FROM [identity].users WHERE id = @user_id)
    OR EXISTS (
      SELECT 1 FROM @tenants AS x
      WHERE NOT EXISTS (
        SELECT 1 FROM [identity].tenants AS t
        INNER JOIN [identity].memberships AS m ON m.tenant_id = t.id AND m.user_id = @user_id AND m.status = N''current''
        INNER JOIN [identity].membership_profiles AS p ON p.tenant_id = t.id AND p.membership_id = m.id AND p.profile_key = N''admin''
        WHERE t.id = x.tenant_id AND t.status = N''active''
      )
    ) THROW 50001, N''DENIED'', 1;

  IF EXISTS (SELECT 1 FROM [identity].tenant_group_members WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id IN (SELECT tenant_id FROM @tenants))
    THROW 50004, N''CONFLICT'', 1;

  INSERT INTO [identity].tenant_groups (id, name, status, billing_tenant_id, created_by)
  VALUES (@idempotency_key, @name, N''active'', @billing_tenant_id, @user_id);
  INSERT INTO [identity].tenant_group_members (group_id, tenant_id, joined_by)
  SELECT @idempotency_key, tenant_id, @user_id FROM @tenants;
  INSERT INTO [identity].tenant_group_admins (group_id, user_id, status, granted_by)
  VALUES (@idempotency_key, @user_id, N''current'', @user_id);
  INSERT INTO [identity].group_admin_grants (group_id, tenant_id, membership_id, created_membership, created_profile)
  SELECT @idempotency_key, x.tenant_id, m.id, 0, 0
  FROM @tenants AS x
  INNER JOIN [identity].memberships AS m ON m.tenant_id = x.tenant_id AND m.user_id = @user_id;

  INSERT INTO [governance].command_receipts (actor_user_id, idempotency_key, request_digest, receipt_json)
  VALUES (@user_id, @idempotency_key, @request_digest, @receipt_json);

  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed;
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].add_tenant
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint, @tenant_id uniqueidentifier,
  @idempotency_key uniqueidentifier, @request_digest char(64), @receipt_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max), @epoch bigint, @admin_id uniqueidentifier;
  DECLARE @admins TABLE (user_id uniqueidentifier NOT NULL PRIMARY KEY);

  IF ISNULL(ISJSON(@receipt_json), 0) <> 1 OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64)
    THROW 50002, N''INVALID'', 1;

  BEGIN TRANSACTION;

  SELECT @prior_digest = request_digest, @prior_receipt = receipt_json
  FROM [governance].command_receipts WITH (UPDLOCK, HOLDLOCK)
  WHERE actor_user_id = @user_id AND idempotency_key = @idempotency_key;

  IF @prior_receipt IS NOT NULL
  BEGIN
    IF @prior_digest <> @request_digest THROW 50004, N''CONFLICT'', 1;
    SELECT @prior_receipt AS receipt_json, CONVERT(bit, 1) AS replayed;
    COMMIT TRANSACTION;
    RETURN;
  END;

  SELECT @epoch = epoch FROM [identity].tenant_groups WITH (UPDLOCK, HOLDLOCK) WHERE id = @group_id;
  IF @epoch IS NULL THROW 50001, N''DENIED'', 1;
  IF @epoch <> @group_epoch THROW 50003, N''STALE'', 1;

  EXEC [governance].assert_group_admin @group_id, @user_id, @group_epoch, @admin_epoch;

  IF NOT EXISTS (
    SELECT 1 FROM [identity].tenants AS t
    INNER JOIN [identity].memberships AS m ON m.tenant_id = t.id AND m.user_id = @user_id AND m.status = N''current''
    INNER JOIN [identity].membership_profiles AS p ON p.tenant_id = t.id AND p.membership_id = m.id AND p.profile_key = N''admin''
    WHERE t.id = @tenant_id AND t.status = N''active''
  ) THROW 50001, N''DENIED'', 1;

  IF EXISTS (SELECT 1 FROM [identity].tenant_group_members WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @tenant_id)
    OR (SELECT COUNT(*) FROM [identity].tenant_group_members WHERE group_id = @group_id) >= 50
    THROW 50004, N''CONFLICT'', 1;

  INSERT INTO [identity].tenant_group_members (group_id, tenant_id, joined_by) VALUES (@group_id, @tenant_id, @user_id);

  INSERT INTO @admins (user_id) SELECT user_id FROM [identity].tenant_group_admins WHERE group_id = @group_id AND status = N''current'';
  WHILE EXISTS (SELECT 1 FROM @admins)
  BEGIN
    SELECT TOP (1) @admin_id = user_id FROM @admins;
    DELETE FROM @admins WHERE user_id = @admin_id;
    EXEC [governance].grant_tenant_admin @group_id, @tenant_id, @admin_id;
  END;

  UPDATE [identity].tenant_groups SET epoch = epoch + 1 WHERE id = @group_id;

  INSERT INTO [governance].command_receipts (actor_user_id, idempotency_key, request_digest, receipt_json)
  VALUES (@user_id, @idempotency_key, @request_digest, @receipt_json);

  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed;
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].remove_tenant
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint, @tenant_id uniqueidentifier,
  @idempotency_key uniqueidentifier, @request_digest char(64), @receipt_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max), @epoch bigint, @holder_id uniqueidentifier;
  DECLARE @holders TABLE (user_id uniqueidentifier NOT NULL PRIMARY KEY);

  IF ISNULL(ISJSON(@receipt_json), 0) <> 1 OR @request_digest NOT LIKE REPLICATE(N''[0-9a-f]'', 64)
    THROW 50002, N''INVALID'', 1;

  BEGIN TRANSACTION;

  SELECT @prior_digest = request_digest, @prior_receipt = receipt_json
  FROM [governance].command_receipts WITH (UPDLOCK, HOLDLOCK)
  WHERE actor_user_id = @user_id AND idempotency_key = @idempotency_key;

  IF @prior_receipt IS NOT NULL
  BEGIN
    IF @prior_digest <> @request_digest THROW 50004, N''CONFLICT'', 1;
    SELECT @prior_receipt AS receipt_json, CONVERT(bit, 1) AS replayed;
    COMMIT TRANSACTION;
    RETURN;
  END;

  SELECT @epoch = epoch FROM [identity].tenant_groups WITH (UPDLOCK, HOLDLOCK) WHERE id = @group_id;
  IF @epoch IS NULL THROW 50001, N''DENIED'', 1;
  IF @epoch <> @group_epoch THROW 50003, N''STALE'', 1;

  EXEC [governance].assert_group_admin @group_id, @user_id, @group_epoch, @admin_epoch;

  IF NOT EXISTS (SELECT 1 FROM [identity].tenant_group_members WITH (UPDLOCK, HOLDLOCK) WHERE group_id = @group_id AND tenant_id = @tenant_id)
    THROW 50002, N''INVALID'', 1;

  INSERT INTO @holders (user_id)
  SELECT m.user_id FROM [identity].group_admin_grants AS g
  INNER JOIN [identity].memberships AS m ON m.id = g.membership_id
  WHERE g.group_id = @group_id AND g.tenant_id = @tenant_id;
  WHILE EXISTS (SELECT 1 FROM @holders)
  BEGIN
    SELECT TOP (1) @holder_id = user_id FROM @holders;
    DELETE FROM @holders WHERE user_id = @holder_id;
    EXEC [governance].revoke_tenant_admin @group_id, @tenant_id, @holder_id;
  END;

  DELETE FROM [identity].group_admin_grants WHERE group_id = @group_id AND tenant_id = @tenant_id;
  DELETE FROM [identity].tenant_group_members WHERE group_id = @group_id AND tenant_id = @tenant_id;
  UPDATE [identity].tenant_groups SET billing_tenant_id = NULL WHERE id = @group_id AND billing_tenant_id = @tenant_id;
  UPDATE [identity].tenant_groups SET epoch = epoch + 1 WHERE id = @group_id;

  INSERT INTO [governance].command_receipts (actor_user_id, idempotency_key, request_digest, receipt_json)
  VALUES (@user_id, @idempotency_key, @request_digest, @receipt_json);

  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed;
  COMMIT TRANSACTION;
END;
');

GRANT EXECUTE ON OBJECT::[governance].create_group TO platform_governance_browser;
GRANT EXECUTE ON OBJECT::[governance].add_tenant TO platform_governance_browser;
GRANT EXECUTE ON OBJECT::[governance].remove_tenant TO platform_governance_browser;

COMMIT TRANSACTION;
