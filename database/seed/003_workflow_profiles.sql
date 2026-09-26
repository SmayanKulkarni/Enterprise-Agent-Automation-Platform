SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

INSERT INTO [identity].membership_profiles (tenant_id, membership_id, profile_key)
SELECT m.tenant_id, m.id,
  CASE
    WHEN u.subject = N'connected-user-7' THEN N'admin'
    WHEN u.subject = N'connected-user-2' THEN N'editor'
    ELSE N'operator'
  END
FROM [identity].memberships AS m
INNER JOIN [identity].users AS u ON u.id = m.user_id
WHERE u.issuer = N'https://demo.example.invalid'
  AND NOT EXISTS (SELECT 1 FROM [identity].membership_profiles AS p WHERE p.tenant_id = m.tenant_id AND p.membership_id = m.id);

COMMIT TRANSACTION;
