CREATE TABLE `claude_code_paths` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_path` text NOT NULL,
	`project_name` text,
	`project_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claude_code_paths_project_path_unique` ON `claude_code_paths` (`project_path`);--> statement-breakpoint
CREATE TABLE `project_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`github_owner` text,
	`github_repo` text,
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
CREATE TABLE `rate_limit_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text NOT NULL,
	`process_type` text NOT NULL,
	`model` text,
	`request_count` integer DEFAULT 1 NOT NULL,
	`estimated_tokens` integer NOT NULL,
	`actual_tokens` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `excluded_at` text;--> statement-breakpoint
ALTER TABLE `summary_queue` ADD `start_hour` integer;--> statement-breakpoint
ALTER TABLE `summary_queue` ADD `end_hour` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `project_suggestion_id` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `work_type` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `parent_id` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `elaboration_status` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pending_elaboration` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `step_number` integer;