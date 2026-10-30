-- destructive: true
ALTER TABLE data_quality_issues DROP CONSTRAINT IF EXISTS dqi_snapshot_fk;
DROP TABLE IF EXISTS snapshot_comparison_items, snapshot_comparisons, shipment_snapshots, snapshots CASCADE;
DROP FUNCTION IF EXISTS arrive_snapshots_guard() CASCADE;
