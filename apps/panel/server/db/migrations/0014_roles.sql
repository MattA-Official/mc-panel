CREATE TABLE `grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`role_id` text NOT NULL,
	`server` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server`) REFERENCES `servers`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grants_user` ON `grants` (`user_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `roles` (`id`, `name`, `built_in`) VALUES ('owner', 'Owner', 1), ('admin', 'Admin', 1), ('operator', 'Operator', 1), ('viewer', 'Viewer', 1);
--> statement-breakpoint
INSERT INTO `grants` (`user_id`, `role_id`, `server`) SELECT `id`, 'owner', NULL FROM `users`;
