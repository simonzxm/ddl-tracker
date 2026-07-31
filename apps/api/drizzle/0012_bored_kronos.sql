TRUNCATE TABLE "users", "academic_terms", "rate_limit_counters", "sync_event_retention" RESTART IDENTITY CASCADE;--> statement-breakpoint
CREATE TYPE "public"."oidc_login_status" AS ENUM('pending', 'exchanging', 'completed', 'consumed', 'failed');--> statement-breakpoint
CREATE TABLE "oidc_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_login_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"secrets_ciphertext" text,
	"redirect_uri" text NOT NULL,
	"status" "oidc_login_status" DEFAULT 'pending' NOT NULL,
	"issuer" text,
	"subject" text,
	"email" text,
	"display_name" text,
	"avatar_url" text,
	"exchange_code_hash" text,
	"error_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
DROP TABLE "auth_challenges" CASCADE;--> statement-breakpoint
DROP TABLE "institutional_identities" CASCADE;--> statement-breakpoint
DROP TABLE "registration_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "oidc_identities" ADD CONSTRAINT "oidc_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_identities_subject_unique" ON "oidc_identities" USING btree ("issuer","subject");--> statement-breakpoint
CREATE INDEX "oidc_identities_user_idx" ON "oidc_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_login_transactions_state_hash_unique" ON "oidc_login_transactions" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_login_transactions_exchange_code_unique" ON "oidc_login_transactions" USING btree ("exchange_code_hash") WHERE "oidc_login_transactions"."exchange_code_hash" is not null;--> statement-breakpoint
CREATE INDEX "oidc_login_transactions_expiry_idx" ON "oidc_login_transactions" USING btree ("expires_at");--> statement-breakpoint
DROP TYPE "public"."auth_challenge_status";