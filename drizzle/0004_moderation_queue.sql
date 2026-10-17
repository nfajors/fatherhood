CREATE TYPE "public"."ai_recommendation" AS ENUM('approve', 'review', 'reject');--> statement-breakpoint
CREATE TYPE "public"."ai_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
ALTER TYPE "public"."video_review_action" ADD VALUE 'auto_approve' BEFORE 'approve';--> statement-breakpoint
ALTER TYPE "public"."video_review_action" ADD VALUE 'restore';--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "screened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "ai_recommendation" "ai_recommendation";--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "ai_risk" "ai_risk";--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "captions_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "review_due_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_open_per_reporter_idx" ON "content_reports" USING btree ("video_id","reporter_id") WHERE "content_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "videos_status_review_due_idx" ON "videos" USING btree ("status","review_due_at");