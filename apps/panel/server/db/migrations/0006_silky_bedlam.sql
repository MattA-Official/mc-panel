CREATE TABLE `backup_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`endpoint` text NOT NULL,
	`region` text DEFAULT 'auto' NOT NULL,
	`bucket` text NOT NULL,
	`prefix` text DEFAULT 'flytower' NOT NULL,
	`access_key_id` text NOT NULL,
	`secret_sealed` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_targets_name` ON `backup_targets` (`name`);--> statement-breakpoint
ALTER TABLE `backups` ADD `offsite_state` text;--> statement-breakpoint
ALTER TABLE `backups` ADD `offsite_target` integer;--> statement-breakpoint
ALTER TABLE `backups` ADD `offsite_key` text;--> statement-breakpoint
ALTER TABLE `backups` ADD `offsite_error` text;--> statement-breakpoint
ALTER TABLE `backups` ADD `offsite_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `backups` ADD `offsite_at` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `offsite_target` integer;