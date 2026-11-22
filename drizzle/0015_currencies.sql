ALTER TABLE "gifts" ADD COLUMN "currency" text DEFAULT 'usd' NOT NULL;--> statement-breakpoint
ALTER TABLE "revenue_ledger" ADD COLUMN "currency" text DEFAULT 'usd' NOT NULL;--> statement-breakpoint
ALTER TABLE "revenue_ledger" ADD COLUMN "original_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "currency" text DEFAULT 'usd' NOT NULL;