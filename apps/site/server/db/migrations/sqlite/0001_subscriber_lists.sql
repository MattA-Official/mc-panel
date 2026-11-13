DROP INDEX `subscribers_email_unique`;--> statement-breakpoint
ALTER TABLE `subscribers` ADD `list` text DEFAULT 'newsletter' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_list_email_unique` ON `subscribers` (`list`,`email`);