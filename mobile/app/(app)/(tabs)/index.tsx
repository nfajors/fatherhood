import { router, Stack } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Home } from "../../../src/api/types";
import { useApi } from "../../../src/api/useApi";
import { useMe } from "../../../src/auth/AuthProvider";
import { APP_VERSION } from "../../../src/config";
import { compareVersions, formatClock } from "../../../src/lib/format";
import { CourseRow, StoryRow } from "../../../src/ui/cards";
import { Body, Card, Heading, Loading, Notice, ProgressBar, Screen, Section, Title } from "../../../src/ui/components";
import { openTarget } from "../../../src/ui/navigate";
import { colors, space } from "../../../src/ui/theme";

export default function HomeScreen() {
  const me = useMe();
  const { data, error, refreshing, refresh } = useApi<Home>("/api/mobile/v1/home");
  const first = me.user.name.split(" ")[0];

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push("/account")} accessibilityRole="button" accessibilityLabel="Account" style={styles.avatar}>
              <Text style={styles.avatarText}>{me.user.name.slice(0, 1).toUpperCase()}</Text>
            </Pressable>
          ),
        }}
      />
      <Title>Welcome back{first ? `, ${first}` : ""}</Title>
      {compareVersions(APP_VERSION, me.minAppVersion) < 0 ? <Notice title="Please update the app" message="This version is out of date. Update it from the App Store or Google Play to keep everything working." /> : null}
      {!me.member ? <Notice message="Community Voices and free preview lessons are open to you. Courses, the coach and downloads are for members." /> : null}
      {error && !data ? <Notice message={error.message} action={{ title: "Try again", onPress: refresh }} /> : null}
      {!data && !error ? <Loading /> : null}

      {data?.nextStep ? (
        <Section title="Your next step">
          <Card onPress={data.nextStep.target ? () => openTarget(data.nextStep!.target!) : undefined}>
            <Heading>{data.nextStep.title}</Heading>
            <Body muted style={{ marginTop: space(1) }}>{data.nextStep.why}</Body>
          </Card>
        </Section>
      ) : null}

      {data?.continueWatching.length ? (
        <Section title="Continue watching">
          {data.continueWatching.map((item) => (
            <Card key={item.videoId} onPress={() => openTarget(item.target, { videoId: item.videoId, title: item.title, context: item.context })} accessibilityLabel={`Continue ${item.title}`}>
              <Text style={styles.context}>{item.context}</Text>
              <Heading>{item.title}</Heading>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <ProgressBar value={item.durationSeconds ? (item.positionSeconds / item.durationSeconds) * 100 : 0} />
                </View>
                <Text style={styles.time}>{formatClock(item.positionSeconds)}</Text>
              </View>
            </Card>
          ))}
        </Section>
      ) : null}

      {data?.courses.length ? (
        <Section title="Your courses">
          {data.courses.map((c) => (
            <CourseRow key={c.slug} course={c} onPress={() => openTarget({ kind: "course", courseSlug: c.slug })} />
          ))}
        </Section>
      ) : null}

      {data?.trending.length ? (
        <Section title="Stories fathers are watching">
          {data.trending.map((s) => (
            <StoryRow key={s.id} story={s} onPress={() => openTarget({ kind: "community", videoId: s.id }, { title: s.title })} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center", marginRight: space(4) },
  avatarText: { color: colors.white, fontWeight: "700" },
  context: { fontSize: 12, color: colors.gold600, fontWeight: "600", marginBottom: space(1) },
  row: { flexDirection: "row", alignItems: "center", gap: space(3) },
  time: { fontSize: 13, color: colors.muted, marginTop: space(2), fontVariant: ["tabular-nums"] },
});
