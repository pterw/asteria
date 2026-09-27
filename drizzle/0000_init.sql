CREATE TABLE "journal_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"journal_id" uuid,
	"kind" varchar(40) NOT NULL,
	"star_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" varchar(60),
	"time_zone" varchar(64),
	"recovery_key_hash" text,
	"recovery_key_created_at" timestamp with time zone,
	"seeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"share_anonymous_metrics" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_bucket_window_start_pk" PRIMARY KEY("bucket","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device" varchar(48),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"title" varchar(80) DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"mood" varchar(24) NOT NULL,
	"intensity" smallint DEFAULT 3 NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')) STORED,
	CONSTRAINT "stars_mood_check" CHECK ("stars"."mood" in ('luminous','tender','serene','electric','verdant','vesper')),
	CONSTRAINT "stars_intensity_check" CHECK ("stars"."intensity" between 1 and 5),
	CONSTRAINT "stars_content_length_check" CHECK (char_length("stars"."content") between 1 and 420),
	CONSTRAINT "stars_title_length_check" CHECK (char_length("stars"."title") <= 80),
	CONSTRAINT "stars_coords_check" CHECK ("stars"."x" between -100000 and 100000 and "stars"."y" between -100000 and 100000)
);
--> statement-breakpoint
ALTER TABLE "journal_events" ADD CONSTRAINT "journal_events_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_events_journal_idx" ON "journal_events" USING btree ("journal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_recovery_key_idx" ON "journals" USING btree ("recovery_key_hash");--> statement-breakpoint
CREATE INDEX "journals_last_seen_idx" ON "journals" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "rate_limits_expiry_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_journal_idx" ON "sessions" USING btree ("journal_id","expires_at");--> statement-breakpoint
CREATE INDEX "stars_journal_created_idx" ON "stars" USING btree ("journal_id","created_at");--> statement-breakpoint
CREATE INDEX "stars_search_idx" ON "stars" USING gin ("search");--> statement-breakpoint
CREATE INDEX "stars_journal_mood_idx" ON "stars" USING btree ("journal_id","mood");