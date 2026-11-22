/**
 * Watching a lesson or a story. Plays the download when there is one (so it
 * works offline), otherwise streams. Members can download from here.
 */
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "../../../src/api/client";
import type { Course, Lesson, Playback, Story } from "../../../src/api/types";
import { useApi } from "../../../src/api/useApi";
import { useMe } from "../../../src/auth/AuthProvider";
import { DownloadButton } from "../../../src/downloads/DownloadButton";
import { formatDuration } from "../../../src/lib/format";
import { resumeAt } from "../../../src/player/progressQueue";
import { VideoPlayer } from "../../../src/player/VideoPlayer";
import { useDownloads } from "../../../src/downloads/DownloadsProvider";
import { Body, Button, Heading, Loading, Notice } from "../../../src/ui/components";
import { colors, space } from "../../../src/ui/theme";

type Params = { videoId: string; kind: "lesson" | "story"; title?: string; context?: string; courseSlug?: string; lessonId?: string };

export default function WatchScreen() {
  const params = useLocalSearchParams<Params>();
  const me = useMe();
  const downloads = useDownloads();
  const isLesson = params.kind === "lesson" && params.courseSlug;
  const story = useApi<Story>(isLesson ? null : `/api/mobile/v1/videos/${params.videoId}`);
  const course = useApi<Course>(isLesson ? `/api/mobile/v1/courses/${params.courseSlug}` : null);

  const { lesson, next } = useMemo(() => {
    const flat: Lesson[] = course.data?.modules.flatMap((m) => m.lessons) ?? [];
    const i = flat.findIndex((l) => l.id === params.lessonId);
    return { lesson: i >= 0 ? flat[i]! : null, next: flat.slice(i + 1).find((l) => l.videoId) ?? null };
  }, [course.data, params.lessonId]);

  const title = lesson?.title ?? story.data?.title ?? params.title ?? "";
  const context = isLesson ? (course.data?.course.title ?? params.context ?? "") : (story.data?.creatorName ?? "Community Voices");
  const durationSeconds = lesson?.durationSeconds ?? story.data?.durationSeconds ?? null;
  const progress = lesson ?? story.data;
  const local = downloads.localUri(params.videoId);

  // Where to play from: the download if there is one, otherwise a fresh streaming link.
  const [source, setSource] = useState<{ uri: string } | { error: ApiError } | null>(null);
  useEffect(() => {
    if (local) return setSource({ uri: local });
    let live = true;
    api<Playback>(`/api/videos/${params.videoId}/playback`)
      .then((p) => live && setSource({ uri: p.urls.hls }))
      .catch((e) => live && setSource({ error: e instanceof ApiError ? e : new ApiError(0, "error", "This video can't play right now.") }));
    return () => {
      live = false;
    };
  }, [params.videoId, local]);

  // Wait for his saved place (or give up on it when offline).
  const ready = Boolean(progress) || Boolean(story.error || course.error);
  const locked = lesson?.locked ?? false;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <Stack.Screen options={{ title: isLesson ? "Lesson" : "Story" }} />
      <View style={styles.stage}>
        {locked ? (
          <View style={styles.message}>
            <Text style={styles.messageText}>This lesson is for members.</Text>
          </View>
        ) : source && "uri" in source && ready ? (
          <VideoPlayer
            key={source.uri}
            videoId={params.videoId}
            uri={source.uri}
            durationSeconds={durationSeconds}
            startAt={resumeAt(progress?.positionSeconds ?? 0, durationSeconds, progress?.completed ?? false)}
          />
        ) : source && "error" in source ? (
          <View style={styles.message}>
            <Text style={styles.messageText}>
              {source.error.status === 403
                ? "This is for members."
                : source.error.offline
                  ? "You're offline. Download videos to watch them without a connection."
                  : "This video can't play right now. Please try again later."}
            </Text>
          </View>
        ) : (
          <View style={styles.message}>
            <Loading />
          </View>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.context}>{context}</Text>
        <Heading style={{ fontSize: 22, lineHeight: 28 }}>{title}</Heading>
        {durationSeconds ? <Body muted style={{ marginTop: space(1) }}>{formatDuration(durationSeconds)}</Body> : null}
        {local ? <Body muted style={{ marginTop: space(1) }}>Playing from your downloads</Body> : null}

        {me.member && !locked && downloads.supported ? (
          <DownloadButton
            item={{
              videoId: params.videoId,
              title,
              context,
              durationSeconds,
              target: isLesson ? { kind: "lesson", courseSlug: params.courseSlug!, lessonId: params.lessonId! } : { kind: "community", videoId: params.videoId },
            }}
          />
        ) : null}

        {lesson?.summary ? <Body style={{ marginTop: space(4) }}>{lesson.summary}</Body> : null}
        {story.data?.description ? <Body style={{ marginTop: space(4) }}>{story.data.description}</Body> : null}
        {story.data?.themes.length ? <Body muted style={{ marginTop: space(3) }}>{story.data.themes.map((t) => t.name).join(" · ")}</Body> : null}

        {next ? (
          <Button
            title={`Next: ${next.title}`}
            variant="secondary"
            style={{ marginTop: space(6) }}
            onPress={() =>
              router.replace({
                pathname: "/watch/[videoId]",
                params: { videoId: next.videoId!, kind: "lesson", courseSlug: params.courseSlug!, lessonId: next.id, title: next.title, context },
              })
            }
          />
        ) : null}
        {(story.error || course.error) && !progress ? <Notice message={(story.error ?? course.error)!.message} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  stage: { backgroundColor: "#000" },
  message: { aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center", padding: space(6), backgroundColor: colors.navy950 },
  messageText: { color: colors.navy100, fontSize: 15, textAlign: "center", lineHeight: 22 },
  body: { padding: space(4), paddingBottom: space(12) },
  context: { fontSize: 12, color: colors.gold600, fontWeight: "600", marginBottom: space(1) },
});
