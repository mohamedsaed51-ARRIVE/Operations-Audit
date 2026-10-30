-- destructive: true
DROP TABLE IF EXISTS status_aliases, status_dictionary, employees, branch_aliases, branches, audit_log, settings, users, roles CASCADE;
DROP FUNCTION IF EXISTS arrive_deny_delete(), arrive_deny_update(), arrive_set_updated_at() CASCADE;
