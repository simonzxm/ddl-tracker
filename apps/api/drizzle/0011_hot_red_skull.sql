CREATE TABLE "catalog_revision" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_revision_singleton" CHECK ("catalog_revision"."singleton_id" = 1),
	CONSTRAINT "catalog_revision_positive" CHECK ("catalog_revision"."revision" > 0)
);--> statement-breakpoint
INSERT INTO "catalog_revision" ("singleton_id", "revision") VALUES (1, 1);
