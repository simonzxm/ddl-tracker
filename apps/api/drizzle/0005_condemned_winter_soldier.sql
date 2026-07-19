CREATE TABLE "sync_event_retention" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"minimum_sequence" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_event_retention_singleton" CHECK ("sync_event_retention"."singleton_id" = 1),
	CONSTRAINT "sync_event_retention_sequence_nonnegative" CHECK ("sync_event_retention"."minimum_sequence" >= 0)
);
