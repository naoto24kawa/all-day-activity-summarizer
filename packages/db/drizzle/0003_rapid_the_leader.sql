CREATE TABLE `task_dependencies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`depends_on_task_id` integer NOT NULL,
	`dependency_type` text DEFAULT 'blocks' NOT NULL,
	`confidence` real,
	`reason` text,
	`source_type` text DEFAULT 'auto' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `memos` ADD `project_id` integer;