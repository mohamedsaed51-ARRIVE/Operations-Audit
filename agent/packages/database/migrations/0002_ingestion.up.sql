-- 0002_ingestion: uploads, sheets, column mappings, original rows, data-quality issues
CREATE TABLE uploads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename text NOT NULL,
  stored_path      text,                     -- NULL for rejected files that were never stored
  sha256           text,
  size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
  file_type        text CHECK (file_type IN ('xlsx', 'xls', 'csv')),
  snapshot_date    date NOT NULL,
  status           text NOT NULL DEFAULT 'UPLOADED'
                   CHECK (status IN ('UPLOADED', 'MAPPED', 'PROCESSING', 'PROCESSED', 'FAILED', 'REJECTED')),
  failure_reason   text,
  date1904         boolean NOT NULL DEFAULT false,
  uploaded_by      uuid REFERENCES users(id),
  uploaded_by_label text NOT NULL,
  request_id       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX uploads_created_idx ON uploads (created_at DESC);
CREATE INDEX uploads_sha_idx ON uploads (sha256);
CREATE INDEX uploads_snapshot_date_idx ON uploads (snapshot_date);
CREATE TRIGGER uploads_updated BEFORE UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION arrive_set_updated_at();

CREATE TABLE upload_sheets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id        uuid NOT NULL REFERENCES uploads(id),
  sheet_index      int NOT NULL,
  name             text NOT NULL,
  hidden           boolean NOT NULL DEFAULT false,
  row_count        int NOT NULL,            -- spreadsheet rows read (including header/blank rows)
  first_excel_row  int NOT NULL DEFAULT 1,  -- Excel row number of the first stored row
  first_column     int NOT NULL DEFAULT 0,
  header_row_index int,                     -- 0-based index inside the stored rows; NULL = none found
  headers          jsonb NOT NULL DEFAULT '[]'::jsonb,
  detection        jsonb,                   -- automatic column detection (suggestions only)
  status           text NOT NULL DEFAULT 'DETECTED' CHECK (status IN ('DETECTED', 'MAPPED', 'SKIPPED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (upload_id, sheet_index)
);

CREATE TABLE column_mappings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id         uuid NOT NULL REFERENCES uploads(id),
  sheet_id          uuid NOT NULL REFERENCES upload_sheets(id),
  version           int NOT NULL,
  include_sheet     boolean NOT NULL,
  header_row_index  int NOT NULL,
  columns           jsonb NOT NULL,         -- { field: columnIndex }
  acknowledged      text[] NOT NULL DEFAULT '{}',
  date_order        text NOT NULL DEFAULT 'DMY' CHECK (date_order IN ('DMY', 'MDY')),
  validation        jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_by      uuid REFERENCES users(id),
  confirmed_by_label text NOT NULL,
  confirmed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sheet_id, version)
);
CREATE INDEX column_mappings_upload_idx ON column_mappings (upload_id);

CREATE TABLE raw_rows (
  id         bigserial PRIMARY KEY,
  upload_id  uuid NOT NULL REFERENCES uploads(id),
  sheet_id   uuid NOT NULL REFERENCES upload_sheets(id),
  row_number int NOT NULL,                  -- Excel row number (CSV: record number)
  cells      jsonb NOT NULL,                -- original cell values, exactly as read
  UNIQUE (sheet_id, row_number)
);
CREATE INDEX raw_rows_upload_idx ON raw_rows (upload_id);
CREATE TRIGGER raw_rows_no_update BEFORE UPDATE ON raw_rows FOR EACH ROW EXECUTE FUNCTION arrive_deny_update();
CREATE TRIGGER raw_rows_no_delete BEFORE DELETE ON raw_rows FOR EACH ROW EXECUTE FUNCTION arrive_deny_delete();

CREATE TABLE data_quality_issues (
  id             bigserial PRIMARY KEY,
  upload_id      uuid NOT NULL REFERENCES uploads(id),
  sheet_id       uuid REFERENCES upload_sheets(id),
  snapshot_id    uuid,                      -- FK added in 0003
  raw_row_id     bigint REFERENCES raw_rows(id),
  stage          text NOT NULL CHECK (stage IN ('UPLOAD', 'MAPPING', 'PROCESS')),
  code           text NOT NULL,
  category       text NOT NULL CHECK (category IN ('FILE_LEVEL', 'ROW_LEVEL', 'BUSINESS_WARNING', 'MAPPING_WARNING')),
  severity       text NOT NULL CHECK (severity IN ('ERROR', 'WARNING', 'INFO')),
  worksheet      text,
  row_number     int,
  field          text,
  original_value text,
  explanation    text NOT NULL,
  suggestion     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dqi_upload_idx ON data_quality_issues (upload_id, category, severity);
CREATE INDEX dqi_code_idx ON data_quality_issues (upload_id, code);
CREATE INDEX dqi_snapshot_idx ON data_quality_issues (snapshot_id);
CREATE INDEX dqi_stage_idx ON data_quality_issues (upload_id, stage);
