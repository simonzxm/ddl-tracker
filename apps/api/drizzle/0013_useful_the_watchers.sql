CREATE TABLE "catalog_sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repository" text NOT NULL,
	"commit_sha" text NOT NULL,
	"term_code" text NOT NULL,
	"source_path" text NOT NULL,
	"blob_sha" text NOT NULL,
	"source_checksum" text,
	"row_count" integer,
	"course_count" integer,
	"class_section_count" integer,
	"changed" boolean,
	"diff" jsonb DEFAULT 'null'::jsonb,
	"status" text NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "catalog_sync_runs_status_valid" CHECK ("catalog_sync_runs"."status" in ('succeeded', 'failed')),
	CONSTRAINT "catalog_sync_runs_counts_nonnegative" CHECK (("catalog_sync_runs"."row_count" is null or "catalog_sync_runs"."row_count" >= 0)
        and ("catalog_sync_runs"."course_count" is null or "catalog_sync_runs"."course_count" >= 0)
        and ("catalog_sync_runs"."class_section_count" is null or "catalog_sync_runs"."class_section_count" >= 0)),
	CONSTRAINT "catalog_sync_runs_time_order" CHECK ("catalog_sync_runs"."started_at" <= "catalog_sync_runs"."completed_at")
);
--> statement-breakpoint
CREATE TABLE "catalog_sync_state" (
	"repository" text NOT NULL,
	"term_code" text NOT NULL,
	"commit_sha" text NOT NULL,
	"blob_sha" text NOT NULL,
	"source_checksum" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"run_id" uuid NOT NULL,
	CONSTRAINT "catalog_sync_state_repository_term_code_pk" PRIMARY KEY("repository","term_code")
);
--> statement-breakpoint
ALTER TABLE "catalog_sync_state" ADD CONSTRAINT "catalog_sync_state_run_id_catalog_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."catalog_sync_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_sync_runs_term_completed_idx" ON "catalog_sync_runs" USING btree ("repository","term_code","completed_at");--> statement-breakpoint
CREATE INDEX "catalog_sync_runs_status_completed_idx" ON "catalog_sync_runs" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "catalog_sync_state_synced_idx" ON "catalog_sync_state" USING btree ("synced_at");