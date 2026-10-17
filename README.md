# Fatherhood.School

Subscription video academy for fathers and men considering fatherhood, launching
with the book *Fatherhood in Focus*. The full product spec is
[docs/development-plan.md](docs/development-plan.md).

- **Professional Academy** (paid): structured courses, $19/month or $199/year.
- **Community Voices** (free): short videos (8 minutes max) from approved fathers ("Fellows").

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS 4 · Better Auth · PostgreSQL + Drizzle ORM ·
Stripe Billing · Cloudflare Stream · Vitest

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values; see "Services" below
npm run db:migrate           # apply drizzle/ migrations to DATABASE_URL
npm run dev                  # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm test` / `test:coverage` | Unit tests (Vitest); set `TEST_DATABASE_URL` to a disposable database to also run the Postgres integration tests |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm run db:generate` | Generate a migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run themes:seed` | Add or update the starting themes from the book (never overwrites admin edits) |
| `npm run themes:assign` | Run the AI theme classifier on content not yet classified (`--all` to redo everything) |
| `npm run revenue:settle -- YYYY-MM` | Settle the creator revenue pool for a month (default: last month) |

Environment variables are validated per integration when first used
(`src/lib/env.ts`), so the app builds and tests run without secrets.

## Services

**Anthropic (AI themes).** Set `ANTHROPIC_API_KEY` to turn on the theme classifier.
Without it the site works normally and content waits, unthemed, for an admin.

**Postgres.** Any Postgres 15+ (Neon or Supabase in production). Set `DATABASE_URL`.

**Better Auth.** Set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `BETTER_AUTH_URL`.
Google sign-in turns on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
Roles are `user`, `creator` (Fellow) and `admin`; they cannot be set at sign-up.
Paid access is not a role: it is derived from the `subscriptions` table.

**Stripe.**
1. Create a product with two recurring prices ($19/month, $199/year) and set
   `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL`.
2. Add a webhook endpoint at `/api/stripe/webhook` for `checkout.session.completed`,
   `customer.subscription.*` and `invoice.paid`, then set `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
3. Turn on the customer portal (members manage billing from `/account`).

**Cloudflare Stream.**
1. Create an API token with *Stream: Edit* and set `CLOUDFLARE_ACCOUNT_ID`,
   `CLOUDFLARE_STREAM_API_TOKEN` and `CLOUDFLARE_STREAM_CUSTOMER_CODE`.
2. Create a signing key (`POST /accounts/{id}/stream/keys`) and set
   `CLOUDFLARE_STREAM_SIGNING_KEY_ID` (the `id`) and `CLOUDFLARE_STREAM_SIGNING_KEY_JWK` (the `jwk`).
3. Register the webhook (`PUT /accounts/{id}/stream/webhook` with
   `notificationUrl=https://<host>/api/stream/webhook`) and set
   `CLOUDFLARE_STREAM_WEBHOOK_SECRET` to the returned secret.
4. Optional: create a watermark profile from the logo PNG
   (`StreamClient.createWatermarkProfile`) and set `CLOUDFLARE_STREAM_WATERMARK_UID`;
   it is then burned into every upload.

## How it fits together

```
src/
  app/                      pages and API routes
    api/auth/[...all]       Better Auth
    api/stripe/checkout     start a membership (Stripe Checkout)
    api/stripe/portal       Stripe customer portal
    api/stripe/webhook      sync subscriptions (idempotent)
    api/videos/upload-url   one-time Cloudflare upload URL (Fellows: Community; admins: anything)
    api/videos/[id]/playback  entitlement check, signed URL for paid content
    api/stream/webhook      encoding finished -> review queue (or failed / too long)
  lib/
    config.ts               prices, limits, categories
    entitlements.ts         who may watch / upload (pure, unit-tested)
    stream.ts               Cloudflare Stream client, token signing, webhook verification
    stripe.ts               Stripe client and subscription mapping
    db/schema.ts            all tables (plan section 5.2)
drizzle/                    SQL migrations
```

**Video lifecycle:** `uploading` → `processing` → `pending_review` → `approved`,
or `rejected` / `changes_requested` / `failed`; approved videos can later be
`unpublished`. Every transition is logged in `video_reviews`.

**Access rules** (`src/lib/entitlements.ts`): approved Community videos are free to
everyone; approved Professional videos need an active membership (or a preview
lesson) and always play through a short-lived signed token; unapproved videos are
visible only to their creator and admins.

## Themes

Themes organize every video and course by topic (for example "Choosing a Partner"),
on `/themes` for members and `/admin/themes` for admins.

- **Starting themes** come from `src/lib/themes/seed.ts` (`npm run themes:seed`): 13 themes
  drawn from the *Fatherhood in Focus* draft (revised July 2026), each citing its chapters.
  Re-running the seed adds new themes and updates unedited ones, never admin edits.
- **AI placement** (`src/lib/themes/classifier.ts`, Claude with structured output): each
  video is classified when it finishes processing, before review. It goes into up to 3
  themes, each with a confidence and a one-line reason. Placements under 55% are dropped.
- **AI themes**: when nothing fits at 75% or better, the AI may propose a new theme. Proposals
  stay private until an admin approves, merges or archives them. The AI reuses pending
  proposals rather than creating duplicates.
- **Admin decisions win**: an admin can place content, remove it (the AI won't put it
  back), edit theme names and descriptions (the AI reads the descriptions), merge themes
  (the AI follows the merge) and archive them.

Tuning lives in `src/lib/themes/policy.ts`.

## Creator revenue share

Same model as Winning Careers (details in plan section 3.5, constants in
`src/lib/revenue/policy.ts`):

- 25% of each month's paid subscription revenue funds the creator pool.
- Eligible creators posted at least 1 approved video this quarter and have a video with
  10+ views this month (a view = 30+ seconds watched).
- Score = 50% videos posted (5 pts each, max 100) + 50% views (1 pt per 10, max 100);
  the pool is split in proportion to score.
- Balances of $20+ become pending payouts; smaller balances carry forward.

Run `npm run revenue:settle` monthly (e.g. on the 1st). Re-running a settled month
returns the stored result; `--force` recalculates it unless it has already been paid out.

## Code reused from Winning

The Stream client, review-history model, entitlement approach and revenue-pool
policy were ported from `winning-backend-staging` (Python) to TypeScript. Two
Stream parts were corrected on the way, because the original does not match Cloudflare's API: playback tokens are
RS256 JWTs signed with a Stream signing key, and watermarks are applied by profile
at upload time.

## Status

Done: project scaffold, schema and migrations, auth, membership checkout and
billing portal, Stripe sync, Stream uploads and playback, entitlements, marketing
pages, creator revenue-share settlement, AI themes.

Next (Phase 1): admin moderation queue and AI pre-screen, course catalog and player
UI, creator upload UI and dashboard (including earnings), ratings and progress
tracking, gift memberships, search.
