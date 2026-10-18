CREATE TYPE "public"."email_category" AS ENUM('learning', 'announcements', 'replies');--> statement-breakpoint
CREATE TYPE "public"."email_enrollment_status" AS ENUM('active', 'completed', 'exited');--> statement-breakpoint
CREATE TYPE "public"."email_send_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "email_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sequence" text NOT NULL,
	"status" "email_enrollment_status" DEFAULT 'active' NOT NULL,
	"step" smallint DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"exit_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"learning" boolean DEFAULT true NOT NULL,
	"announcements" boolean DEFAULT true NOT NULL,
	"replies" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"category" "email_category" NOT NULL,
	"sequence" text,
	"step" text,
	"subject" text NOT NULL,
	"status" "email_send_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_sends_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "email_enrollments" ADD CONSTRAINT "email_enrollments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_enrollments_user_sequence_idx" ON "email_enrollments" USING btree ("user_id","sequence");--> statement-breakpoint
CREATE INDEX "email_enrollments_due_idx" ON "email_enrollments" USING btree ("status","next_at");--> statement-breakpoint
CREATE INDEX "email_sends_user_created_idx" ON "email_sends" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "email_sends_sequence_idx" ON "email_sends" USING btree ("sequence","step","created_at");