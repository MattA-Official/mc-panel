CREATE TABLE `backups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server` text NOT NULL,
	`file` text NOT NULL,
	`bytes` integer NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backups_file` ON `backups` (`server`,`file`);--> statement-breakpoint
ALTER TABLE `servers` ADD `backup_schedule` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `backup_tz` text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `keep_last` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `keep_daily` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `keep_weekly` integer DEFAULT 4 NOT NULL;