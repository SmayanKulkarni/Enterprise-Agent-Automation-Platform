SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'governance') IS NULL EXEC(N'CREATE SCHEMA [governance] AUTHORIZATION dbo;');

CREATE TABLE [identity].tenant_groups (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  name nvarchar(128) NOT NULL,
  status nvarchar(16) NOT NULL CHECK (status IN (N'active', N'suspended')),
  epoch bigint NOT NULL DEFAULT (1) CHECK (epoch > 0),
  billing_tenant_id uniqueidentifier NULL REFERENCES [identity].tenants (id),
  created_by uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME())
);

CREATE TABLE [identity].tenant_group_members (
  group_id uniqueidentifier NOT NULL REFERENCES [identity].tenant_groups (id),
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  joined_by uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  joined_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_identity_tenant_group_members PRIMARY KEY (group_id, tenant_id),
  CONSTRAINT UQ_identity_tenant_group_members_tenant UNIQUE (tenant_id)
);

CREATE TABLE [identity].tenant_group_admins (
  group_id uniqueidentifier NOT NULL REFERENCES [identity].tenant_groups (id),
  user_id uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  status nvarchar(16) NOT NULL CHECK (status IN (N'current', N'revoked')),
  epoch bigint NOT NULL DEFAULT (1) CHECK (epoch > 0),
  granted_by uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_identity_tenant_group_admins PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IX_identity_tenant_group_admins_user ON [identity].tenant_group_admins (user_id, status) INCLUDE (group_id, epoch);

CREATE TABLE [identity].group_admin_grants (
  group_id uniqueidentifier NOT NULL,
  tenant_id uniqueidentifier NOT NULL,
  membership_id uniqueidentifier NOT NULL REFERENCES [identity].memberships (id),
  created_membership bit NOT NULL,
  created_profile bit NOT NULL,
  CONSTRAINT PK_identity_group_admin_grants PRIMARY KEY (group_id, tenant_id, membership_id),
  CONSTRAINT FK_identity_group_admin_grants_member FOREIGN KEY (group_id, tenant_id) REFERENCES [identity].tenant_group_members (group_id, tenant_id)
);

EXEC(N'
CREATE OR ALTER PROCEDURE [identity].list_current_groups
  @issuer nvarchar(512),
  @subject nvarchar(256)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT g.id AS group_id, g.name, g.epoch AS group_epoch, a.epoch AS admin_epoch, g.billing_tenant_id, m.tenant_id
  FROM [identity].users AS u
  INNER JOIN [identity].tenant_group_admins AS a ON a.user_id = u.id AND a.status = N''current''
  INNER JOIN [identity].tenant_groups AS g ON g.id = a.group_id AND g.status = N''active''
  LEFT JOIN [identity].tenant_group_members AS m ON m.group_id = g.id
  WHERE u.issuer = @issuer AND u.subject = @subject
  ORDER BY g.id, m.tenant_id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [identity].read_group_session
  @group_id uniqueidentifier,
  @issuer nvarchar(512),
  @subject nvarchar(256)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint;
  SELECT @user_id = u.id, @group_epoch = g.epoch, @admin_epoch = a.epoch
  FROM [identity].users AS u
  INNER JOIN [identity].tenant_group_admins AS a ON a.user_id = u.id AND a.group_id = @group_id AND a.status = N''current''
  INNER JOIN [identity].tenant_groups AS g ON g.id = a.group_id AND g.status = N''active''
  WHERE u.issuer = @issuer AND u.subject = @subject;
  SELECT @user_id AS user_id, @group_epoch AS group_epoch, @admin_epoch AS admin_epoch WHERE @user_id IS NOT NULL;
  SELECT tenant_id FROM [identity].tenant_group_members WHERE group_id = @group_id AND @user_id IS NOT NULL ORDER BY tenant_id;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [governance].assert_group_admin
  @group_id uniqueidentifier, @user_id uniqueidentifier, @group_epoch bigint, @admin_epoch bigint
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (
    SELECT 1 FROM [identity].tenant_groups AS g
    INNER JOIN [identity].tenant_group_admins AS a ON a.group_id = g.id
    WHERE g.id = @group_id AND g.status = N''active'' AND g.epoch = @group_epoch
      AND a.user_id = @user_id AND a.status = N''current'' AND a.epoch = @admin_epoch
  ) BEGIN ;THROW 50001, N''DENIED'', 1; END;
END;
');

GRANT EXECUTE ON OBJECT::[identity].list_current_groups TO platform_identity_runtime;
GRANT EXECUTE ON OBJECT::[identity].read_group_session TO platform_identity_runtime;

CREATE ROLE platform_governance_browser AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::[governance].assert_group_admin TO platform_governance_browser;

COMMIT TRANSACTION;
