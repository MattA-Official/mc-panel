ALTER TABLE `servers` ADD `hostname` text;--> statement-breakpoint
CREATE UNIQUE INDEX `servers_hostname` ON `servers` (`hostname`);