/* Lists the saved revisions of one Studio draft for any current member of the tenant. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

EXEC(N'
CREATE OR ALTER PROCEDURE [studio].list_revisions
  @tenant_id uniqueidentifier, @user_id uniqueidentifier, @tenant_epoch bigint, @membership_epoch bigint,
  @draft_id uniqueidentifier
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC [studio].assert_context @tenant_id, @user_id, @tenant_epoch, @membership_epoch;
  SELECT TOP (200) r.draft_id AS id, r.tenant_id, r.revision, r.state, r.digest, r.author_id, r.draft_json, r.created_at
  FROM [studio].draft_revisions AS r
  WHERE r.tenant_id = @tenant_id AND r.draft_id = @draft_id
  ORDER BY r.revision DESC;
END;
');

GRANT EXECUTE ON OBJECT::[studio].list_revisions TO platform_studio_runtime;

COMMIT TRANSACTION;
