CREATE TABLE `ai_processing_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`process_type` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`input_size` integer,
	`output_size` integer,
	`duration_ms` integer NOT NULL,
	`error_message` text,
	`metadata` text,
	`created_at` text NOT NULL
);
