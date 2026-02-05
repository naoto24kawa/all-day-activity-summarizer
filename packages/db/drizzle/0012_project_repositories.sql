-- Create project_repositories table for many-to-many relationship
CREATE TABLE IF NOT EXISTS project_repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create unique index to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_repositories_unique
  ON project_repositories(project_id, github_owner, github_repo);

-- Migrate existing data from projects table
INSERT INTO project_repositories (project_id, github_owner, github_repo, created_at)
SELECT id, github_owner, github_repo, datetime('now')
FROM projects
WHERE github_owner IS NOT NULL AND github_repo IS NOT NULL;
