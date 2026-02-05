-- Remove experience_years column from user_profile table
-- This column was unused and not relevant to learning extraction

-- SQLite does not support DROP COLUMN directly in older versions
-- For SQLite 3.35.0+, we can use ALTER TABLE DROP COLUMN
ALTER TABLE `user_profile` DROP COLUMN `experience_years`;
