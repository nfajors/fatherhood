CREATE TABLE "creator_payout_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_account_id" text NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"transfers_active" boolean DEFAULT false NOT NULL,
	"requirements_due" text[] DEFAULT '{}'::text[] NOT NULL,
	"disabled_reason" text,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_payout_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD COLUMN "attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD COLUMN "setup_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD COLUMN "marked_paid_by_id" text;--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD COLUMN "manual_note" text;--> statement-breakpoint
ALTER TABLE "creator_payout_accounts" ADD CONSTRAINT "creator_payout_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD CONSTRAINT "creator_payouts_marked_paid_by_id_user_id_fk" FOREIGN KEY ("marked_paid_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_payouts_status_idx" ON "creator_payouts" USING btree ("status");