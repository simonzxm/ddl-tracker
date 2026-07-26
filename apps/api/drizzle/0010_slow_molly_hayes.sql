ALTER TYPE "public"."vote_direction" ADD VALUE 'none';--> statement-breakpoint
ALTER TABLE "accuracy_votes" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_vote_totals" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "accuracy_votes" ADD CONSTRAINT "accuracy_votes_revision_positive" CHECK ("accuracy_votes"."revision" > 0);--> statement-breakpoint
ALTER TABLE "proposal_vote_totals" ADD CONSTRAINT "proposal_vote_totals_revision_positive" CHECK ("proposal_vote_totals"."revision" > 0);