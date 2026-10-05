/* Per-run label in the pending approvals read, so the inbox can tell runs of one workflow apart. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
BEGIN TRANSACTION;

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].read_pending_approvals
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC [governance].assert_group_admin @group_id, @user_id, @group_epoch, @admin_epoch;

  SELECT TOP (200) f.tenant_id, t.slug, f.run_id, r.version AS run_version,
    JSON_VALUE(r.data_json, ''$.definitionRevision'') AS definition_revision,
    (SELECT TOP (1) JSON_VALUE(n.value, ''$.title'')
     FROM [studio].draft_heads AS h
     INNER JOIN [studio].draft_revisions AS d ON d.tenant_id = h.tenant_id AND d.draft_id = h.id AND d.revision = h.current_revision
     CROSS APPLY OPENJSON(d.draft_json, ''$.nodes'') AS n
     WHERE h.tenant_id = f.tenant_id AND h.id = f.stable_definition_id AND JSON_VALUE(n.value, ''$.kind'') = N''trigger'') AS workflow_name,
    LEFT(JSON_VALUE(r.data_json, ''$.label''), 120) AS run_label,
    JSON_QUERY(r.data_json, ''$.waiting'') AS waiting_json,
    (SELECT TOP (1) JSON_VALUE(h.value, ''$.kind'')
     FROM OPENJSON(r.data_json, ''$.history'') AS h
     WHERE JSON_VALUE(h.value, ''$.state'') = N''waiting''
     ORDER BY CONVERT(int, h.[key]) DESC) AS waiting_kind
  FROM [workflow].run_facts AS f
  INNER JOIN [identity].tenant_group_members AS gm ON gm.tenant_id = f.tenant_id AND gm.group_id = @group_id
  INNER JOIN [identity].tenants AS t ON t.id = f.tenant_id
  INNER JOIN [workflow].records AS r ON r.tenant_id = f.tenant_id AND r.kind = N''run'' AND r.id = f.run_id
  WHERE f.status = N''waiting-approval'' AND f.waiting_expires_at > SYSUTCDATETIME() AND r.state = N''waiting-approval''
  ORDER BY f.waiting_expires_at ASC, f.tenant_id, f.run_id;
END;
');

COMMIT TRANSACTION;
