ALTER TABLE "class_sections" ADD COLUMN "department_code" text;--> statement-breakpoint
ALTER TABLE "class_sections" ADD COLUMN "department_name" text;--> statement-breakpoint
UPDATE "class_sections"
SET
	"department_code" = nullif(btrim("raw_source" ->> 'PKDWDM'), ''),
	"department_name" = nullif(btrim("raw_source" ->> 'PKDWDM_DISPLAY'), '')
WHERE
	"raw_source" ? 'PKDWDM'
	OR "raw_source" ? 'PKDWDM_DISPLAY';
