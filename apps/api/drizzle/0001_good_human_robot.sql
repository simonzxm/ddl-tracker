CREATE TABLE "registration_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"provider" text NOT NULL,
	"normalized_subject" text NOT NULL,
	"subject_display" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_tokens_attempts_nonnegative" CHECK ("registration_tokens"."attempts" >= 0)
);
--> statement-breakpoint
DROP INDEX "auth_challenges_current_subject_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "registration_tokens_hash_unique" ON "registration_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "registration_tokens_expiry_idx" ON "registration_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_active_subject_unique" ON "auth_challenges" USING btree ("provider","normalized_subject") WHERE "auth_challenges"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_pending_subject_unique" ON "auth_challenges" USING btree ("provider","normalized_subject") WHERE "auth_challenges"."status" = 'pending';