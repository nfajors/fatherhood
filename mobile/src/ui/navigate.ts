/** Open an app target (a course, a lesson or a story). */
import { router } from "expo-router";
import type { AppTarget } from "../api/types";

export type WatchParams = { title: string; context: string; courseSlug?: string; lessonId?: string; kind: "lesson" | "story" };

export function openTarget(target: AppTarget, extra?: { videoId?: string; title?: string; context?: string }) {
  if (target.kind === "course") return router.push({ pathname: "/course/[slug]", params: { slug: target.courseSlug } });
  if (target.kind === "community") return router.push({ pathname: "/watch/[videoId]", params: { videoId: target.videoId, kind: "story", title: extra?.title ?? "", context: extra?.context ?? "Community Voices" } });
  // A lesson needs its video; without one, open the course.
  if (!extra?.videoId) return router.push({ pathname: "/course/[slug]", params: { slug: target.courseSlug } });
  return router.push({
    pathname: "/watch/[videoId]",
    params: { videoId: extra.videoId, kind: "lesson", courseSlug: target.courseSlug, lessonId: target.lessonId, title: extra.title ?? "", context: extra.context ?? "" },
  });
}
