import { router } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useMe } from "../../../src/auth/AuthProvider";
import { useDownloads } from "../../../src/downloads/DownloadsProvider";
import { daysLeft } from "../../../src/downloads/licenses";
import { formatBytes, formatDuration } from "../../../src/lib/format";
import { Body, Button, Card, Notice, Screen, Title } from "../../../src/ui/components";
import { colors, space } from "../../../src/ui/theme";

export default function DownloadsScreen() {
  const me = useMe();
  const downloads = useDownloads();
  const now = new Date();
  const total = downloads.records.reduce((sum, r) => sum + r.sizeBytes, 0);

  const play = (videoId: string) => {
    const r = downloads.records.find((x) => x.videoId === videoId)!;
    const t = r.target;
    router.push({
      pathname: "/watch/[videoId]",
      params:
        t.kind === "lesson"
          ? { videoId, kind: "lesson", courseSlug: t.courseSlug, lessonId: t.lessonId, title: r.title, context: r.context }
          : { videoId, kind: "story", title: r.title, context: r.context },
    });
  };

  return (
    <Screen onRefresh={() => downloads.sync(true)} refreshing={false}>
      <Title>Downloads</Title>
      <Body muted style={{ marginTop: space(1) }}>
        Watch without a connection. Downloads play for {me.offline.licenseDays} days and renew each time the app is online.
      </Body>
      {!downloads.supported ? <Notice message="Downloads are available in the iPhone and Android apps." /> : null}
      {downloads.supported && !me.member ? <Notice message="Downloads are for members." /> : null}
      {downloads.supported && me.member && downloads.records.length === 0 ? (
        <Notice message="Nothing downloaded yet. Open a lesson or a story and choose “Download to watch offline”." />
      ) : null}

      {downloads.records.map((r) => {
        const days = daysLeft(r, now);
        return (
          <Card key={r.videoId} onPress={() => play(r.videoId)} accessibilityLabel={`Play ${r.title}`}>
            <Text style={styles.context}>{r.context}</Text>
            <Text style={styles.title}>{r.title}</Text>
            <Text style={styles.meta}>
              {[formatDuration(r.durationSeconds), formatBytes(r.sizeBytes), `${days} ${days === 1 ? "day" : "days"} left offline`].filter(Boolean).join(" · ")}
            </Text>
            <View style={{ flexDirection: "row", marginTop: space(2) }}>
              <Button
                title="Remove"
                variant="quiet"
                onPress={() =>
                  Alert.alert("Remove download?", r.title, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Remove", style: "destructive", onPress: () => void downloads.remove(r.videoId) },
                  ])
                }
              />
            </View>
          </Card>
        );
      })}
      {Object.entries(downloads.active).map(([videoId, a]) => (
        <Notice key={videoId} message={a.phase === "preparing" ? "Preparing a download…" : `Downloading… ${a.percent}%`} />
      ))}
      {total ? <Body muted style={{ marginTop: space(4) }}>{downloads.records.length} of {me.offline.maxDownloads} · {formatBytes(total)} on this phone</Body> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  context: { fontSize: 12, color: colors.gold600, fontWeight: "600", marginBottom: space(1) },
  title: { fontSize: 16, fontWeight: "600", color: colors.navy900 },
  meta: { fontSize: 13, color: colors.muted, marginTop: space(1) },
});
