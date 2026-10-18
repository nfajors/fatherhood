DROP INDEX "lesson_resources_lesson_id_idx";--> statement-breakpoint
ALTER TABLE "lesson_resources" ADD COLUMN "file_name" text DEFAULT 'download' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_resources" ADD COLUMN "content_type" text DEFAULT 'application/octet-stream' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_resources" ADD COLUMN "size_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_resources" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "lesson_resources_lesson_id_idx" ON "lesson_resources" USING btree ("lesson_id","position");--> statement-breakpoint
ALTER TABLE "lesson_resources" ADD CONSTRAINT "lesson_resources_r2_key_unique" UNIQUE("r2_key");