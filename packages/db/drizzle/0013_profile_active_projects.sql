-- 0013_profile_active_projects.sql
-- user_profile テーブルに activeProjectIds を追加

ALTER TABLE user_profile ADD COLUMN active_project_ids TEXT;
