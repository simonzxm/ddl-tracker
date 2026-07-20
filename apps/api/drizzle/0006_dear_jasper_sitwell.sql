CREATE TABLE "rate_limit_counters" (
	"scope" text NOT NULL,
	"subject_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_counters_scope_subject_key_window_start_pk" PRIMARY KEY("scope","subject_key","window_start"),
	CONSTRAINT "rate_limit_counters_count_positive" CHECK ("rate_limit_counters"."count" > 0),
	CONSTRAINT "rate_limit_counters_window_valid" CHECK ("rate_limit_counters"."expires_at" > "rate_limit_counters"."window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expiry_idx" ON "rate_limit_counters" USING btree ("expires_at");