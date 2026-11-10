CREATE TABLE `update_status` (
	`scope` text NOT NULL,
	`subject` text NOT NULL,
	`summary` text,
	`checked_at` integer,
	`last_error` text,
	`error_at` integer,
	PRIMARY KEY(`scope`, `subject`)
);
