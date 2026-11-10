CREATE TABLE `player_names` (
	`server` text NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`server`, `uuid`)
);
--> statement-breakpoint
CREATE TABLE `player_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server` text NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`ended_by` text
);
--> statement-breakpoint
CREATE INDEX `player_sessions_player` ON `player_sessions` (`server`,`uuid`,`joined_at`);--> statement-breakpoint
CREATE INDEX `player_sessions_open` ON `player_sessions` (`server`,`left_at`);