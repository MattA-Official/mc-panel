CREATE TABLE `notify_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`url_sealed` text NOT NULL,
	`secret_sealed` text,
	`target` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`servers` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_sent_at` integer,
	`last_error` text,
	`last_error_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notify_channels_name` ON `notify_channels` (`name`);--> statement-breakpoint
CREATE TABLE `notify_state` (
	`key` text PRIMARY KEY NOT NULL,
	`sent_at` integer NOT NULL,
	`open` integer DEFAULT false NOT NULL,
	`value` text
);
