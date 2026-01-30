CREATE TABLE `extraction_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`extraction_type` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`extracted_count` integer DEFAULT 0 NOT NULL,
	`extracted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vocabulary_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`term` text NOT NULL,
	`reading` text,
	`category` text,
	`reason` text,
	`source_type` text NOT NULL,
	`source_id` integer,
	`confidence` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`accepted_at` text,
	`rejected_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `profile_suggestion_id` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `vocabulary_suggestion_id` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `paused_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `pause_reason` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `similar_to_title` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `similar_to_status` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `similar_to_reason` text;