ALTER TABLE `recovery_codes` ADD `lookup` text;--> statement-breakpoint
CREATE INDEX `recovery_codes_lookup` ON `recovery_codes` (`lookup`);