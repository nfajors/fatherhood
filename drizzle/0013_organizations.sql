CREATE TYPE "public"."contract_status" AS ENUM('draft', 'invoiced', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."organization_kind" AS ENUM('nonprofit', 'employer', 'university', 'military', 'government', 'faith', 'healthcare', 'other');--> statement-breakpoint
CREATE TYPE "public"."organization_member_status" AS ENUM('invited', 'active', 'removed');--> statement-breakpoint
ALTER TYPE "public"."revenue_kind" ADD VALUE 'organization';--> statement-breakpoint
ALTER TYPE "public"."subscription_plan" ADD VALUE 'organization';--> statement-breakpoint
CREATE TABLE "organization_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"seats" integer NOT NULL,
	"price_per_seat_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"days_until_due" smallint DEFAULT 30 NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"stripe_invoice_id" text,
	"invoice_url" text,
	"invoiced_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"payment_note" text,
	"voided_at" timestamp with time zone,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_contracts_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id"),
	CONSTRAINT "organization_contracts_dates" CHECK ("organization_contracts"."ends_at" > "organization_contracts"."starts_at"),
	CONSTRAINT "organization_contracts_seats" CHECK ("organization_contracts"."seats" > 0)
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"is_manager" boolean DEFAULT false NOT NULL,
	"status" "organization_member_status" DEFAULT 'invited' NOT NULL,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"invited_by_id" text,
	"joined_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"share_progress" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_invite_token_hash_unique" UNIQUE("invite_token_hash")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "organization_kind" NOT NULL,
	"contact_name" text,
	"contact_email" text NOT NULL,
	"stripe_customer_id" text,
	"join_code" text,
	"join_code_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "organizations_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "organization_member_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_contracts" ADD CONSTRAINT "organization_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_contracts" ADD CONSTRAINT "organization_contracts_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_contracts_org_idx" ON "organization_contracts" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_email_idx" ON "organization_members" USING btree ("organization_id","email","is_manager") WHERE "organization_members"."status" <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("organization_id","user_id","is_manager") WHERE "organization_members"."status" <> 'removed' and "organization_members"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "organization_members_user_id_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_member_id_organization_members_id_fk" FOREIGN KEY ("organization_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_member_id_unique" UNIQUE("organization_member_id");