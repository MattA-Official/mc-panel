ALTER TABLE `backups` ADD `kept` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `exports` ADD `name` text;