/**
 * What the server's /api/mobile/v1 endpoints return (src/lib/mobile/api.ts).
 * Kept by hand: the app must not import server code.
 */
export type { AppTarget } from "../../../src/lib/mobile/targets";
import type { AppTarget } from "../../../src/lib/mobile/targets";

export type Me = {
  user: { id: string; name: string; email: string };
  member: boolean;
  memberUntil: string | null;
  offline: { licenseDays: number; maxDownloads: number };
  minAppVersion: string;
};

export type CourseCard = {
  slug: string;
  title: string;
  subtitle: string | null;
  coverImageUrl: string | null;
  instructorName: string | null;
  lessonCount: number;
  totalSeconds: number;
  percentComplete: number | null;
};

export type StoryCard = {
  id: string;
  title: string;
  creatorName: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  viewCount: number;
};

export type Home = {
  continueWatching: {
    videoId: string;
    title: string;
    context: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    positionSeconds: number;
    target: AppTarget;
  }[];
  courses: CourseCard[];
  nextStep: { title: string; why: string; target: AppTarget | null } | null;
  trending: StoryCard[];
};

export type Lesson = {
  id: string;
  title: string;
  summary: string | null;
  isPreview: boolean;
  videoId: string | null;
  locked: boolean;
  durationSeconds: number | null;
  completed: boolean;
  positionSeconds: number;
};

export type Course = {
  course: {
    slug: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    coverImageUrl: string | null;
    instructorName: string | null;
    bookChapter: string | null;
  };
  modules: { id: string; title: string; lessons: Lesson[] }[];
  stats: { lessonCount: number; completedCount: number; percentComplete: number };
  nextLessonId: string | null;
};

export type StorySort = "newest" | "trending" | "top_rated" | "most_viewed";

export type Stories = {
  videos: StoryCard[];
  nextOffset: number | null;
  themes: { slug: string; name: string }[] | null;
};

export type Story = {
  id: string;
  title: string;
  description: string | null;
  creatorName: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  themes: { slug: string; name: string }[];
  positionSeconds: number;
  completed: boolean;
};

export type CoachHome =
  | { available: false; reason: "membership_required" }
  | {
      available: boolean;
      crisisResources: { name: string; detail: string }[];
      stages: { id: string; label: string }[];
      profile: { stage: string; children: string | null; goals: string | null } | null;
      path: { summary: string; steps: { title: string; why: string; kind: string; done: boolean; target: AppTarget | null }[] } | null;
      conversations: { id: string; title: string; updatedAt: string }[];
    };

export type Conversation = {
  id: string;
  title: string;
  messages: { id: string; role: "user" | "assistant"; content: string; createdAt: string }[];
};

export type Playback = { urls: { hls: string; dash: string; thumbnail: string }; expiresAt: string | null };

export type DownloadResponse =
  | { status: "preparing"; percentComplete: number }
  | { status: "ready"; url: string; urlExpiresAt: string; licenseExpiresAt: string };
