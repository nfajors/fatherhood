-- array_to_string is only STABLE, so generated columns can't call it. Joining text[] is
-- deterministic, so this wrapper is safely IMMUTABLE.
CREATE OR REPLACE FUNCTION fs_text_array(value text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT array_to_string(value, ' ') $$;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(subtitle, '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(book_chapter, '')), 'C')) STORED;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(summary, '')), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "review_hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "review_hidden_by_id" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(fs_text_array(tags), '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(transcript, '')), 'C')) STORED;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_review_hidden_by_id_user_id_fk" FOREIGN KEY ("review_hidden_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courses_search_idx" ON "courses" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "lessons_search_idx" ON "lessons" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "ratings_video_created_idx" ON "ratings" USING btree ("video_id","created_at");--> statement-breakpoint
CREATE INDEX "videos_search_idx" ON "videos" USING gin ("search_vector");