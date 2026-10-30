-- 0003_snapshots: versioned daily inventory snapshots and their comparisons
CREATE TABLE snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date         date NOT NULL,
  version               int NOT NULL DEFAULT 1,
  upload_id             uuid NOT NULL UNIQUE REFERENCES uploads(id),
  supersedes_snapshot_id uuid REFERENCES snapshots(id),
  status                text NOT NULL DEFAULT 'BUILDING' CHECK (status IN ('BUILDING', 'COMPLETED')),
  total_rows            int NOT NULL DEFAULT 0,
  ingested_rows         int NOT NULL DEFAULT 0,
  rejected_rows         int NOT NULL DEFAULT 0,
  empty_rows            int NOT NULL DEFAULT 0,
  duplicate_rows        int NOT NULL DEFAULT 0,
  config_used           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- thresholds in force when built
  created_by_label      text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  UNIQUE (snapshot_date, version)
);
CREATE INDEX snapshots_date_idx ON snapshots (snapshot_date DESC, version DESC);

-- A completed snapshot can never be changed or removed.
CREATE OR REPLACE FUNCTION arrive_snapshots_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'COMPLETED' THEN
      RAISE EXCEPTION 'snapshot % is completed and immutable', OLD.id USING ERRCODE = 'AU001';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('arrive.allow_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'snapshots are protected: DELETE is not allowed' USING ERRCODE = 'AU002';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER snapshots_guard_upd BEFORE UPDATE ON snapshots FOR EACH ROW EXECUTE FUNCTION arrive_snapshots_guard();
CREATE TRIGGER snapshots_guard_del BEFORE DELETE ON snapshots FOR EACH ROW EXECUTE FUNCTION arrive_snapshots_guard();

ALTER TABLE data_quality_issues
  ADD CONSTRAINT dqi_snapshot_fk FOREIGN KEY (snapshot_id) REFERENCES snapshots(id);

CREATE TABLE shipment_snapshots (
  id                  bigserial PRIMARY KEY,
  snapshot_id         uuid NOT NULL REFERENCES snapshots(id),
  snapshot_date       date NOT NULL,
  upload_id           uuid NOT NULL REFERENCES uploads(id),
  raw_row_id          bigint NOT NULL REFERENCES raw_rows(id),   -- provenance: the untouched source row
  sheet_name          text NOT NULL,
  excel_row           int NOT NULL,
  tracking_number     text NOT NULL,
  tracking_key        text NOT NULL,
  status_raw          text,
  status_key          text,
  status_code         text,
  status_known        boolean NOT NULL DEFAULT false,
  branch_raw          text,
  branch_key          text,
  branch_id           uuid REFERENCES branches(id),
  employee_raw        text,
  employee_key        text,
  employee_id         uuid REFERENCES employees(id),
  employee_missing    boolean,                 -- NULL = no employee column in the source sheet
  created_date        date,
  status_entry_date   date,
  last_update_date    date,
  governorate_raw     text,
  governorate_key     text,
  shipment_age_days   int,
  age_category        text CHECK (age_category IN ('D0_3', 'D4_7', 'D8_15', 'D16_25', 'D26_PLUS')),
  status_age_days     int,                     -- NULL = unknown (see status_age_basis)
  status_age_basis    text NOT NULL CHECK (status_age_basis IN ('STATUS_ENTRY_DATE', 'OBSERVED_SNAPSHOTS', 'UNKNOWN_INSUFFICIENT_HISTORY')),
  status_observed_since date,                  -- first snapshot of the current unbroken run with this status
  last_update_age_days int,
  is_primary          boolean NOT NULL DEFAULT true,
  duplicate_group_size int NOT NULL DEFAULT 1,
  duplicate_rank      int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- duplicates are stored; only the primary occurrence is unique per snapshot
CREATE UNIQUE INDEX shipment_snapshots_primary_uq ON shipment_snapshots (snapshot_id, tracking_key) WHERE is_primary;
CREATE INDEX shipment_snapshots_snapshot_idx ON shipment_snapshots (snapshot_id);
CREATE INDEX shipment_snapshots_tracking_idx ON shipment_snapshots (tracking_key);
CREATE INDEX shipment_snapshots_branch_idx ON shipment_snapshots (snapshot_id, branch_key);
CREATE INDEX shipment_snapshots_age_idx ON shipment_snapshots (snapshot_id, age_category);
CREATE INDEX shipment_snapshots_emp_idx ON shipment_snapshots (snapshot_id, employee_key);
CREATE TRIGGER shipment_snapshots_no_update BEFORE UPDATE ON shipment_snapshots FOR EACH ROW EXECUTE FUNCTION arrive_deny_update();
CREATE TRIGGER shipment_snapshots_no_delete BEFORE DELETE ON shipment_snapshots FOR EACH ROW EXECUTE FUNCTION arrive_deny_delete();

CREATE TABLE snapshot_comparisons (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id           uuid NOT NULL UNIQUE REFERENCES snapshots(id),
  previous_snapshot_id  uuid REFERENCES snapshots(id),
  previous_snapshot_date date,
  days_between          int,
  mode                  text NOT NULL CHECK (mode IN ('BASELINE', 'COMPARED', 'INVALID')),
  new_count             int NOT NULL DEFAULT 0,
  continued_count       int NOT NULL DEFAULT 0,
  status_changed_count  int NOT NULL DEFAULT 0,
  branch_changed_count  int NOT NULL DEFAULT 0,
  employee_changed_count int NOT NULL DEFAULT 0,
  disappeared_count     int NOT NULL DEFAULT 0,
  reappeared_count      int NOT NULL DEFAULT 0,
  warnings              jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER snapshot_comparisons_no_update BEFORE UPDATE ON snapshot_comparisons FOR EACH ROW EXECUTE FUNCTION arrive_deny_update();
CREATE TRIGGER snapshot_comparisons_no_delete BEFORE DELETE ON snapshot_comparisons FOR EACH ROW EXECUTE FUNCTION arrive_deny_delete();

CREATE TABLE snapshot_comparison_items (
  id                     bigserial PRIMARY KEY,
  comparison_id          uuid NOT NULL REFERENCES snapshot_comparisons(id),
  tracking_key           text NOT NULL,
  tracking_number        text NOT NULL,
  change_types           text[] NOT NULL,
  prev_status_raw        text, prev_branch_raw text, prev_employee_raw text,
  curr_status_raw        text, curr_branch_raw text, curr_employee_raw text,
  last_seen_snapshot_id  uuid REFERENCES snapshots(id),
  last_seen_date         date
);
CREATE INDEX sci_comparison_idx ON snapshot_comparison_items (comparison_id);
CREATE INDEX sci_types_idx ON snapshot_comparison_items USING gin (change_types);
CREATE INDEX sci_tracking_idx ON snapshot_comparison_items (tracking_key);
CREATE TRIGGER sci_no_update BEFORE UPDATE ON snapshot_comparison_items FOR EACH ROW EXECUTE FUNCTION arrive_deny_update();
CREATE TRIGGER sci_no_delete BEFORE DELETE ON snapshot_comparison_items FOR EACH ROW EXECUTE FUNCTION arrive_deny_delete();
