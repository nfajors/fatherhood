/**
 * What the app's screens receive. Shapes are kept small and stable: the app in
 * people's pockets may be a few versions behind the server.
 *
 * Reader-app rules: nothing here carries prices or links to buy. The app only
 * says whether something is for members.
 */
import { listConversations } from "@/lib/coach/conversations";
import { getProfile } from "@/lib/coach/context";
import { getPath } from "@/lib/coach/path";
import { COACH_STAGES, CRISIS_RESOURCES } from "@/lib/coach/policy";
import {
  communityThemes,
  continueWatching,
  coursesInProgress,
  getCommunityVideo,
  getCourseOutline,
  listCommunityVideos,
  listPublishedCourses,
  type CommunityCard,
  type CommunitySort,
  type CourseCard,
} from "@/lib/courses/catalog";
import type { Database } from "@/lib/db";
import { hasActiveMembership, type Viewer } from "@/lib/entitlements";
import { isMember } from "@/lib/playback/access";
import { progressFor } from "@/lib/playback/service";
import { MOBILE_POLICY } from "./policy";
import { targetFromPath } from "./targets";

/** The oldest app build the server still supports; older builds are asked to update. */
export const MIN_APP_VERSION = "1.0.0";

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export function meView(user: { id: string; name: string; email: string }, viewer: Viewer, now: Date = new Date()) {
  const current = (viewer?.memberships ?? []).filter((m) => hasActiveMembership([m], now));
  const until = current.reduce<Date | null>((max, m) => (!max || m.currentPeriodEnd > max ? m.currentPeriodEnd : max), null);
  return {
    user: { id: user.id, name: user.name, email: user.email },
    member: isMember(viewer),
    memberUntil: iso(until),
    offline: { licenseDays: MOBILE_POLICY.offlineLicenseDays, maxDownloads: MOBILE_POLICY.maxOfflineDownloads },
    minAppVersion: MIN_APP_VERSION,
  };
}

const courseCard = (c: CourseCard) => ({
  slug: c.slug,
  title: c.title,
  subtitle: c.subtitle,
  coverImageUrl: c.coverImageUrl,
  instructorName: c.instructorName,
  lessonCount: c.lessonCount,
  totalSeconds: c.totalSeconds,
  percentComplete: c.percentComplete,
});

const communityCard = (v: CommunityCard) => ({
  id: v.id,
  title: v.title,
  creatorName: v.creatorName,
  thumbnailUrl: v.thumbnailUrl,
  durationSeconds: v.durationSeconds,
  publishedAt: iso(v.publishedAt),
  viewCount: v.viewCount,
});

export async function homeView(db: Database, userId: string) {
  const [continuing, inProgress, path, community] = await Promise.all([
    continueWatching(db, userId, 6),
    coursesInProgress(db, userId),
    getPath(db, userId),
    listCommunityVideos(db, { sort: "trending", limit: 6 }),
  ]);
  return {
    continueWatching: continuing.flatMap((c) => {
      const target = targetFromPath(c.href);
      return target
        ? [{ videoId: c.videoId, title: c.title, context: c.context, thumbnailUrl: c.thumbnailUrl, durationSeconds: c.durationSeconds, positionSeconds: c.positionSeconds, target }]
        : [];
    }),
    courses: inProgress.map(courseCard),
    nextStep: path?.next ? { title: path.next.title, why: path.next.why, target: targetFromPath(path.next.path) } : null,
    trending: community.videos.map(communityCard),
  };
}

export async function coursesView(db: Database, userId: string) {
  return { courses: (await listPublishedCourses(db, userId)).map(courseCard) };
}

/** `member` marks the lessons he can play now; the rest show as for members. */
export async function courseView(db: Database, slug: string, userId: string, member: boolean) {
  const outline = await getCourseOutline(db, slug, userId);
  if (!outline) return null;
  const { course } = outline;
  return {
    course: {
      slug: course.slug,
      title: course.title,
      subtitle: course.subtitle,
      description: course.description,
      coverImageUrl: course.coverImageUrl,
      instructorName: course.instructorName,
      bookChapter: course.bookChapter,
    },
    modules: outline.modules.map((m) => ({
      id: m.id,
      title: m.title,
      lessons: m.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        summary: l.summary,
        isPreview: l.isPreview,
        videoId: l.available ? l.videoId : null,
        locked: !member && !l.isPreview,
        durationSeconds: l.durationSeconds,
        completed: l.completed,
        positionSeconds: l.positionSeconds,
      })),
    })),
    stats: { lessonCount: outline.stats.lessonCount, completedCount: outline.stats.completedCount, percentComplete: outline.stats.percentComplete },
    nextLessonId: outline.nextLessonId,
  };
}

export const COMMUNITY_SORTS: CommunitySort[] = ["newest", "trending", "top_rated", "most_viewed"];
export const COMMUNITY_PAGE = 20;

export async function communityView(db: Database, options: { sort: CommunitySort; themeSlug?: string; offset: number }) {
  const [list, themes] = await Promise.all([
    listCommunityVideos(db, { ...options, limit: COMMUNITY_PAGE }),
    options.offset === 0 ? communityThemes(db) : Promise.resolve(null),
  ]);
  const nextOffset = options.offset + list.videos.length;
  return {
    videos: list.videos.map(communityCard),
    nextOffset: nextOffset < list.total ? nextOffset : null,
    themes: themes?.map((t) => ({ slug: t.slug, name: t.name })) ?? null,
  };
}

export async function communityVideoView(db: Database, id: string, userId: string) {
  const found = await getCommunityVideo(db, id);
  if (!found) return null;
  const progress = (await progressFor(db, userId, [id])).get(id);
  const { video } = found;
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    creatorName: found.creatorName,
    thumbnailUrl: video.thumbnailUrl,
    durationSeconds: video.durationSeconds,
    publishedAt: iso(video.publishedAt),
    themes: found.themes.map((t) => ({ slug: t.slug, name: t.name })),
    positionSeconds: progress?.positionSeconds ?? 0,
    completed: progress?.completed ?? false,
  };
}

export async function coachView(db: Database, userId: string, access: { member: boolean; configured: boolean }) {
  if (!access.member) return { available: false as const, reason: "membership_required" as const };
  const [profile, path, conversations] = await Promise.all([getProfile(db, userId), getPath(db, userId), listConversations(db, userId, 30)]);
  return {
    available: access.configured,
    crisisResources: CRISIS_RESOURCES,
    stages: Object.entries(COACH_STAGES).map(([id, label]) => ({ id, label })),
    profile: profile ? { stage: profile.stage, children: profile.children, goals: profile.goals } : null,
    path: path
      ? {
          summary: path.summary,
          steps: path.steps.map((s) => ({ title: s.title, why: s.why, kind: s.kind, done: s.done, target: targetFromPath(s.path) })),
        }
      : null,
    conversations: conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() })),
  };
}
