-- 0001_core: identity, configuration, registries, audit trail
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION arrive_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- Rows of protected tables can be removed only inside an explicit, audited purge
-- (SET LOCAL arrive.allow_purge = 'on'), e.g. a future data-retention job.
CREATE OR REPLACE FUNCTION arrive_deny_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is immutable: UPDATE is not allowed', TG_TABLE_NAME USING ERRCODE = 'AU001';
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION arrive_deny_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('arrive.allow_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'table % is protected: DELETE is not allowed', TG_TABLE_NAME USING ERRCODE = 'AU002';
END; $$ LANGUAGE plpgsql;

CREATE TABLE roles (
  id          smallserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  display_name  text NOT NULL,
  role_id       smallint NOT NULL REFERENCES roles(id),
  password_hash text,                       -- reserved: authentication is not implemented in Phase 2
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION arrive_set_updated_at();

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id)
);
CREATE TRIGGER settings_updated BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION arrive_set_updated_at();

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  request_id   text,
  actor_id     uuid REFERENCES users(id),
  actor_label  text NOT NULL,
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  outcome      text NOT NULL DEFAULT 'SUCCESS' CHECK (outcome IN ('SUCCESS', 'FAILURE')),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_action_idx ON audit_log (action, occurred_at DESC);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION arrive_deny_update();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION arrive_deny_delete();

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  name_key    text NOT NULL UNIQUE,          -- folded matching key
  code        text UNIQUE,
  governorate text,
  is_active   boolean NOT NULL DEFAULT true,
  source      text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'AUTO_REGISTERED_FROM_UPLOAD')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER branches_updated BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION arrive_set_updated_at();

CREATE TABLE branch_aliases (
  id         bigserial PRIMARY KEY,
  branch_id  uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  alias      text NOT NULL,
  alias_key  text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX branch_aliases_branch_idx ON branch_aliases (branch_id);

CREATE TABLE employees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  name_key    text NOT NULL UNIQUE,
  branch_id   uuid REFERENCES branches(id),
  -- Only verified employees are treated as a reliable registry (branch-consistency checks).
  is_verified boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  source      text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'AUTO_REGISTERED_FROM_UPLOAD')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employees_branch_idx ON employees (branch_id);
CREATE TRIGGER employees_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION arrive_set_updated_at();

CREATE TABLE status_dictionary (
  id          smallserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  label_ar    text NOT NULL,
  label_en    text NOT NULL,
  -- NULL = not yet decided by ARRIVE. Phase 2 does not interpret it.
  is_terminal boolean,
  is_active   boolean NOT NULL DEFAULT true,
  source      text NOT NULL DEFAULT 'SEED_PLACEHOLDER',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE status_aliases (
  id         bigserial PRIMARY KEY,
  status_id  smallint NOT NULL REFERENCES status_dictionary(id) ON DELETE CASCADE,
  alias      text NOT NULL,
  alias_key  text NOT NULL UNIQUE
);
CREATE INDEX status_aliases_status_idx ON status_aliases (status_id);
