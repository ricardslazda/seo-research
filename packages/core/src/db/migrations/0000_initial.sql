CREATE TABLE `candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_key` text NOT NULL,
	`place_slug` text NOT NULL,
	FOREIGN KEY (`service_key`) REFERENCES `services`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_slug`) REFERENCES `places`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidates_pair` ON `candidates` (`service_key`,`place_slug`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`reason` text NOT NULL,
	`made_by` text NOT NULL,
	`evidence_raw_id` integer,
	`made_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decisions_subject` ON `decisions` (`subject_type`,`subject_id`,`kind`);--> statement-breakpoint
CREATE TABLE `domain_keywords` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`keyword_id` integer NOT NULL,
	`position` integer,
	`url` text,
	`etv` real,
	`raw_id` integer,
	FOREIGN KEY (`domain`) REFERENCES `domains`(`domain`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_keywords_pair` ON `domain_keywords` (`domain`,`keyword_id`);--> statement-breakpoint
CREATE TABLE `domain_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`url` text NOT NULL,
	`keywords_count` integer,
	`etv` real,
	`pos_1` integer,
	`pos_2_3` integer,
	`pos_4_10` integer,
	`fetched_at` text NOT NULL,
	`raw_id` integer,
	FOREIGN KEY (`domain`) REFERENCES `domains`(`domain`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_pages_url` ON `domain_pages` (`domain`,`url`);--> statement-breakpoint
CREATE TABLE `domains` (
	`domain` text PRIMARY KEY NOT NULL,
	`referring_domains` integer,
	`backlinks` integer,
	`referring_main_domains` integer,
	`fetched_at` text NOT NULL,
	`raw_id` integer,
	`labs_keywords` integer,
	`labs_etv` real,
	`labs_fetched_at` text,
	`labs_raw_id` integer,
	FOREIGN KEY (`raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`labs_raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `keyword_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`keyword_id` integer NOT NULL,
	`source` text NOT NULL,
	`volume` integer,
	`volume_status` text NOT NULL,
	`cpc` real,
	`competition_index` integer,
	`bid_low` real,
	`bid_high` real,
	`monthly_json` text,
	`series_hash` text,
	`difficulty` integer,
	`intent_endpoint` text,
	`intent_probability` real,
	`fetched_at` text NOT NULL,
	`raw_id` integer,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `keyword_metrics_keyword` ON `keyword_metrics` (`keyword_id`,`source`);--> statement-breakpoint
CREATE TABLE `keyword_origins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`keyword_id` integer NOT NULL,
	`source` text NOT NULL,
	`seed` text NOT NULL,
	`raw_id` integer,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_origins_identity` ON `keyword_origins` (`keyword_id`,`source`,`seed`);--> statement-breakpoint
CREATE TABLE `keywords` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`language` text NOT NULL,
	`location_code` integer NOT NULL,
	`candidate_id` integer,
	`role` text NOT NULL,
	`variant_of` integer,
	`variant_kind` text,
	`first_raw_id` integer,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_of`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`first_raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keywords_identity` ON `keywords` (`text`,`language`,`location_code`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_slug` text NOT NULL,
	`cid` text NOT NULL,
	`title` text,
	`category` text,
	`rating` real,
	`votes` integer,
	`claimed` integer,
	`domain` text,
	`address` text,
	`lat` real,
	`lng` real,
	`fetched_at` text NOT NULL,
	`raw_id` integer,
	FOREIGN KEY (`place_slug`) REFERENCES `places`(`slug`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_place_cid` ON `listings` (`place_slug`,`cid`);--> statement-breakpoint
CREATE TABLE `page_anatomy` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`url` text NOT NULL,
	`http_status` integer,
	`title` text,
	`word_count` integer,
	`headings_count` integer,
	`questions_count` integer,
	`phone_count` integer,
	`has_prices` integer,
	`rating_value` real,
	`rating_count` integer,
	`nav_links_json` text,
	`body_links_json` text,
	`headings_json` text,
	`fetched_at` text NOT NULL,
	`raw_id` integer,
	FOREIGN KEY (`domain`) REFERENCES `domains`(`domain`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_anatomy_url` ON `page_anatomy` (`url`);--> statement-breakpoint
CREATE TABLE `places` (
	`slug` text PRIMARY KEY NOT NULL,
	`location_code` integer NOT NULL,
	`kind` text NOT NULL,
	`parent_slug` text,
	`name_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rank_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`keyword_id` integer NOT NULL,
	`domain` text NOT NULL,
	`position` integer,
	`url` text,
	`page_key` text,
	`path_matches` integer,
	`own_pages_json` text,
	`pack_present` integer,
	`pack_has_business` integer,
	`serp_id` integer,
	`read_at` text NOT NULL,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`serp_id`) REFERENCES `serps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rank_readings_keyword` ON `rank_readings` (`keyword_id`,`domain`);--> statement-breakpoint
CREATE TABLE `raw_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer,
	`endpoint` text NOT NULL,
	`request_hash` text NOT NULL,
	`request_json` text NOT NULL,
	`response_json` text NOT NULL,
	`http_status` integer NOT NULL,
	`task_status_code` integer NOT NULL,
	`cost` real NOT NULL,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `raw_responses_lookup` ON `raw_responses` (`endpoint`,`request_hash`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `referring_domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text NOT NULL,
	`domain` text NOT NULL,
	`rank` integer,
	`backlinks` integer,
	`spam_score` integer,
	`first_seen` text,
	`nofollow` integer,
	`countries_json` text,
	`platforms_json` text,
	`fetched_at` text NOT NULL,
	`raw_id` integer,
	FOREIGN KEY (`raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referring_domains_pair` ON `referring_domains` (`target`,`domain`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phase` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`args_json` text NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `serp_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`serp_id` integer NOT NULL,
	`rank_absolute` integer NOT NULL,
	`rank_group` integer NOT NULL,
	`type` text NOT NULL,
	`domain` text,
	`url` text,
	`title` text,
	`payload_json` text,
	FOREIGN KEY (`serp_id`) REFERENCES `serps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `serp_items_serp` ON `serp_items` (`serp_id`,`rank_absolute`);--> statement-breakpoint
CREATE TABLE `serps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`keyword_id` integer NOT NULL,
	`location_code` integer NOT NULL,
	`language` text NOT NULL,
	`device` text NOT NULL,
	`depth` integer NOT NULL,
	`first_organic_rank` integer,
	`item_types_json` text NOT NULL,
	`fetched_at` text NOT NULL,
	`raw_id` integer,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_id`) REFERENCES `raw_responses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `serps_keyword` ON `serps` (`keyword_id`);--> statement-breakpoint
CREATE TABLE `services` (
	`key` text PRIMARY KEY NOT NULL,
	`head_json` text NOT NULL
);
