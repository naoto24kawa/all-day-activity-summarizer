-- Task merge support columns
ALTER TABLE tasks ADD COLUMN merge_source_task_ids TEXT;
ALTER TABLE tasks ADD COLUMN merge_target_task_id INTEGER;
ALTER TABLE tasks ADD COLUMN merged_at TEXT;
