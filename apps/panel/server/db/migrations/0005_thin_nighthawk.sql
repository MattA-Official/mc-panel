CREATE TABLE `metrics` (
	`server` text NOT NULL,
	`at` integer NOT NULL,
	`cpu` real,
	`mem_mb` integer,
	`players` integer,
	`mspt` real,
	`disk_mb` integer,
	PRIMARY KEY(`server`, `at`)
);
