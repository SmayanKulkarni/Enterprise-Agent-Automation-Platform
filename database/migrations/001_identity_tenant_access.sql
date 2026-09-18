/* First Azure SQL persistence slice: the minimum identity data needed by the app. */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF SCHEMA_ID(N'identity') IS NULL EXEC(N'CREATE SCHEMA [identity] AUTHORIZATION dbo;');

CREATE TABLE [identity].tenants (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  slug nvarchar(128) NOT NULL UNIQUE,
  status nvarchar(16) NOT NULL CHECK (status IN (N'active', N'suspended')),
  epoch bigint NOT NULL DEFAULT (1) CHECK (epoch > 0),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME())
);

CREATE TABLE [identity].users (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  issuer nvarchar(512) NOT NULL,
  subject nvarchar(256) NOT NULL,
  display_name nvarchar(256) NULL,
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT UQ_identity_users_issuer_subject UNIQUE (issuer, subject)
);

CREATE TABLE [identity].memberships (
  id uniqueidentifier NOT NULL PRIMARY KEY,
  tenant_id uniqueidentifier NOT NULL REFERENCES [identity].tenants (id),
  user_id uniqueidentifier NOT NULL REFERENCES [identity].users (id),
  status nvarchar(16) NOT NULL CHECK (status IN (N'current', N'revoked')),
  epoch bigint NOT NULL DEFAULT (1) CHECK (epoch > 0),
  created_at datetime2(7) NOT NULL DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT UQ_identity_memberships_tenant_user UNIQUE (tenant_id, user_id)
);

CREATE INDEX IX_identity_memberships_user_status ON [identity].memberships (user_id, status) INCLUDE (tenant_id, epoch);

EXEC(N'
CREATE OR ALTER PROCEDURE [identity].read_current_session
  @tenant_id uniqueidentifier,
  @issuer nvarchar(512),
  @subject nvarchar(256)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT u.id AS user_id, t.epoch AS tenant_epoch, m.epoch AS membership_epoch
  FROM [identity].users AS u
  INNER JOIN [identity].memberships AS m ON m.user_id = u.id AND m.tenant_id = @tenant_id AND m.status = N''current''
  INNER JOIN [identity].tenants AS t ON t.id = m.tenant_id AND t.status = N''active''
  WHERE u.issuer = @issuer AND u.subject = @subject;
END;
');

EXEC(N'
CREATE OR ALTER PROCEDURE [identity].list_current_tenants
  @issuer nvarchar(512),
  @subject nvarchar(256)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT t.id AS tenant_id, t.epoch AS tenant_epoch, m.epoch AS membership_epoch
  FROM [identity].users AS u
  INNER JOIN [identity].memberships AS m ON m.user_id = u.id AND m.status = N''current''
  INNER JOIN [identity].tenants AS t ON t.id = m.tenant_id AND t.status = N''active''
  WHERE u.issuer = @issuer AND u.subject = @subject
  ORDER BY t.id;
END;
');

CREATE ROLE platform_identity_runtime AUTHORIZATION dbo;
GRANT EXECUTE ON OBJECT::[identity].read_current_session TO platform_identity_runtime;
GRANT EXECUTE ON OBJECT::[identity].list_current_tenants TO platform_identity_runtime;

COMMIT TRANSACTION;
