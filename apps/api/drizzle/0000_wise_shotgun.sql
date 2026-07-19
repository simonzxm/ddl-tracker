CREATE TYPE "public"."auth_challenge_status" AS ENUM('pending', 'active', 'consumed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('maintainer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."term_status_override" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."catalog_import_status" AS ENUM('planned', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."comment_state" AS ENUM('visible', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."moderation_action_type" AS ENUM('hide', 'restore', 'suspend', 'unsuspend');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('inaccurate', 'spam', 'abuse', 'privacy', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('course_task', 'proposal', 'comment', 'user');--> statement-breakpoint
CREATE TYPE "public"."personal_task_state" AS ENUM('pending', 'completed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."course_task_state" AS ENUM('visible', 'hidden', 'merged');--> statement-breakpoint
CREATE TYPE "public"."proposal_state" AS ENUM('visible', 'hidden', 'redirected');--> statement-breakpoint
CREATE TYPE "public"."vote_direction" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."operation_receipt_status" AS ENUM('applied', 'rejected', 'dependency_failed');--> statement-breakpoint
CREATE TYPE "public"."sync_event_scope" AS ENUM('private_user', 'class_section_public', 'authenticated_global', 'maintainer_private');--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"normalized_subject" text NOT NULL,
	"subject_display" text NOT NULL,
	"code_hmac" text NOT NULL,
	"status" "auth_challenge_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"send_attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_challenges_attempts_nonnegative" CHECK ("auth_challenges"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "institutional_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"normalized_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_name" text,
	"device_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"username_key" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"bio" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"profile_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_profile_revision_positive" CHECK ("users"."profile_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "academic_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_term_code" text NOT NULL,
	"name" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"status_override" "term_status_override",
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_terms_date_order" CHECK ("academic_terms"."starts_on" is null or "academic_terms"."ends_on" is null or "academic_terms"."starts_on" <= "academic_terms"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "class_sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"external_section_id" text NOT NULL,
	"section_number" text NOT NULL,
	"instructors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"campus" text,
	"capacity" integer,
	"schedule_text" text,
	"raw_source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sections_capacity_nonnegative" CHECK ("class_sections"."capacity" is null or "class_sections"."capacity" >= 0),
	CONSTRAINT "class_sections_revision_positive" CHECK ("class_sections"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"term_id" uuid NOT NULL,
	"external_course_code" text NOT NULL,
	"name" text NOT NULL,
	"credits" numeric(5, 2),
	"department" text,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"checksum" text NOT NULL,
	"filename" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"diff" jsonb NOT NULL,
	"actor_id" uuid,
	"status" "catalog_import_status" DEFAULT 'planned' NOT NULL,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comment_revisions" (
	"comment_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_revisions_comment_id_revision_pk" PRIMARY KEY("comment_id","revision"),
	CONSTRAINT "comment_revisions_revision_positive" CHECK ("comment_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"state" "comment_state" DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_comments_current_revision_positive" CHECK ("task_comments"."current_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"reason" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" "moderation_action_type" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_merges" (
	"source_task_id" uuid PRIMARY KEY NOT NULL,
	"target_task_id" uuid NOT NULL,
	"maintainer_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_merges_not_self" CHECK ("task_merges"."source_task_id" <> "task_merges"."target_task_id")
);
--> statement-breakpoint
CREATE TABLE "followed_class_sections" (
	"user_id" uuid NOT NULL,
	"class_section_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followed_class_sections_user_id_class_section_id_pk" PRIMARY KEY("user_id","class_section_id")
);
--> statement-breakpoint
CREATE TABLE "personal_task_details" (
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"private_title" text,
	"private_deadline" timestamp with time zone,
	"private_note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_task_details_user_id_task_id_pk" PRIMARY KEY("user_id","task_id"),
	CONSTRAINT "personal_task_details_revision_positive" CHECK ("personal_task_details"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "personal_task_states" (
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"state" "personal_task_state" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_task_states_user_id_task_id_pk" PRIMARY KEY("user_id","task_id"),
	CONSTRAINT "personal_task_states_revision_positive" CHECK ("personal_task_states"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "personal_todos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"class_section_id" uuid,
	"title" text NOT NULL,
	"deadline" timestamp with time zone,
	"note" text,
	"state" "personal_task_state" DEFAULT 'pending' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "personal_todos_revision_positive" CHECK ("personal_todos"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "accuracy_votes" (
	"user_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"direction" "vote_direction" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accuracy_votes_user_id_proposal_id_pk" PRIMARY KEY("user_id","proposal_id")
);
--> statement-breakpoint
CREATE TABLE "course_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_section_id" uuid NOT NULL,
	"created_by" uuid,
	"state" "course_task_state" DEFAULT 'visible' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_tasks_revision_positive" CHECK ("course_tasks"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "proposal_redirects" (
	"source_proposal_id" uuid PRIMARY KEY NOT NULL,
	"canonical_proposal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_redirects_not_self" CHECK ("proposal_redirects"."source_proposal_id" <> "proposal_redirects"."canonical_proposal_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_vote_totals" (
	"proposal_id" uuid PRIMARY KEY NOT NULL,
	"up" integer DEFAULT 0 NOT NULL,
	"down" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_vote_totals_up_nonnegative" CHECK ("proposal_vote_totals"."up" >= 0),
	CONSTRAINT "proposal_vote_totals_down_nonnegative" CHECK ("proposal_vote_totals"."down" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid,
	"title" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"description" text,
	"evidence_note" text,
	"evidence_url" text,
	"content_fingerprint" text NOT NULL,
	"state" "proposal_state" DEFAULT 'visible' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_proposals_revision_positive" CHECK ("task_proposals"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "operation_receipts" (
	"user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"status" "operation_receipt_status" NOT NULL,
	"stable_result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operation_receipts_user_id_operation_id_pk" PRIMARY KEY("user_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"scope" "sync_event_scope" NOT NULL,
	"scope_user_id" uuid,
	"class_section_id" uuid,
	"type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_events_schema_version_positive" CHECK ("sync_events"."schema_version" > 0),
	CONSTRAINT "sync_events_scope_target_valid" CHECK ((
        ("sync_events"."scope" = 'private_user' and "sync_events"."scope_user_id" is not null and "sync_events"."class_section_id" is null)
        or ("sync_events"."scope" = 'class_section_public' and "sync_events"."scope_user_id" is null and "sync_events"."class_section_id" is not null)
        or ("sync_events"."scope" in ('authenticated_global', 'maintainer_private') and "sync_events"."scope_user_id" is null and "sync_events"."class_section_id" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "institutional_identities" ADD CONSTRAINT "institutional_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sections" ADD CONSTRAINT "class_sections_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_revisions" ADD CONSTRAINT "comment_revisions_comment_id_task_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."task_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_revisions" ADD CONSTRAINT "comment_revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_course_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."course_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_merges" ADD CONSTRAINT "task_merges_source_task_id_course_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."course_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_merges" ADD CONSTRAINT "task_merges_target_task_id_course_tasks_id_fk" FOREIGN KEY ("target_task_id") REFERENCES "public"."course_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_merges" ADD CONSTRAINT "task_merges_maintainer_id_users_id_fk" FOREIGN KEY ("maintainer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followed_class_sections" ADD CONSTRAINT "followed_class_sections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followed_class_sections" ADD CONSTRAINT "followed_class_sections_class_section_id_class_sections_id_fk" FOREIGN KEY ("class_section_id") REFERENCES "public"."class_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_task_details" ADD CONSTRAINT "personal_task_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_task_details" ADD CONSTRAINT "personal_task_details_task_id_course_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."course_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_task_states" ADD CONSTRAINT "personal_task_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_task_states" ADD CONSTRAINT "personal_task_states_task_id_course_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."course_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_todos" ADD CONSTRAINT "personal_todos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_todos" ADD CONSTRAINT "personal_todos_class_section_id_class_sections_id_fk" FOREIGN KEY ("class_section_id") REFERENCES "public"."class_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accuracy_votes" ADD CONSTRAINT "accuracy_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accuracy_votes" ADD CONSTRAINT "accuracy_votes_proposal_id_task_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."task_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tasks" ADD CONSTRAINT "course_tasks_class_section_id_class_sections_id_fk" FOREIGN KEY ("class_section_id") REFERENCES "public"."class_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tasks" ADD CONSTRAINT "course_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_redirects" ADD CONSTRAINT "proposal_redirects_source_proposal_id_task_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."task_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_redirects" ADD CONSTRAINT "proposal_redirects_canonical_proposal_id_task_proposals_id_fk" FOREIGN KEY ("canonical_proposal_id") REFERENCES "public"."task_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_vote_totals" ADD CONSTRAINT "proposal_vote_totals_proposal_id_task_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."task_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_proposals" ADD CONSTRAINT "task_proposals_task_id_course_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."course_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_proposals" ADD CONSTRAINT "task_proposals_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_scope_user_id_users_id_fk" FOREIGN KEY ("scope_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_class_section_id_class_sections_id_fk" FOREIGN KEY ("class_section_id") REFERENCES "public"."class_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_current_subject_unique" ON "auth_challenges" USING btree ("provider","normalized_subject") WHERE "auth_challenges"."status" in ('pending', 'active');--> statement-breakpoint
CREATE INDEX "auth_challenges_expiry_idx" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "institutional_identities_subject_unique" ON "institutional_identities" USING btree ("provider","normalized_subject");--> statement-breakpoint
CREATE INDEX "institutional_identities_user_idx" ON "institutional_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("idle_expires_at","absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key_unique" ON "users" USING btree ("username_key");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_terms_external_code_unique" ON "academic_terms" USING btree ("external_term_code");--> statement-breakpoint
CREATE UNIQUE INDEX "class_sections_external_id_unique" ON "class_sections" USING btree ("external_section_id");--> statement-breakpoint
CREATE INDEX "class_sections_course_idx" ON "class_sections" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_term_external_code_unique" ON "courses" USING btree ("term_id","external_course_code");--> statement-breakpoint
CREATE INDEX "courses_term_idx" ON "courses" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "catalog_imports_checksum_idx" ON "catalog_imports" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "catalog_imports_status_created_idx" ON "catalog_imports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "content_reports_status_created_idx" ON "content_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "content_reports_target_idx" ON "content_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_target_idx" ON "moderation_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_actor_idx" ON "moderation_actions" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "task_merges_target_idx" ON "task_merges" USING btree ("target_task_id");--> statement-breakpoint
CREATE INDEX "personal_todos_user_idx" ON "personal_todos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "personal_todos_class_section_idx" ON "personal_todos" USING btree ("class_section_id");--> statement-breakpoint
CREATE INDEX "course_tasks_class_section_idx" ON "course_tasks" USING btree ("class_section_id");--> statement-breakpoint
CREATE INDEX "proposal_redirects_canonical_idx" ON "proposal_redirects" USING btree ("canonical_proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_proposals_task_fingerprint_unique" ON "task_proposals" USING btree ("task_id","content_fingerprint");--> statement-breakpoint
CREATE INDEX "task_proposals_task_idx" ON "task_proposals" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "operation_receipts_expiry_idx" ON "operation_receipts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_events_event_id_unique" ON "sync_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "sync_events_scope_sequence_idx" ON "sync_events" USING btree ("scope","sequence");--> statement-breakpoint
CREATE INDEX "sync_events_user_sequence_idx" ON "sync_events" USING btree ("scope_user_id","sequence");--> statement-breakpoint
CREATE INDEX "sync_events_class_sequence_idx" ON "sync_events" USING btree ("class_section_id","sequence");