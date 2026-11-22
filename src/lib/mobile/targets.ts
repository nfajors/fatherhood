/**
 * Where something opens in the app. The web pages link by path; the app maps
 * those paths to its own screens.
 */
export type AppTarget =
  | { kind: "course"; courseSlug: string }
  | { kind: "lesson"; courseSlug: string; lessonId: string }
  | { kind: "community"; videoId: string };

/** The app screen for a site path, or null for pages the app doesn't have. */
export function targetFromPath(path: string): AppTarget | null {
  const [, section, a, b, ...rest] = path.split("?")[0]!.split("/");
  if (rest.length || !a) return null;
  if (section === "academy") return b ? { kind: "lesson", courseSlug: a, lessonId: b } : { kind: "course", courseSlug: a };
  if (section === "community" && !b) return { kind: "community", videoId: a };
  return null;
}
