-- Reference data. Idempotent: safe to run repeatedly; never overwrites values edited by an administrator.
INSERT INTO roles (code, name_ar, name_en, permissions) VALUES
  ('admin',         'مدير النظام',  'Administrator', '["*"]'),
  ('audit_manager', 'مدير التدقيق', 'Audit Manager', '["uploads:*","snapshots:read","registry:*","settings:read"]'),
  ('auditor',       'مدقق',         'Auditor',       '["uploads:create","uploads:read","snapshots:read","registry:read"]'),
  ('viewer',        'مشاهدة فقط',   'Viewer',        '["snapshots:read","registry:read"]')
ON CONFLICT (code) DO NOTHING;

INSERT INTO settings (key, value, description) VALUES
  ('aging',     '{"maxDays": 15, "criticalDays": 25, "bucketBounds": [3, 7, 15, 25]}', 'Approved aging thresholds (calendar days). Applies to all shipment types.'),
  ('upload',    '{"maxMb": 20, "maxRows": 200000, "maxColumns": 200, "maxSheets": 20}', 'Upload limits'),
  ('dates',     '{"defaultOrder": "DMY", "timezone": "Africa/Cairo"}', 'Default text-date order and the business timezone'),
  ('snapshots', '{"allowBackfill": false}', 'Backfilling a snapshot older than the latest one is not supported in Phase 2')
ON CONFLICT (key) DO NOTHING;
