CREATE TABLE "catalog_import_batches" (
	"import_id" uuid NOT NULL,
	"batch_index" integer NOT NULL,
	"batch_checksum" text NOT NULL,
	"payload" jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_import_batches_import_id_batch_index_pk" PRIMARY KEY("import_id","batch_index"),
	CONSTRAINT "catalog_import_batches_index_nonnegative" CHECK ("catalog_import_batches"."batch_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_imports" ALTER COLUMN "diff" SET DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "catalog_imports" ALTER COLUMN "diff" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "header_hash" text;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "manifest_hash" text;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "environment" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "total_batches" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "received_batches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "applied_batches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "baseline_hash" text;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "deactivation_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_import_batches" ADD CONSTRAINT "catalog_import_batches_import_id_catalog_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."catalog_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_row_count_nonnegative" CHECK ("catalog_imports"."row_count" >= 0);--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_total_batches_positive" CHECK ("catalog_imports"."total_batches" > 0);--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_batch_progress_valid" CHECK ("catalog_imports"."received_batches" >= 0 and "catalog_imports"."applied_batches" >= 0 and "catalog_imports"."received_batches" <= "catalog_imports"."total_batches" and "catalog_imports"."applied_batches" <= "catalog_imports"."total_batches");--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_deactivation_count_nonnegative" CHECK ("catalog_imports"."deactivation_count" >= 0);