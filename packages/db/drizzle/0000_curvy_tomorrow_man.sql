CREATE TABLE `claude_code_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`date` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`timestamp` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `claude_code_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`project_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`error_message` text,
	`locked_at` text,
	`run_after` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `claude_code_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`session_id` text NOT NULL,
	`project_path` text NOT NULL,
	`project_name` text,
	`start_time` text,
	`end_time` text,
	`user_message_count` integer DEFAULT 0 NOT NULL,
	`assistant_message_count` integer DEFAULT 0 NOT NULL,
	`tool_use_count` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claude_code_sessions_session_id_unique` ON `claude_code_sessions` (`session_id`);--> statement-breakpoint
CREATE TABLE `evaluator_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`audio_file_path` text NOT NULL,
	`transcription_text` text NOT NULL,
	`judgment` text NOT NULL,
	`confidence` real NOT NULL,
	`reason` text NOT NULL,
	`suggested_pattern` text,
	`pattern_applied` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feedbacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`rating` text NOT NULL,
	`issues` text,
	`reason` text,
	`corrected_text` text,
	`correct_judgment` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`comment_type` text NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`item_number` integer NOT NULL,
	`comment_id` text NOT NULL,
	`author_login` text,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`review_state` text,
	`github_created_at` text,
	`is_read` integer DEFAULT false,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`item_type` text NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`url` text NOT NULL,
	`author_login` text,
	`assignee_login` text,
	`labels` text,
	`body` text,
	`github_created_at` text,
	`github_updated_at` text,
	`closed_at` text,
	`merged_at` text,
	`is_draft` integer,
	`review_decision` text,
	`is_review_requested` integer DEFAULT false,
	`comment_count` integer DEFAULT 0,
	`is_read` integer DEFAULT false,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`error_message` text,
	`locked_at` text,
	`run_after` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_type` text DEFAULT 'claude-code' NOT NULL,
	`source_id` text NOT NULL,
	`project_id` integer,
	`date` text NOT NULL,
	`content` text NOT NULL,
	`category` text,
	`tags` text,
	`confidence` real,
	`repetition_count` integer DEFAULT 0 NOT NULL,
	`ease_factor` real DEFAULT 2.5 NOT NULL,
	`interval` integer DEFAULT 0 NOT NULL,
	`next_review_at` text,
	`last_reviewed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`content` text NOT NULL,
	`tags` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`suggestion_type` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`reason` text,
	`source_type` text NOT NULL,
	`source_id` text,
	`confidence` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`accepted_at` text,
	`rejected_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`github_owner` text,
	`github_repo` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_improvements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text NOT NULL,
	`previous_prompt` text NOT NULL,
	`new_prompt` text NOT NULL,
	`feedback_count` integer NOT NULL,
	`good_count` integer NOT NULL,
	`bad_count` integer NOT NULL,
	`improvement_reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approved_at` text,
	`rejected_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `segment_feedbacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`segment_id` integer NOT NULL,
	`rating` text NOT NULL,
	`target` text DEFAULT 'interpret' NOT NULL,
	`reason` text,
	`issues` text,
	`corrected_text` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slack_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`message_ts` text NOT NULL,
	`channel_id` text NOT NULL,
	`channel_name` text,
	`user_id` text NOT NULL,
	`user_name` text,
	`message_type` text NOT NULL,
	`text` text NOT NULL,
	`thread_ts` text,
	`permalink` text,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slack_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`channel_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`error_message` text,
	`locked_at` text,
	`run_after` text NOT NULL,
	`last_fetched_ts` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slack_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`slack_name` text,
	`display_name` text,
	`speaker_names` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_users_user_id_unique` ON `slack_users` (`user_id`);--> statement-breakpoint
CREATE TABLE `summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`summary_type` text NOT NULL,
	`content` text NOT NULL,
	`segment_ids` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `summary_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`date` text NOT NULL,
	`period_param` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`error_message` text,
	`locked_at` text,
	`run_after` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`slack_message_id` integer,
	`github_comment_id` integer,
	`memo_id` integer,
	`prompt_improvement_id` integer,
	`project_id` integer,
	`source_type` text DEFAULT 'slack' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` text,
	`confidence` real,
	`due_date` text,
	`extracted_at` text NOT NULL,
	`accepted_at` text,
	`rejected_at` text,
	`started_at` text,
	`completed_at` text,
	`reject_reason` text,
	`original_title` text,
	`original_description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcription_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`audio_source` text NOT NULL,
	`audio_file_path` text NOT NULL,
	`transcription` text NOT NULL,
	`language` text DEFAULT 'ja' NOT NULL,
	`confidence` real,
	`speaker` text,
	`interpreted_text` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`experience_years` integer,
	`specialties` text,
	`known_technologies` text,
	`learning_goals` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vocabulary` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`term` text NOT NULL,
	`reading` text,
	`category` text,
	`source` text NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vocabulary_term_unique` ON `vocabulary` (`term`);