CREATE TABLE `analyses` (
	`recording_id` text PRIMARY KEY NOT NULL,
	`transcript` text,
	`prosody` text,
	`contour` text,
	`metrics` text,
	`llm` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `baselines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`session_id` text,
	`median_hz` real,
	`f0_floor` real,
	`f0_ceiling` real,
	`st_sd` real,
	`st_sd_reading` real,
	`st_sd_free` real,
	`range_st` real,
	`db_sd` real,
	`wpm` real,
	`fillers_per_min` real,
	`mlr` real,
	`bands` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `drill_reps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`recording_id` text,
	`drill` text NOT NULL,
	`stage` integer,
	`item_id` text,
	`target` text,
	`score` real,
	`on_target` integer,
	`details` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `drill_reps_drill_idx` ON `drill_reps` (`drill`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `levels` (
	`track` text PRIMARY KEY NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`passes` integer DEFAULT 0 NOT NULL,
	`history` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`client_id` text NOT NULL,
	`part` integer DEFAULT 0 NOT NULL,
	`label` text,
	`path` text NOT NULL,
	`mime` text,
	`duration_s` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`meta` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_client_idx` ON `recordings` (`client_id`);--> statement-breakpoint
CREATE INDEX `recordings_session_idx` ON `recordings` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`mode` text,
	`title` text,
	`prompt` text,
	`tag` text DEFAULT 'drill' NOT NULL,
	`feedback` text DEFAULT 'continuous' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`passed` integer,
	`score` real,
	`summary` text,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `sessions_started_idx` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `sessions_kind_idx` ON `sessions` (`kind`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `streaks` (
	`day` text PRIMARY KEY NOT NULL,
	`minutes` real DEFAULT 0 NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	`daily_done` integer DEFAULT false NOT NULL,
	`challenge_done` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `windows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recording_id` text NOT NULL,
	`start` real NOT NULL,
	`end` real NOT NULL,
	`st_sd` real,
	`db_sd` real,
	`voiced_frac` real,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `windows_recording_idx` ON `windows` (`recording_id`);--> statement-breakpoint
CREATE TABLE `words` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recording_id` text NOT NULL,
	`idx` integer NOT NULL,
	`w` text NOT NULL,
	`start` real NOT NULL,
	`end` real NOT NULL,
	`prob` real,
	`f0_peak_st` real,
	`f0_mean_st` real,
	`db_mean` real,
	`is_filler` integer DEFAULT false NOT NULL,
	`filler_tag` integer,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `words_recording_idx` ON `words` (`recording_id`);