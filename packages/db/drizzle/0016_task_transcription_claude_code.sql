-- Add transcription_segment_id and claude_code_session_id columns to tasks table
ALTER TABLE tasks ADD COLUMN transcription_segment_id INTEGER;
ALTER TABLE tasks ADD COLUMN claude_code_session_id INTEGER;
