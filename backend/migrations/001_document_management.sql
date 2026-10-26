-- Corporate document management: admin users, sessions, document metadata, versions and audit trail.
-- S3 holds the files; this database is the authoritative source for what the website publishes.

CREATE TABLE admin_users (
  id SERIAL PRIMARY KEY,
  employee_code TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'publisher', 'viewer')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX admin_users_employee_code_key ON admin_users (lower(employee_code));

CREATE TABLE auth_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  request_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_otps_user_idx ON auth_otps (user_id, created_at DESC);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Website document taxonomy. Leaf categories are website document pages (slug = /investors/<slug>);
-- parent categories group them in the portal (e.g. Stock Exchange Filings → Outcome of Board Meetings).
CREATE TABLE document_categories (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER REFERENCES document_categories (id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  s3_prefix TEXT NOT NULL UNIQUE,
  website_path TEXT,
  legacy_folder TEXT,
  legacy_page TEXT,
  group_by_financial_year BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE documents (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  display_filename TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES document_categories (id),
  financial_year TEXT CHECK (financial_year IS NULL OR financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  reporting_period TEXT,
  document_date DATE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'unpublished', 'archived')),
  current_version_id UUID,
  legacy_path TEXT UNIQUE,
  uploaded_by INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
);

CREATE INDEX documents_status_idx ON documents (status);
CREATE INDEX documents_category_idx ON documents (category_id);
CREATE INDEX documents_financial_year_idx ON documents (financial_year);

-- Every uploaded file is an immutable version with its own S3 object; replacing a document adds a version.
CREATE TABLE document_versions (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  s3_object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  content_type TEXT NOT NULL,
  etag TEXT,
  sha256 TEXT,
  uploaded_by INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_fk FOREIGN KEY (current_version_id) REFERENCES document_versions (id) DEFERRABLE INITIALLY DEFERRED;

-- Where a document is listed on the website. A filing can appear on several pages, optionally under a page-specific title.
CREATE TABLE document_placements (
  document_id UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES document_categories (id),
  display_order INTEGER NOT NULL DEFAULT 0,
  title_override TEXT,
  PRIMARY KEY (document_id, category_id)
);

CREATE INDEX document_placements_category_idx ON document_placements (category_id, display_order);

-- Presigned upload sessions. Files land under <prefix>/_incoming/ and are only copied to their final key once validated.
CREATE TABLE document_uploads (
  id UUID PRIMARY KEY,
  staging_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  declared_size BIGINT NOT NULL,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'rejected')),
  created_by INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

-- S3 objects whose deletion is still owed (deleted documents, failed compensations). Retried until they succeed.
CREATE TABLE storage_cleanup_queue (
  s3_object_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
