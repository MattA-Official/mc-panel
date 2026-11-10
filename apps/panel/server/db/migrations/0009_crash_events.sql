CREATE TABLE `server_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server` text NOT NULL,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`kind` text NOT NULL,
	`cause` text,
	`result` text,
	`exit_status` integer,
	`crash_report` text,
	`log_tail` text,
	`dismissed_at` integer
);
--> statement-breakpoint
CREATE INDEX `server_events_server_at` ON `server_events` (`server`,`at`);--> statement-breakpoint
ALTER TABLE `servers` ADD `restart_when_unresponsive` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Channels that already take problem alerts take crash alerts too, as new channels do.
UPDATE `notify_channels` SET `events` = (
	SELECT json_group_array(`value`) FROM (
		SELECT `value` FROM json_each(`notify_channels`.`events`)
		UNION SELECT 'server.crashed'
		UNION SELECT 'server.crash_loop'
		UNION SELECT 'server.unresponsive'
	)
) WHERE EXISTS (
	SELECT 1 FROM json_each(`notify_channels`.`events`)
	WHERE `value` IN ('backup.failed', 'offsite.failed', 'disk.full')
);
