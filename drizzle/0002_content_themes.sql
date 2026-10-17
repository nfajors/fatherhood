CREATE TYPE "public"."theme_assignment_source" AS ENUM('ai', 'admin');--> statement-breakpoint
CREATE TYPE "public"."theme_assignment_status" AS ENUM('active', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."theme_origin" AS ENUM('book', 'ai', 'admin');--> statement-breakpoint
CREATE TYPE "public"."theme_status" AS ENUM('proposed', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "theme_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"theme_id" uuid NOT NULL,
	"video_id" uuid,
	"course_id" uuid,
	"source" "theme_assignment_source" NOT NULL,
	"status" "theme_assignment_status" DEFAULT 'active' NOT NULL,
	"confidence" smallint,
	"rationale" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_assignments_one_target" CHECK (num_nonnulls("theme_assignments"."video_id", "theme_assignments"."course_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"status" "theme_status" NOT NULL,
	"origin" "theme_origin" NOT NULL,
	"book_reference" text,
	"proposal_rationale" text,
	"merged_into_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "themes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "themed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "themed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "theme_assignments" ADD CONSTRAINT "theme_assignments_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_assignments" ADD CONSTRAINT "theme_assignments_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_assignments" ADD CONSTRAINT "theme_assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_merged_into_id_themes_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "theme_assignments_theme_video_idx" ON "theme_assignments" USING btree ("theme_id","video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "theme_assignments_theme_course_idx" ON "theme_assignments" USING btree ("theme_id","course_id");--> statement-breakpoint
CREATE INDEX "theme_assignments_video_id_idx" ON "theme_assignments" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "theme_assignments_course_id_idx" ON "theme_assignments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "themes_status_idx" ON "themes" USING btree ("status");