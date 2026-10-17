CREATE TYPE "public"."pool_calculation_status" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."revenue_kind" AS ENUM('subscription_invoice', 'gift');--> statement-breakpoint
CREATE TABLE "pool_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "pool_calculation_status" DEFAULT 'processing' NOT NULL,
	"algorithm_version" text NOT NULL,
	"subscription_revenue_cents" integer NOT NULL,
	"pool_share_bps" integer NOT NULL,
	"pool_cents" integer NOT NULL,
	"eligible_creators" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calculation_id" uuid NOT NULL,
	"creator_id" text NOT NULL,
	"videos_posted_in_quarter" integer NOT NULL,
	"qualifying_views" integer NOT NULL,
	"engagement_score_milli" integer NOT NULL,
	"share_bps" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "revenue_kind" NOT NULL,
	"stripe_object_id" text NOT NULL,
	"user_id" text,
	"amount_cents" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_ledger_stripe_object_id_unique" UNIQUE("stripe_object_id")
);
--> statement-breakpoint
ALTER TABLE "pool_shares" ADD CONSTRAINT "pool_shares_calculation_id_pool_calculations_id_fk" FOREIGN KEY ("calculation_id") REFERENCES "public"."pool_calculations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_shares" ADD CONSTRAINT "pool_shares_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_shares" ADD CONSTRAINT "pool_shares_payout_id_creator_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."creator_payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_ledger" ADD CONSTRAINT "revenue_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pool_calculations_period_idx" ON "pool_calculations" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_shares_calculation_creator_idx" ON "pool_shares" USING btree ("calculation_id","creator_id");--> statement-breakpoint
CREATE INDEX "pool_shares_creator_payout_idx" ON "pool_shares" USING btree ("creator_id","payout_id");--> statement-breakpoint
CREATE INDEX "revenue_ledger_occurred_at_idx" ON "revenue_ledger" USING btree ("occurred_at");