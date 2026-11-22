CREATE TABLE "offline_licenses" (
	"user_id" text NOT NULL,
	"video_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_licenses_user_id_video_id_pk" PRIMARY KEY("user_id","video_id")
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "download_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "offline_licenses" ADD CONSTRAINT "offline_licenses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_licenses" ADD CONSTRAINT "offline_licenses_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offline_licenses_video_id_idx" ON "offline_licenses" USING btree ("video_id");