CREATE TABLE `calendar_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`event_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`summary` text NOT NULL,
	`description` text,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`is_all_day` integer DEFAULT false NOT NULL,
	`location` text,
	`attendees` text,
	`organizer` text,
	`conference_link` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`project_id` integer,
	`synced_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`calendar_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`error_message` text,
	`locked_at` text,
	`run_after` text NOT NULL,
	`page_token` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `slack_messages` ADD `priority` text;--> statement-breakpoint
ALTER TABLE `summaries` ADD `source_metadata` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `completion_check_status` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pending_completion_check` text;