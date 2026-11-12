CREATE TABLE `subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`consent_version` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`confirmed_at` text,
	`token_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_email_unique` ON `subscribers` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_token_hash_unique` ON `subscribers` (`token_hash`);