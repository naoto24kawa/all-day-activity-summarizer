CREATE TABLE `ai_job_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`params` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`result_summary` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`error_message` text,
	`locked_at` text,
	`run_after` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `merge_source_task_ids` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `merge_target_task_id` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `merged_at` text;