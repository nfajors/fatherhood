import { describe, expect, it } from "vitest";
import { targetFromPath } from "./targets";

describe("targetFromPath", () => {
  it("maps site paths to app screens", () => {
    expect(targetFromPath("/academy/talking-to-teens")).toEqual({ kind: "course", courseSlug: "talking-to-teens" });
    expect(targetFromPath("/academy/talking-to-teens/abc")).toEqual({ kind: "lesson", courseSlug: "talking-to-teens", lessonId: "abc" });
    expect(targetFromPath("/community/v1?t=30")).toEqual({ kind: "community", videoId: "v1" });
  });

  it("returns null for pages the app doesn't have", () => {
    expect(targetFromPath("/discussions/x")).toBeNull();
    expect(targetFromPath("/academy")).toBeNull();
    expect(targetFromPath("/community/v1/extra")).toBeNull();
    expect(targetFromPath("/academy/a/b/c")).toBeNull();
  });
});
