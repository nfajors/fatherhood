import { router, Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import type { Course, Lesson } from "../../../src/api/types";
import { useApi } from "../../../src/api/useApi";
import { useDownloads } from "../../../src/downloads/DownloadsProvider";
import { formatDuration } from "../../../src/lib/format";
import { Body, Button, Card, Loading, Notice, ProgressBar, Screen, Section, Title } from "../../../src/ui/components";
import { colors, space } from "../../../src/ui/theme";

export default function CourseScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data, error, refreshing, refresh } = useApi<Course>(`/api/mobile/v1/courses/${slug}`);
  const downloads = useDownloads();

  const open = (lesson: Lesson) => {
    if (!lesson.videoId || !data) return;
    router.push({
      pathname: "/watch/[videoId]",
      params: { videoId: lesson.videoId, kind: "lesson", courseSlug: slug, lessonId: lesson.id, title: lesson.title, context: data.course.title },
    });
  };
  const nextLesson = data?.modules.flatMap((m) => m.lessons).find((l) => l.id === data.nextLessonId);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: "" }} />
      {error && !data ? <Notice message={error.message} action={{ title: "Try again", onPress: refresh }} /> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <>
          {data.course.bookChapter ? <Text style={styles.kicker}>{data.course.bookChapter}</Text> : null}
          <Title>{data.course.title}</Title>
          {data.course.subtitle ? <Body muted style={{ marginTop: space(1) }}>{data.course.subtitle}</Body> : null}
          {data.course.instructorName ? <Body muted style={{ marginTop: space(1) }}>With {data.course.instructorName}</Body> : null}
          <View style={{ marginTop: space(4) }}>
            <Body muted>
              {data.stats.completedCount} of {data.stats.lessonCount} lessons complete
            </Body>
            <ProgressBar value={data.stats.percentComplete} />
          </View>
          {nextLesson && !nextLesson.locked ? (
            <Button title={data.stats.completedCount ? "Continue" : "Start the course"} onPress={() => open(nextLesson)} style={{ marginTop: space(4) }} />
          ) : null}
          {data.course.description ? <Body style={{ marginTop: space(4) }}>{data.course.description}</Body> : null}

          {data.modules.map((m) => (
            <Section key={m.id} title={m.title}>
              {m.lessons.map((l, i) => {
                const downloaded = downloads.records.some((r) => r.videoId === l.videoId);
                return (
                  <Card key={l.id} onPress={l.videoId && !l.locked ? () => open(l) : undefined} accessibilityLabel={l.title}>
                    <View style={styles.lesson}>
                      <Text style={[styles.mark, l.completed && styles.done]}>{l.completed ? "✓" : String(i + 1)}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.lessonTitle}>{l.title}</Text>
                        <Text style={styles.meta}>
                          {[formatDuration(l.durationSeconds), l.isPreview ? "Free preview" : null, l.locked ? "For members" : null, downloaded ? "Downloaded" : null, !l.videoId ? "Coming soon" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                    </View>
                  </Card>
                );
              })}
            </Section>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 12, color: colors.gold600, fontWeight: "700", letterSpacing: 1, marginBottom: space(1) },
  lesson: { flexDirection: "row", gap: space(3), alignItems: "center" },
  mark: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.navy100, textAlign: "center", lineHeight: 26, color: colors.muted, fontSize: 13, overflow: "hidden" },
  done: { backgroundColor: colors.gold100, borderColor: colors.gold400, color: colors.gold600, fontWeight: "700" },
  lessonTitle: { fontSize: 16, fontWeight: "600", color: colors.navy900 },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
});
