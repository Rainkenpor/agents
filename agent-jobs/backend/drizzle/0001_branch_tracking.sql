CREATE TABLE `branch_tracking` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`branch_name` text NOT NULL,
	`jira` text,
	`initial_commit_sha` text NOT NULL,
	`latest_commit_sha` text NOT NULL,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
