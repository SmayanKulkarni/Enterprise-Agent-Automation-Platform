SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].add_admin
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint, @candidate_user_id uniqueidentifier,
  @idempotency_key uniqueidentifier, @request_digest char(64), @receipt_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max), @epoch bigint, @candidate_status nvarchar(16), @member_id uniqueidentifier;
  DECLARE @members TABLE (tenant_id uniqueidentifier NOT NULL PRIMARY KEY);

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
    SELECT 1 FROM [identity].memberships AS m
    INNER JOIN [identity].tenant_group_members AS gm ON gm.tenant_id = m.tenant_id AND gm.group_id = @group_id
    WHERE m.user_id = @candidate_user_id AND m.status = N''current''
  ) THROW 50002, N''INVALID'', 1;

  SELECT @candidate_status = status FROM [identity].tenant_group_admins WITH (UPDLOCK, HOLDLOCK) WHERE group_id = @group_id AND user_id = @candidate_user_id;
  IF @candidate_status = N''current''
    OR (SELECT COUNT(*) FROM [identity].tenant_group_admins WHERE group_id = @group_id AND status = N''current'') >= 20
    THROW 50004, N''CONFLICT'', 1;

  IF @candidate_status IS NULL
    INSERT INTO [identity].tenant_group_admins (group_id, user_id, status, granted_by) VALUES (@group_id, @candidate_user_id, N''current'', @user_id);
  ELSE
    UPDATE [identity].tenant_group_admins SET status = N''current'', epoch = epoch + 1, granted_by = @user_id WHERE group_id = @group_id AND user_id = @candidate_user_id;

  INSERT INTO @members (tenant_id) SELECT tenant_id FROM [identity].tenant_group_members WHERE group_id = @group_id;
  WHILE EXISTS (SELECT 1 FROM @members)
  BEGIN
    SELECT TOP (1) @member_id = tenant_id FROM @members;
    DELETE FROM @members WHERE tenant_id = @member_id;
    EXEC [governance].grant_tenant_admin @group_id, @member_id, @candidate_user_id;
  END;

  UPDATE [identity].tenant_groups SET epoch = epoch + 1 WHERE id = @group_id;

  INSERT INTO [governance].command_receipts (actor_user_id, idempotency_key, request_digest, receipt_json)
  VALUES (@user_id, @idempotency_key, @request_digest, @receipt_json);

  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed;
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].remove_admin
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint, @target_user_id uniqueidentifier,
  @idempotency_key uniqueidentifier, @request_digest char(64), @receipt_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max), @epoch bigint, @member_id uniqueidentifier;
  DECLARE @members TABLE (tenant_id uniqueidentifier NOT NULL PRIMARY KEY);

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

  IF NOT EXISTS (SELECT 1 FROM [identity].tenant_group_admins WITH (UPDLOCK, HOLDLOCK) WHERE group_id = @group_id AND user_id = @target_user_id AND status = N''current'')
    THROW 50002, N''INVALID'', 1;
  IF (SELECT COUNT(*) FROM [identity].tenant_group_admins WHERE group_id = @group_id AND status = N''current'') <= 1
    THROW 50004, N''CONFLICT'', 1;

  UPDATE [identity].tenant_group_admins SET status = N''revoked'', epoch = epoch + 1 WHERE group_id = @group_id AND user_id = @target_user_id;

  INSERT INTO @members (tenant_id)
  SELECT DISTINCT g.tenant_id FROM [identity].group_admin_grants AS g
  INNER JOIN [identity].memberships AS m ON m.id = g.membership_id
  WHERE g.group_id = @group_id AND m.user_id = @target_user_id;
  WHILE EXISTS (SELECT 1 FROM @members)
  BEGIN
    SELECT TOP (1) @member_id = tenant_id FROM @members;
    DELETE FROM @members WHERE tenant_id = @member_id;
    EXEC [governance].revoke_tenant_admin @group_id, @member_id, @target_user_id;
  END;

  UPDATE [identity].tenant_groups SET epoch = epoch + 1 WHERE id = @group_id;

  INSERT INTO [governance].command_receipts (actor_user_id, idempotency_key, request_digest, receipt_json)
  VALUES (@user_id, @idempotency_key, @request_digest, @receipt_json);

  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed;
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].set_billing_tenant
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint, @tenant_id uniqueidentifier,
  @idempotency_key uniqueidentifier, @request_digest char(64), @receipt_json nvarchar(max)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @prior_digest char(64), @prior_receipt nvarchar(max), @epoch bigint;

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

  UPDATE [identity].tenant_groups SET billing_tenant_id = @tenant_id, epoch = epoch + 1 WHERE id = @group_id;

  INSERT INTO [governance].command_receipts (actor_user_id, idempotency_key, request_digest, receipt_json)
  VALUES (@user_id, @idempotency_key, @request_digest, @receipt_json);

  SELECT @receipt_json AS receipt_json, CONVERT(bit, 0) AS replayed;
  COMMIT TRANSACTION;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].read_members
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC [governance].assert_group_admin @group_id, @user_id, @group_epoch, @admin_epoch;

  SELECT gm.tenant_id, t.slug, gm.joined_at, CONVERT(bit, CASE WHEN g.billing_tenant_id = gm.tenant_id THEN 1 ELSE 0 END) AS is_billing
  FROM [identity].tenant_group_members AS gm
  INNER JOIN [identity].tenant_groups AS g ON g.id = gm.group_id
  INNER JOIN [identity].tenants AS t ON t.id = gm.tenant_id
  WHERE gm.group_id = @group_id
  ORDER BY t.slug;

  SELECT a.user_id, u.display_name, a.created_at
  FROM [identity].tenant_group_admins AS a
  INNER JOIN [identity].users AS u ON u.id = a.user_id
  WHERE a.group_id = @group_id AND a.status = N''current''
  ORDER BY u.display_name, a.user_id;

  SELECT TOP (200) u.id AS user_id, u.display_name
  FROM [identity].users AS u
  WHERE EXISTS (
      SELECT 1 FROM [identity].memberships AS m
      INNER JOIN [identity].tenant_group_members AS gm ON gm.tenant_id = m.tenant_id AND gm.group_id = @group_id
      WHERE m.user_id = u.id AND m.status = N''current''
    )
    AND NOT EXISTS (SELECT 1 FROM [identity].tenant_group_admins AS a WHERE a.group_id = @group_id AND a.user_id = u.id AND a.status = N''current'')
  ORDER BY u.display_name, u.id;
END;
');

GRANT EXECUTE ON OBJECT::[governance].add_admin TO platform_governance_browser;
GRANT EXECUTE ON OBJECT::[governance].remove_admin TO platform_governance_browser;
GRANT EXECUTE ON OBJECT::[governance].set_billing_tenant TO platform_governance_browser;
GRANT EXECUTE ON OBJECT::[governance].read_members TO platform_governance_browser;

COMMIT TRANSACTION;
