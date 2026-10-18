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
| `npm run gifts:deliver` | Send scheduled gift emails that are due, and retry failed sends |
| `npm run revenue:settle -- YYYY-MM` | Settle the creator revenue pool for a month (default: last month) |

Environment variables are validated per integration when first used
(`src/lib/env.ts`), so the app builds and tests run without secrets.

## Services

**Anthropic (AI themes).** Set `ANTHROPIC_API_KEY` to turn on the theme classifier.
Without it the site works normally and content waits, unthemed, for an admin.

**Email (Resend).** Set `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain verified in
Resend). Without a key, emails are printed to the server log instead of sent.

**Scheduled jobs.** Set `CRON_SECRET`. On Vercel, `vercel.json` runs `/api/cron/gift-delivery`
hourly and `/api/cron/moderation` every 10 minutes (sub-daily crons need a paid Vercel plan). On
other hosts, call both with `Authorization: Bearer $CRON_SECRET` on the same schedule.

**Postgres.** Any Postgres 15+ (Neon or Supabase in production). Set `DATABASE_URL`.

**Better Auth.** Set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `BETTER_AUTH_URL`.
Google sign-in turns on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
Roles are `user`, `creator` (Fellow) and `admin`; they cannot be set at sign-up.
Paid access is not a role: it is derived from the `subscriptions` table.

**Stripe.**
1. Create a product with two recurring prices ($19/month, $199/year) and set
   `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL`.
2. Add a webhook endpoint at `/api/stripe/webhook` for `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `customer.subscription.*`, `invoice.paid`
   and `charge.refunded`, then set `STRIPE_WEBHOOK_SECRET`.
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
    api/studio/videos/...   creator uploads (resumable, straight to Cloudflare), edits, resubmission
    api/fellows/apply       apply for Fellow (upload) access
    api/videos/[id]/rating  rate a video, with an optional review
    api/reviews/[id]/helpful  mark a review helpful
    api/resources/[id]/download  access check, then a short-lived R2 link
    api/videos/[id]/playback  entitlement check, signed URL for paid content
    api/videos/[id]/progress  player heartbeats (views, resume) and "mark complete"
    academy/                course catalog, course pages, lesson player
    community/              Community Voices library and video pages
    learning/               My Learning: continue watching, courses in progress
    admin/courses/          course builder
    admin/creators/         Fellow applications and access
    studio/                 creator Studio: dashboard, upload, video pages, earnings
    fellows/                about Fellows, and the application form
    search/                 site search
    admin/reviews/          review moderation
    api/stream/webhook      encoding finished -> review queue (or failed / too long)
  lib/
    config.ts               prices, limits, categories
    entitlements.ts         who may watch / upload (pure, unit-tested)
    stream.ts               Cloudflare Stream client, token signing, webhook verification
    stripe.ts               Stripe client and subscription mapping
    courses/                catalog queries and the course builder
    creators/               Fellow applications, creator uploads, Studio dashboard and earnings
    ratings/                ratings, reviews, helpful votes, review moderation
    search/                 full-text search
    storage/r2.ts           Cloudflare R2: presigned uploads and downloads
    playback/               who may play what, watch sessions and progress
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

## Academy and player

- **Catalog.** `/academy` lists published courses (filter by category) with lesson count,
  length and, for signed-in viewers, progress. A course page shows the outline: free preview
  lessons are marked, the rest are locked for visitors, and members get Start or Continue.
- **Lesson page.** The Cloudflare Stream player (captions, speed, picture-in-picture) with the
  outline beside it, previous/next, "Mark as complete" and "Up next". Visitors on a paid lesson
  see the membership offer instead. Paid lessons always play through a signed token (4 hours).
  A lesson is a free preview only while its course is published.
- **Community Voices.** `/community` lists approved Community videos (free to everyone), by
  theme; each video page has its themes, related videos and a report button.
- **My Learning.** `/learning`: continue watching (with resume position) and courses in progress.
- **Watch tracking** (`src/lib/playback/`). The player sends a heartbeat every 15 seconds while
  playing, on pause and end, and by `sendBeacon` when the tab is hidden. The server credits at
  most the real time elapsed since the last heartbeat (plus 5 seconds), so a tampered client
  can't inflate views. A view counts once per session at 30 seconds, the same threshold the
  revenue pool uses. A lesson completes at 90% or within the last 30 seconds, or by hand.
- **Course builder.** `/admin/courses`: create a draft, add modules and lessons, attach approved
  professional videos, mark previews, reorder, and publish. Publishing requires every lesson
  to have an approved professional video, and classifies the course into themes.

## Fellows and the Studio

- **Becoming a Fellow.** `/fellows` explains the program and takes applications (one open
  application per person). Admins approve or decline at `/admin/creators`, with an optional
  note emailed to the applicant, or grant access by email to an existing account (founding
  Fellows). Access can be removed; published videos stay up.
- **Uploading** (`/studio/upload`). The browser checks the file first (type, size, and the
  8-minute Community limit, when it can read the length), then uploads it resumably (tus,
  50 MB chunks) straight to Cloudflare; our server only starts the upload, with the length
  cap, signed-URL and watermark settings it sets itself. A stopped upload resumes when the
  same file is chosen again. Once the file is in, the video shows as processing until
  Stream's webhook puts it in the review queue.
- **Review status.** Each video page shows its status, the reviewer's notes and the history.
  Details can be edited until the video is published. After a change request the creator
  resubmits (with a note to the reviewer) or uploads a new version, which replaces the old
  file and is screened again. A resubmission is never auto-approved: a person checks it.
  Unpublished videos can be deleted.
- **Dashboard** (`/studio`). Published videos, views and watch time (all time and last 30
  days), rating, a 30-day views chart, and what needs attention.
- **Earnings** (`/studio/earnings`). This month's estimate, computed exactly as settlement
  will, with the two pool requirements as a checklist and views by video; past months with
  per-video breakdowns; payouts and balances. Creators see only their own figures, never the
  pool or anyone else's share.
- **Own views don't count.** A creator watching their own video keeps their place but earns
  no views or pool share.

## Lesson downloads

Workbooks, PDFs and insight cards attached to lessons, stored in a private Cloudflare R2 bucket
(`src/lib/courses/resources.ts`, `src/lib/storage/r2.ts`).

- **Adding files.** In the course builder, each lesson has "+ Add download": title, kind
  (workbook, PDF, insight card, other) and the file (PDF, Word, Excel, PowerPoint, PNG or JPEG,
  up to 50 MB). The browser uploads it straight to R2 with a presigned URL bound to the file's
  type; the server records it only after R2 confirms it arrived, taking the size from R2.
  Files can be renamed, reordered and deleted (deleting removes the R2 object too).
- **Downloading.** Whoever may watch the lesson may download its files: members, everyone on a
  free preview lesson, and admins. Each download is an access check and then a redirect to an R2
  link that expires in 5 minutes and saves the file under its original name. Visitors on a paid
  lesson see "For members"; following a download link signs them in first.
- **Setup.** Create a private R2 bucket and an R2 API token with Object Read & Write on it
  (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). Admins' browsers upload directly,
  so add this CORS rule to the bucket (with your site's origin):

  ```json
  [{ "AllowedOrigins": ["https://fatherhood.school"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
  ```

## Ratings and reviews

- **Who can rate.** Signed-in viewers who have watched at least 30 seconds of a video (or
  marked it complete), on Community videos and Academy lessons. Creators can't rate their own.
  One rating per person per video, editable and removable; the written review is optional.
- **Aggregates.** Each video's average and count are recomputed in the same transaction as
  every change. Course ratings combine their lessons' ratings. Ratings show on cards, video
  and lesson pages and course pages, with a 1-5 star breakdown.
- **Reviews.** Listed by most helpful or newest, signed with first name and last initial.
  Anyone signed in can mark a review helpful (not their own).
- **Top rated** sorting (Community Voices and search) uses a Bayesian average (as if every
  video started with five 4-star ratings), so one 5-star rating doesn't outrank many 4.8s;
  rated videos come before unrated ones.
- **Moderation.** `/admin/reviews` lists recent reviews; hiding one removes its text from the
  site while its stars still count. Editing doesn't bring a hidden review back.

## Search

`/search` (the magnifier in the header) uses Postgres full-text search. Each video, course and
lesson has a generated, GIN-indexed search document (migration 0006): titles weigh most, then
descriptions, tags and lesson summaries, then transcripts and book chapters. English stemming
means "apologizing" finds "apology".

- Finds published courses (directly or through a matching lesson), lessons in published
  courses (including by transcript), approved Community videos, and themes.
- Supports "quoted phrases", *or*, and -exclusions. When a plain query finds nothing it retries
  each word as a prefix, so partly typed words still find something.
- Highlighted snippets show where the words matched. Tabs by type, a category filter, sorting
  (best match, newest, top rated, most viewed) and paging.
- Snippets can quote a few words of a members-only lesson's transcript; the lesson itself
  stays behind the paywall.

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

## Moderation

`/admin/moderation` is the review queue; `src/lib/moderation/` holds the rules (`policy.ts`).

- **AI pre-screen.** When a video finishes processing, Stream is asked for captions. Once the
  transcript is ready (or after 30 minutes), Claude reads the title, description and transcript
  and looks at 4 frames. It rates each policy area from the plan, scores relevance to fatherhood,
  and recommends approve, review or reject. If the AI declines to assess a video, that is
  treated as high risk.
- **Auto-approval is narrow.** Only a Community video that is low risk in every area, at least
  80 relevant, has a transcript, and comes from a creator a person has approved before. Everything
  else goes to the queue. The AI never rejects on its own.
- **Queue.** Ordered by risk, then deadline: Community videos are due within 48 hours, professional
  within 120. Reviewers approve, request changes or reject (a reason is required and goes to the
  creator), and can later unpublish or restore. Every decision is logged and emailed to the creator.
- **Reports.** Signed-in viewers can report a published video (`POST /api/videos/{id}/report`). At
  3 different reporters the video is hidden until an admin decides; admins then dismiss the reports
  or mark them actioned.

## Gift memberships

`/gift` sells 1 year ($199) or 1 month ($19) as a gift; `/redeem` redeems it. Code in
`src/lib/gifts/`.

- **Buying** needs no account. The buyer picks how the code reaches the recipient: emailed
  now, emailed at 8 a.m. (buyer's time) on a chosen date, or handed over in person. Payment
  is a one-time Stripe Checkout. The buyer gets a confirmation with the code either way.
- **Codes** look like `FATHER-ABCD-2345`, avoid look-alike characters, and accept any
  spacing or case. They don't expire.
- **Payment** is confirmed by the Stripe webhook, or by the thank-you page if it arrives
  first; whichever is first sends the emails, exactly once. Gift revenue goes into the
  creator-pool ledger like subscription revenue.
- **Redeeming** needs an account. Without a paid subscription, a gift membership period starts
  (after any time the member already has, so gifts stack). An auto-renewing subscriber gets
  the gift's value as Stripe billing credit instead, which pays their next renewals.
- **Refunds:** a full refund in Stripe voids the gift: an unused code stops working, gift
  membership time ends, or billing credit is reversed.

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
pages, creator revenue-share settlement, AI themes, gift memberships, moderation queue,
course catalog, course builder, video player with watch tracking and progress, Community
Voices library, My Learning, Fellow applications, creator Studio (uploads, review status and
resubmission, dashboard, earnings), ratings and reviews, search, lesson downloads.

Phase 1 is feature-complete. Before launch: configure the production services (Stripe,
Cloudflare Stream and R2, Resend, Anthropic), run one real upload and download of each kind
in staging, and write the terms (including content licensing for uploads).
