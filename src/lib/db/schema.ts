/**
 * Database schema (Drizzle ORM, PostgreSQL).
 *
 * The first four tables follow Better Auth's core schema; everything after them
 * implements the data models in docs/development-plan.md section 5.2.
 * Money is always stored as integer cents.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Auth (Better Auth)
// ---------------------------------------------------------------------------

/**
 * Account roles. Paid access is not a role: it is derived from `subscriptions`
 * (see lib/entitlements.ts), so a lapsed member never keeps stale privileges.
 */
export const userRole = pgEnum("user_role", ["user", "creator", "admin"]);
export type UserRole = (typeof userRole.enumValues)[number];

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRole("role").notNull().default("user"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export const subscriptionPlan = pgEnum("subscription_plan", ["monthly", "annual", "gift"]);

/** Mirrors Stripe's subscription statuses; gift access uses "active". */
export const subscriptionStatus = pgEnum("subscription_status", [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);
export type SubscriptionStatus = (typeof subscriptionStatus.enumValues)[number];

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    plan: subscriptionPlan("plan").notNull(),
    status: subscriptionStatus("status").notNull(),
    /** Null for gift-based access, which has no Stripe subscription. */
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripeCustomerId: text("stripe_customer_id"),
    stripePriceId: text("stripe_price_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("subscriptions_user_id_idx").on(t.userId)],
);

export const giftStatus = pgEnum("gift_status", ["pending_payment", "paid", "redeemed", "refunded"]);

export const gifts = pgTable(
  "gifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    plan: subscriptionPlan("plan").notNull(),
    status: giftStatus("status").notNull().default("pending_payment"),
    amountCents: integer("amount_cents").notNull(),
    purchaserUserId: text("purchaser_user_id").references(() => user.id, { onDelete: "set null" }),
    purchaserEmail: text("purchaser_email").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    message: text("message"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    redeemedByUserId: text("redeemed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    deliverAt: timestamp("deliver_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("gifts_purchaser_user_id_idx").on(t.purchaserUserId)],
);

/** Stripe and Cloudflare event ids already handled, so webhook retries are no-ops. */
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const videoType = pgEnum("video_type", ["professional", "community"]);
export type VideoType = (typeof videoType.enumValues)[number];

/**
 * Lifecycle: uploading -> processing -> pending_review -> approved (published).
 * Review can also end in rejected or changes_requested; approved videos can be
 * unpublished after a report. failed means Stream could not encode the file.
 */
export const videoStatus = pgEnum("video_status", [
  "uploading",
  "processing",
  "pending_review",
  "approved",
  "rejected",
  "changes_requested",
  "unpublished",
  "failed",
]);
export type VideoStatus = (typeof videoStatus.enumValues)[number];

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: videoType("type").notNull(),
    status: videoStatus("status").notNull().default("uploading"),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    transcript: text("transcript"),
    cloudflareUid: text("cloudflare_uid").unique(),
    durationSeconds: integer("duration_seconds"),
    thumbnailUrl: text("thumbnail_url"),
    watermarkApplied: boolean("watermark_applied").notNull().default(false),
    requireSignedUrls: boolean("require_signed_urls").notNull(),
    /** AI pre-screen output (moderation categories, relevance score, notes). */
    moderation: jsonb("moderation"),
    ratingAverage: numeric("rating_average", { precision: 3, scale: 2 }),
    ratingCount: integer("rating_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("videos_creator_id_idx").on(t.creatorId),
    index("videos_type_status_idx").on(t.type, t.status),
  ],
);

export const videoReviewAction = pgEnum("video_review_action", [
  "ai_screen",
  "approve",
  "reject",
  "request_changes",
  "unpublish",
]);

/** Audit trail of every moderation decision; reviewerId is null for the AI pre-screen. */
export const videoReviews = pgTable(
  "video_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    reviewerId: text("reviewer_id").references(() => user.id, { onDelete: "set null" }),
    action: videoReviewAction("action").notNull(),
    fromStatus: videoStatus("from_status"),
    toStatus: videoStatus("to_status").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("video_reviews_video_id_idx").on(t.videoId)],
);

export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  description: text("description"),
  instructorId: text("instructor_id").references(() => user.id, { onDelete: "set null" }),
  category: text("category"),
  coverImageUrl: text("cover_image_url"),
  /** Courses that expand on a chapter of the book. */
  bookChapter: text("book_chapter"),
  published: boolean("published").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const courseModules = pgTable(
  "course_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("course_modules_course_position_idx").on(t.courseId, t.position)],
);

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => courseModules.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    summary: text("summary"),
    position: integer("position").notNull(),
    /** Free preview lessons are watchable without a membership. */
    isPreview: boolean("is_preview").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("lessons_module_position_idx").on(t.moduleId, t.position),
    index("lessons_video_id_idx").on(t.videoId),
  ],
);

export const resourceKind = pgEnum("resource_kind", ["pdf", "workbook", "insight_card", "other"]);

/** Downloadable lesson materials stored in Cloudflare R2. */
export const lessonResources = pgTable(
  "lesson_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: resourceKind("kind").notNull(),
    r2Key: text("r2_key").notNull(),
    ...timestamps,
  },
  (t) => [index("lesson_resources_lesson_id_idx").on(t.lessonId)],
);

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stars: smallint("stars").notNull(),
    review: text("review"),
    helpfulCount: integer("helpful_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("ratings_video_user_idx").on(t.videoId, t.userId),
    check("ratings_stars_range", sql`${t.stars} between 1 and 5`),
  ],
);

export const reviewHelpfulVotes = pgTable(
  "review_helpful_votes",
  {
    ratingId: uuid("rating_id")
      .notNull()
      .references(() => ratings.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ratingId, t.userId] })],
);

/** Resume position and completion, one row per user per video. */
export const watchProgress = pgTable(
  "watch_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    positionSeconds: integer("position_seconds").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.videoId] }), index("watch_progress_video_id_idx").on(t.videoId)],
);

/**
 * One row per playback session, updated by player heartbeats. This is the
 * source for view counts, watch time and the creator revenue share.
 */
export const watchSessions = pgTable(
  "watch_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    /** Null for anonymous viewers of free Community videos. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    secondsWatched: integer("seconds_watched").notNull().default(0),
    maxPositionSeconds: integer("max_position_seconds").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("watch_sessions_video_started_idx").on(t.videoId, t.startedAt),
    index("watch_sessions_user_id_idx").on(t.userId),
  ],
);

export const commentStatus = pgEnum("comment_status", ["visible", "hidden", "removed"]);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    status: commentStatus("status").notNull().default("visible"),
    ...timestamps,
  },
  (t) => [index("comments_video_id_idx").on(t.videoId), index("comments_parent_id_idx").on(t.parentId)],
);

export const reportStatus = pgEnum("report_status", ["open", "actioned", "dismissed"]);

/** User reports on published content (plan section 3.4, post-publish). */
export const contentReports = pgTable(
  "content_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    status: reportStatus("status").notNull().default("open"),
    resolvedById: text("resolved_by_id").references(() => user.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("content_reports_status_idx").on(t.status)],
);

// ---------------------------------------------------------------------------
// Creators
// ---------------------------------------------------------------------------

export const applicationStatus = pgEnum("application_status", ["pending", "approved", "rejected"]);

/** Applications for Fellow (creator) upload privileges. */
export const creatorApplications = pgTable(
  "creator_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    sampleUrl: text("sample_url"),
    status: applicationStatus("status").notNull().default("pending"),
    reviewedById: text("reviewed_by_id").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("creator_applications_user_id_idx").on(t.userId)],
);

export const payoutStatus = pgEnum("payout_status", ["pending", "processing", "paid", "failed"]);

export const creatorPayouts = pgTable(
  "creator_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: payoutStatus("status").notNull().default("pending"),
    stripeTransferId: text("stripe_transfer_id").unique(),
    failureReason: text("failure_reason"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("creator_payouts_creator_id_idx").on(t.creatorId)],
);
