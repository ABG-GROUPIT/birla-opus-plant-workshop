CREATE TABLE `workshop_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`plant` text NOT NULL,
	`submitter_name` text DEFAULT '' NOT NULL,
	`submitter_email` text DEFAULT '' NOT NULL,
	`use_case_1` text DEFAULT '' NOT NULL,
	`use_case_2` text DEFAULT '' NOT NULL,
	`use_case_3` text DEFAULT '' NOT NULL,
	`use_case_4` text DEFAULT '' NOT NULL,
	`value_stream_1_selected` integer DEFAULT false NOT NULL,
	`value_stream_2_selected` integer DEFAULT false NOT NULL,
	`value_stream_3_selected` integer DEFAULT false NOT NULL,
	`value_stream_4_selected` integer DEFAULT false NOT NULL,
	`expected_benefits` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`is_visible` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`submitted_at` text,
	`reviewed_at` text,
	CONSTRAINT "workshop_submissions_plant_check" CHECK("workshop_submissions"."plant" in ('Panipat', 'Ludhiana', 'Cheyyar', 'Chamarajanagar', 'Mahad', 'Kharagpur')),
	CONSTRAINT "workshop_submissions_status_check" CHECK("workshop_submissions"."status" in ('draft', 'submitted', 'approved', 'rejected')),
	CONSTRAINT "workshop_submissions_visibility_check" CHECK("workshop_submissions"."is_visible" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `workshop_submissions_plant_idx` ON `workshop_submissions` (`plant`);--> statement-breakpoint
CREATE INDEX `workshop_submissions_status_visibility_idx` ON `workshop_submissions` (`status`,`is_visible`);--> statement-breakpoint
CREATE INDEX `workshop_submissions_created_at_idx` ON `workshop_submissions` (`created_at`);