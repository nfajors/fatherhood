CREATE TYPE "public"."coach_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "coach_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "coach_message_role" NOT NULL,
	"content" text NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stage" text NOT NULL,
	"children" text,
	"goals" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_paths" (
	"user_id" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"steps" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coach_conversations" ADD CONSTRAINT "coach_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_conversation_id_coach_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."coach_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_profiles" ADD CONSTRAINT "coach_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_paths" ADD CONSTRAINT "learning_paths_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_conversations_user_updated_idx" ON "coach_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "coach_messages_conversation_idx" ON "coach_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "coach_messages_user_created_idx" ON "coach_messages" USING btree ("user_id","role","created_at");