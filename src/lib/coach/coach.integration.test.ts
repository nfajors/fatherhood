/**
 * The AI coach against a real Postgres, with fake models: conversations and the
 * daily limit, library lookups, the member context, a whole turn, and learning
 * paths. Runs only when TEST_DATABASE_URL points at a disposable database.
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { fatherContext, renderContext, saveProfile } from "./context";
import { CoachError, conversationTitle, deleteConversation, getConversation, listConversations, recordUserMessage, trimHistory } from "./conversations";
import { REFUSAL_TEXT, startCoachTurn, type CoachEvent, type CoachModel, type ModelEvent } from "./engine";
import { libraryQuery, pathCatalog, readLibraryItem, searchLibrary } from "./library";
import { generatePath, getPath, renderPlannerInput, toPathSteps, type PathPlanner, type PlannerOutput } from "./path";
import { COACH_POLICY } from "./policy";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-22T15:00:00Z");

describe("conversation helpers", () => {
  it("titles a conversation from its first line", () => {
    expect(conversationTitle("  How do I talk to my son about money?\nHe's 9.")).toBe("How do I talk to my son about money?");
    expect(conversationTitle("My daughter has started shutting her door every night after dinner and I don't know what to do")).toBe(
      "My daughter has started shutting her door every night after…",
    );
  });

  it("makes history start with the member and alternate", () => {
    expect(
      trimHistory([
        { role: "assistant", content: "orphan" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "c" },
        { role: "user", content: "unanswered" },
      ]),
    ).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
    ]);
  });

  it("turns a question into an any-word library query", () => {
    expect(libraryQuery("My toddler won't sleep and the bedtime fights")).toBe("toddler or won't or sleep or bedtime or fights");
    expect(libraryQuery("a an")).toBe("");
  });
});

class FakeCoach implements CoachModel {
  calls: { context: string; history: { role: string; content: string }[] }[] = [];
  constructor(private readonly script: (tools: Parameters<CoachModel["reply"]>[0]["tools"]) => AsyncGenerator<ModelEvent>) {}
  async *reply(input: Parameters<CoachModel["reply"]>[0]) {
    this.calls.push({ context: input.context, history: input.history });
    yield* this.script(input.tools);
  }
}

const finished = (stopReason = "end_turn"): ModelEvent => ({ type: "finished", model: "claude-opus-5-5", stopReason, inputTokens: 1200, outputTokens: 80 });

async function collect(events: AsyncGenerator<CoachEvent>) {
  const out: CoachEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe.skipIf(!url)("coach (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let lessonId: string;
  let draftLessonId: string;
  let storyId: string;
  let courseId: string;

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate coach_profiles, coach_conversations, learning_paths, certificates, watch_progress, watch_sessions, lessons, course_modules, courses, videos, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "dad", name: "Marcus Lee", email: "dad@test.dev" },
      { id: "other", name: "Sam", email: "sam@test.dev" },
      { id: "fellow", name: "James Hill", email: "james@test.dev", role: "creator" },
    ]);
    const [lessonVideo, draftVideo, story] = await db
      .insert(schema.videos)
      .values([
        { type: "professional", status: "approved", creatorId: "fellow", title: "Bedtime without the battle", transcript: "Bedtime routines calm toddlers. Keep the same order every night.", requireSignedUrls: true, durationSeconds: 600 },
        { type: "professional", status: "approved", creatorId: "fellow", title: "Bedtime secrets (draft course)", transcript: "Bedtime material in a draft course.", requireSignedUrls: true },
        { type: "community", status: "approved", creatorId: "fellow", title: "The night my son finally slept", description: "A father on bedtime with a toddler.", requireSignedUrls: false, durationSeconds: 300 },
      ])
      .returning();
    await db.insert(schema.videos).values({ type: "community", status: "pending_review", creatorId: "fellow", title: "Bedtime story still in review", requireSignedUrls: false });
    const [course, draft] = await db
      .insert(schema.courses)
      .values([
        { slug: "presence", title: "Presence", subtitle: "Being there, night after night", published: true },
        { slug: "draft", title: "Draft course", published: false },
      ])
      .returning();
    const [mod, draftMod] = await db
      .insert(schema.courseModules)
      .values([
        { courseId: course!.id, title: "Evenings", position: 1 },
        { courseId: draft!.id, title: "M", position: 1 },
      ])
      .returning();
    const [lesson, draftLesson] = await db
      .insert(schema.lessons)
      .values([
        { moduleId: mod!.id, videoId: lessonVideo!.id, title: "Bedtime without the battle", summary: "A calm bedtime routine.", position: 1 },
        { moduleId: draftMod!.id, videoId: draftVideo!.id, title: "Bedtime secrets", position: 1 },
      ])
      .returning();
    lessonId = lesson!.id;
    draftLessonId = draftLesson!.id;
    storyId = story!.id;
    courseId = course!.id;
  });

  describe("conversations", () => {
    it("starts a conversation, continues it, and keeps it to its owner", async () => {
      const first = await recordUserMessage(db, { userId: "dad", conversationId: null, text: "How do I handle bedtime?", now: NOW });
      expect(first).toMatchObject({ isNew: true, history: [{ role: "user", content: "How do I handle bedtime?" }] });
      await db.insert(schema.coachMessages).values({ conversationId: first.conversationId, userId: "dad", role: "assistant", content: "Tell me more.", createdAt: new Date(NOW.getTime() + 1000) });

      const second = await recordUserMessage(db, { userId: "dad", conversationId: first.conversationId, text: "He's 3.", now: new Date(NOW.getTime() + 2000) });
      expect(second.history).toEqual([
        { role: "user", content: "How do I handle bedtime?" },
        { role: "assistant", content: "Tell me more." },
        { role: "user", content: "He's 3." },
      ]);
      await expect(recordUserMessage(db, { userId: "other", conversationId: first.conversationId, text: "hi" })).rejects.toMatchObject({ reason: "not_found" });
      expect(await getConversation(db, "other", first.conversationId)).toBeNull();
      expect((await getConversation(db, "dad", first.conversationId))?.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
      expect((await listConversations(db, "dad")).map((c) => c.title)).toEqual(["How do I handle bedtime?"]);

      expect(await deleteConversation(db, "other", first.conversationId)).toBe(false);
      expect(await deleteConversation(db, "dad", first.conversationId)).toBe(true);
      expect(await listConversations(db, "dad")).toEqual([]);
    });

    it("refuses empty and overlong messages, and enforces the daily limit", async () => {
      await expect(recordUserMessage(db, { userId: "dad", conversationId: null, text: "   " })).rejects.toBeInstanceOf(CoachError);
      await expect(recordUserMessage(db, { userId: "dad", conversationId: null, text: "x".repeat(COACH_POLICY.maxMessageChars + 1) })).rejects.toMatchObject({ reason: "invalid" });

      const { conversationId } = await recordUserMessage(db, { userId: "dad", conversationId: null, text: "first", now: NOW });
      await db.insert(schema.coachMessages).values(
        Array.from({ length: COACH_POLICY.dailyMessages - 1 }, (_, i) => ({ conversationId, userId: "dad", role: "user" as const, content: `m${i}`, createdAt: new Date(NOW.getTime() - i * 60_000) })),
      );
      await expect(recordUserMessage(db, { userId: "dad", conversationId, text: "one more", now: NOW })).rejects.toMatchObject({ reason: "limit_reached" });
      // A day later the limit has reset.
      await recordUserMessage(db, { userId: "dad", conversationId, text: "next day", now: new Date(NOW.getTime() + 25 * 3_600_000) });
    });
  });

  describe("library", () => {
    it("finds only published lessons and approved stories, with links", async () => {
      const hits = await searchLibrary(db, "help with bedtime for my toddler");
      expect(hits.map((h) => [h.kind, h.title, h.path])).toEqual([
        ["lesson", "Bedtime without the battle", `/academy/presence/${lessonId}`],
        ["community", "The night my son finally slept", `/community/${storyId}`],
        ["course", "Presence", "/academy/presence"],
      ]);
      expect(hits[0]).toMatchObject({ context: 'Lesson in the course "Presence"', length: "10 min" });
      expect(await searchLibrary(db, "of")).toEqual([]);
    });

    it("reads a published item, and nothing unpublished", async () => {
      expect(await readLibraryItem(db, "lesson", lessonId)).toMatchObject({ title: "Bedtime without the battle", course: "Presence", transcript: expect.stringContaining("same order") });
      expect(await readLibraryItem(db, "lesson", draftLessonId)).toBeNull();
      expect(await readLibraryItem(db, "community", storyId)).toMatchObject({ creator: "James Hill" });
      expect(await readLibraryItem(db, "course", courseId)).toMatchObject({ lessons: [{ id: lessonId, path: `/academy/presence/${lessonId}` }] });
    });
  });

  it("tells the coach who it's talking to", async () => {
    await saveProfile(db, "dad", { stage: "young_kids", children: "a son, 3", goals: "Calmer bedtimes" });
    await db.insert(schema.watchProgress).values({ userId: "dad", videoId: (await db.query.lessons.findFirst({ where: eq(schema.lessons.id, lessonId) }))!.videoId!, positionSeconds: 120 });
    const context = renderContext(await fatherContext(db, "dad"), NOW);
    expect(context).toContain("His first name: Marcus");
    expect(context).toContain("Stage: Father of young children (3-5)");
    expect(context).toContain("His children, in his words: a son, 3");
    expect(context).toContain("Courses in progress: Presence (0%, /academy/presence)");
    expect(context).toContain(`Started recently: Bedtime without the battle (Presence, /academy/presence/${lessonId})`);
    expect(renderContext(await fatherContext(db, "other"), NOW)).toContain("He hasn't filled in his profile yet");
  });

  describe("a coach turn", () => {
    it("streams the reply with lookups, and saves it", async () => {
      const coach = new FakeCoach(async function* (tools) {
        yield { type: "text", text: "Let me find something on that." };
        const hits = await tools.search("bedtime");
        yield { type: "lookup", description: "Looking through the library for “bedtime”" };
        yield { type: "text", text: `\n\nTry [${hits[0]!.title}](${hits[0]!.path}).` };
        yield finished();
      });
      const events = await collect(await startCoachTurn(db, coach, { userId: "dad", conversationId: null, text: "Bedtime is a fight every night", now: NOW }));
      const conversation = events[0] as Extract<CoachEvent, { type: "conversation" }>;
      expect(conversation).toMatchObject({ type: "conversation", isNew: true });
      expect(events.slice(1).map((e) => e.type)).toEqual(["text", "status", "text", "done"]);
      expect(coach.calls[0]!.context).toContain("<member_context>");

      const saved = await getConversation(db, "dad", conversation.id);
      expect(saved?.messages.map((m) => [m.role, m.content])).toEqual([
        ["user", "Bedtime is a fight every night"],
        ["assistant", `Let me find something on that.\n\nTry [Bedtime without the battle](/academy/presence/${lessonId}).`],
      ]);
      const [row] = await db.select().from(schema.coachMessages).where(eq(schema.coachMessages.role, "assistant"));
      expect(row).toMatchObject({ model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 80, stopReason: "end_turn" });

      // The next turn sends the conversation so far.
      await collect(await startCoachTurn(db, coach, { userId: "dad", conversationId: conversation.id, text: "Thanks", now: new Date(NOW.getTime() + 60_000) }));
      expect(coach.calls[1]!.history.map((h) => h.role)).toEqual(["user", "assistant", "user"]);
    });

    it("answers a declined request with safety resources", async () => {
      const coach = new FakeCoach(async function* () {
        yield finished("refusal");
      });
      const events = await collect(await startCoachTurn(db, coach, { userId: "dad", conversationId: null, text: "something", now: NOW }));
      expect(events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: REFUSAL_TEXT }]);
      expect(events.at(-1)?.type).toBe("done");
    });

    it("reports a failure without saving a reply, and the next turn still works", async () => {
      const failing = new FakeCoach(async function* () {
        yield { type: "text", text: "Half an ans" };
        throw new Error("connection reset");
      });
      const events = await collect(await startCoachTurn(db, failing, { userId: "dad", conversationId: null, text: "first try", now: NOW }));
      expect(events.at(-1)).toMatchObject({ type: "error" });
      const id = (events[0] as Extract<CoachEvent, { type: "conversation" }>).id;
      expect((await getConversation(db, "dad", id))?.messages.map((m) => m.role)).toEqual(["user"]);

      const ok = new FakeCoach(async function* () {
        yield { type: "text", text: "Here's a thought." };
        yield finished();
      });
      await collect(await startCoachTurn(db, ok, { userId: "dad", conversationId: id, text: "second try", now: new Date(NOW.getTime() + 1000) }));
      // The unanswered message isn't sent as history on its own.
      expect(ok.calls[0]!.history).toEqual([{ role: "user", content: "second try" }]);
    });
  });

  describe("learning paths", () => {
    class FakePlanner implements PathPlanner {
      readonly model = "fake-planner";
      seen: string[] = [];
      constructor(private readonly output: (refs: Map<string, string>) => PlannerOutput) {}
      async plan({ catalog }: Parameters<PathPlanner["plan"]>[0]) {
        this.seen = catalog.map((c) => `${c.ref}:${c.title}`);
        return this.output(new Map(catalog.map((c) => [c.title, c.ref])));
      }
    }

    it("lists only published items, with refs", async () => {
      const catalog = await pathCatalog(db);
      expect(catalog.map((c) => [c.ref, c.kind, c.title])).toEqual([
        ["C1", "course", "Presence"],
        ["L1", "lesson", "Bedtime without the battle"],
        ["V1", "community", "The night my son finally slept"],
      ]);
      const input = renderPlannerInput({ stage: "young_kids", children: "a son, 3", goals: "Calmer bedtimes" }, catalog, new Set([`lesson:${lessonId}`]));
      expect(input).toContain("Wants to work on: Calmer bedtimes");
      expect(input).toContain("L1 [lesson] Bedtime without the battle - In \"Presence\". A calm bedtime routine. [done]");
    });

    it("keeps known refs once each, in order", () => {
      const catalog = [
        { ref: "L1", kind: "lesson" as const, id: "a", title: "A", path: "/a", about: null, themes: [] },
        { ref: "V1", kind: "community" as const, id: "b", title: "B", path: "/b", about: null, themes: [] },
      ];
      expect(toPathSteps({ summary: "s", steps: [{ ref: "v1", why: " Because. " }, { ref: "L9", why: "made up" }, { ref: "V1", why: "again" }, { ref: "L1", why: "x" }] }, catalog)).toEqual([
        { kind: "community", id: "b", title: "B", path: "/b", why: "Because." },
        { kind: "lesson", id: "a", title: "A", path: "/a", why: "x" },
      ]);
    });

    it("plans, stores and marks progress on a path", async () => {
      const planner = new FakePlanner((refs) => ({
        summary: "Calmer evenings, one step at a time.",
        steps: [
          { ref: refs.get("Bedtime without the battle")!, why: "Start with the routine." },
          { ref: refs.get("The night my son finally slept")!, why: "Hear from a dad who's been there." },
          { ref: "L99", why: "invented" },
        ],
      }));
      await generatePath(db, planner, "dad", { stage: "young_kids", children: null, goals: "bedtime" }, NOW);
      let path = await getPath(db, "dad");
      expect(path?.steps.map((s) => [s.title, s.done])).toEqual([
        ["Bedtime without the battle", false],
        ["The night my son finally slept", false],
      ]);
      expect(path?.next?.title).toBe("Bedtime without the battle");

      const videoId = (await db.query.lessons.findFirst({ where: eq(schema.lessons.id, lessonId) }))!.videoId!;
      await db.insert(schema.watchProgress).values({ userId: "dad", videoId, completed: true });
      await db.insert(schema.watchSessions).values({ userId: "dad", videoId: storyId, secondsWatched: 45 });
      path = await getPath(db, "dad");
      expect(path?.steps.every((s) => s.done)).toBe(true);
      expect(path?.next).toBeNull();

      // Planning again replaces the path.
      await generatePath(db, new FakePlanner((refs) => ({ summary: "New", steps: [{ ref: refs.get("Presence")!, why: "The whole course." }] })), "dad", { stage: "young_kids", children: null, goals: null }, NOW);
      path = await getPath(db, "dad");
      expect(path).toMatchObject({ summary: "New", steps: [{ kind: "course", title: "Presence", done: true }] });
    });

    it("refuses a plan with nothing usable", async () => {
      await expect(generatePath(db, new FakePlanner(() => ({ summary: "x", steps: [{ ref: "Z1", why: "?" }] })), "dad", { stage: "teens", children: null, goals: null })).rejects.toThrow(
        "didn't return a usable path",
      );
      expect(await getPath(db, "dad")).toBeNull();
    });
  });
});
