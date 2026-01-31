-- Add excludedAt column to projects table for soft delete (scan exclusion)
ALTER TABLE projects ADD COLUMN excluded_at TEXT;
