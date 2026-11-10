CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`cron` text NOT NULL,
	`text` text,
	`warn` text DEFAULT '[]' NOT NULL,
	`skip_when_empty` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`last_ok` integer,
	`last_result` text,
	`last_reply` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `schedules_server` ON `schedules` (`server`,`position`);--> statement-breakpoint
ALTER TABLE `servers` ADD `timezone` text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
-- Channels that already take problem alerts hear about failed scheduled tasks too, as new channels do.
UPDATE `notify_channels` SET `events` = (
	SELECT json_group_array(`value`) FROM (
		SELECT `value` FROM json_each(`notify_channels`.`events`)
		UNION SELECT 'schedule.failed'
	)
) WHERE EXISTS (
	SELECT 1 FROM json_each(`notify_channels`.`events`)
	WHERE `value` IN ('backup.failed', 'offsite.failed', 'disk.full')
);
