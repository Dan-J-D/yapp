CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`kind` text NOT NULL,
	`source` text DEFAULT 'seed' NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`first_day` text,
	`last_day` text,
	`next_due_day` text,
	`tell_count` integer DEFAULT 0 NOT NULL,
	`last_session_id` text,
	`archived` integer DEFAULT false NOT NULL,
	`history` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stories_due_idx` ON `stories` (`next_due_day`);--> statement-breakpoint
CREATE INDEX `stories_kind_stage_idx` ON `stories` (`kind`,`stage`);