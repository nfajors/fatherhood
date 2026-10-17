CREATE TYPE "public"."gift_delivery" AS ENUM('email', 'self');--> statement-breakpoint
CREATE TYPE "public"."gift_redemption" AS ENUM('access', 'billing_credit');--> statement-breakpoint
ALTER TABLE "gifts" ALTER COLUMN "recipient_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ALTER COLUMN "recipient_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "purchaser_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "delivery" "gift_delivery" NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "redemption" "gift_redemption";--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "stripe_balance_transaction_id" text;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gifts_delivery_due_idx" ON "gifts" USING btree ("status","delivered_at");--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id");--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_email_delivery_has_recipient" CHECK ("gifts"."delivery" <> 'email' or "gifts"."recipient_email" is not null);