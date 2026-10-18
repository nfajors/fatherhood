CREATE TABLE "payout_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_account_id" text NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"requirements_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disabled_reason" text,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD COLUMN "attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD COLUMN "setup_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_payouts_status_idx" ON "creator_payouts" USING btree ("status");