CREATE TABLE `branches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`name` text NOT NULL,
	`head_sha` text NOT NULL,
	`last_commit_message` text,
	`last_commit_date` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_repo_branch` ON `branches` (`repo_id`,`name`);--> statement-breakpoint
CREATE TABLE `repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`local_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_checked_at` integer,
	`status` text DEFAULT 'cloning' NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repos_url_unique` ON `repos` (`url`);