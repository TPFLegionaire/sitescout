CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT 'SiteScout',
  brand_label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug
ON organizations(slug);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_organization_slug
ON sites(organization_id, slug);

CREATE INDEX IF NOT EXISTS idx_sites_organization_active
ON sites(organization_id, active);

CREATE TABLE IF NOT EXISTS quality_user_roles (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  site_id TEXT NOT NULL DEFAULT '*',
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_user_roles_scope
ON quality_user_roles(email, organization_id, site_id, role);

CREATE INDEX IF NOT EXISTS idx_quality_user_roles_email_active
ON quality_user_roles(email, active);

CREATE INDEX IF NOT EXISTS idx_quality_user_roles_site_role
ON quality_user_roles(site_id, role, active);

-- The idempotent application bootstrap creates the core target/finding tables
-- for new installations and conditionally adds targets.site_id,
-- findings.site_id and findings.display_key for legacy databases. SQLite does
-- not support ADD COLUMN IF NOT EXISTS, so those upgrades remain in bootstrap.

PRAGMA optimize;
