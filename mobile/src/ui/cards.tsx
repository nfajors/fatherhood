import { Image, StyleSheet, Text, View } from "react-native";
import type { CourseCard, StoryCard } from "../api/types";
import { formatDuration } from "../lib/format";
import { Body, Card, ProgressBar } from "./components";
import { colors, serif, space } from "./theme";

export function CourseRow({ course, onPress }: { course: CourseCard; onPress: () => void }) {
  return (
    <Card onPress={onPress} accessibilityLabel={course.title}>
      <Text style={styles.title}>{course.title}</Text>
      {course.subtitle ? <Body muted numberOfLines={2}>{course.subtitle}</Body> : null}
      <Text style={styles.meta}>
        {course.lessonCount} {course.lessonCount === 1 ? "lesson" : "lessons"}
        {course.totalSeconds ? ` · ${formatDuration(course.totalSeconds)}` : ""}
        {course.instructorName ? ` · ${course.instructorName}` : ""}
      </Text>
      {course.percentComplete ? <ProgressBar value={course.percentComplete} /> : null}
    </Card>
  );
}

export function StoryRow({ story, onPress }: { story: StoryCard; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={styles.row} accessibilityLabel={`${story.title}, by ${story.creatorName}`}>
      {story.thumbnailUrl ? <Image source={{ uri: story.thumbnailUrl }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbBlank]}><Text style={styles.quote}>❝</Text></View>}
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={2}>{story.title}</Text>
        <Text style={styles.meta}>
          {story.creatorName}
          {story.durationSeconds ? ` · ${formatDuration(story.durationSeconds)}` : ""}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: serif, fontSize: 17, lineHeight: 23, fontWeight: "600", color: colors.navy900, marginBottom: space(1) },
  meta: { fontSize: 13, color: colors.muted, marginTop: space(1) },
  row: { flexDirection: "row", gap: space(3), alignItems: "center" },
  thumb: { width: 96, height: 60, borderRadius: 8, backgroundColor: colors.navy800 },
  thumbBlank: { alignItems: "center", justifyContent: "center" },
  quote: { color: colors.gold400, fontSize: 22 },
});
