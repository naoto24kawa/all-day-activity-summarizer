-- Add explanation columns to learnings table
ALTER TABLE learnings ADD COLUMN explanation_status TEXT;
ALTER TABLE learnings ADD COLUMN pending_explanation TEXT;
ALTER TABLE learnings ADD COLUMN expanded_content TEXT;
