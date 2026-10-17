ALTER TYPE "public"."video_review_action" ADD VALUE 'resubmit';--> statement-breakpoint
ALTER TABLE "creator_applications" ADD COLUMN "decision_notes" text;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_applications_pending_idx" ON "creator_applications" USING btree ("user_id") WHERE "creator_applications"."status" = 'pending';