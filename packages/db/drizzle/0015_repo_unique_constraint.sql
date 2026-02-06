-- Add unique constraint on (github_owner, github_repo) to enforce 1:1 relationship
-- Repository -> Project: 1つのリポジトリは1つのプロジェクトにのみ属する

-- First, check for duplicates and keep only the first entry for each repo
-- Delete duplicate entries (keep the one with lowest id)
DELETE FROM project_repositories
WHERE id NOT IN (
  SELECT MIN(id)
  FROM project_repositories
  GROUP BY github_owner, github_repo
);

-- Create unique index on (github_owner, github_repo)
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_repositories_repo
  ON project_repositories(github_owner, github_repo);

-- Migrate any remaining data from projects table that doesn't exist in project_repositories
INSERT OR IGNORE INTO project_repositories (project_id, github_owner, github_repo, local_path, created_at)
SELECT id, github_owner, github_repo, path, datetime('now')
FROM projects
WHERE github_owner IS NOT NULL
  AND github_repo IS NOT NULL;
