CREATE TABLE `slack_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`channel_name` text,
	`project_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_channels_channel_id_unique` ON `slack_channels` (`channel_id`);