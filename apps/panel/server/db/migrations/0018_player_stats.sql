CREATE TABLE `player_stats` (
	`server` text NOT NULL,
	`uuid` text NOT NULL,
	`day` text NOT NULL,
	`taken_at` integer NOT NULL,
	`stats` text NOT NULL,
	PRIMARY KEY(`server`, `uuid`, `day`)
);
