import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import type { CoachHome } from "../../../src/api/types";
import { useApi } from "../../../src/api/useApi";
import { Body, Button, Card, Heading, Loading, Notice, Screen, Section, Title } from "../../../src/ui/components";
import { openTarget } from "../../../src/ui/navigate";
import { colors, space } from "../../../src/ui/theme";

export default function CoachScreen() {
  const { data, error, refreshing, refresh } = useApi<CoachHome>("/api/mobile/v1/coach");

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Title>Your coach</Title>
      <Body muted style={{ marginTop: space(1) }}>
        Talk through what's going on with your children. The coach draws on the Academy and the stories fathers share here.
      </Body>
      {error && !data ? <Notice message={error.message} action={{ title: "Try again", onPress: refresh }} /> : null}
      {!data && !error ? <Loading /> : null}
      {data && !("stages" in data) ? <Notice message="The coach is for members." /> : null}
      {data && "stages" in data ? (
        <>
          {!data.available ? <Notice message="The coach isn't available right now. Please try again later." /> : null}
          <Button title="Talk with the coach" onPress={() => router.push({ pathname: "/coach/[id]", params: { id: "new" } })} disabled={!data.available} style={{ marginTop: space(5) }} />

          <Section title="Your learning path">
            {data.path ? (
              <>
                <Body style={{ marginTop: space(2) }}>{data.path.summary}</Body>
                {data.path.steps.map((s, i) => (
                  <Card key={`${s.kind}-${i}`} onPress={s.target ? () => openTarget(s.target!, { title: s.title }) : undefined} accessibilityLabel={s.title}>
                    <View style={styles.step}>
                      <Text style={[styles.mark, s.done && styles.done]}>{s.done ? "✓" : String(i + 1)}</Text>
                      <View style={{ flex: 1 }}>
                        <Heading style={{ fontSize: 16 }}>{s.title}</Heading>
                        <Body muted>{s.why}</Body>
                      </View>
                    </View>
                  </Card>
                ))}
              </>
            ) : (
              <Body muted style={{ marginTop: space(2) }}>Tell the coach about yourself and your children, and it will plan a path through the courses and stories for you.</Body>
            )}
            <Button
              title={data.profile ? "Update about you" : "Tell the coach about you"}
              variant="secondary"
              disabled={!data.available}
              onPress={() => router.push("/coach/about")}
              style={{ marginTop: space(3) }}
            />
          </Section>

          {data.conversations.length ? (
            <Section title="Conversations">
              {data.conversations.map((c) => (
                <Card key={c.id} onPress={() => router.push({ pathname: "/coach/[id]", params: { id: c.id } })} accessibilityLabel={c.title}>
                  <Text style={styles.convTitle} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.meta}>{new Date(c.updatedAt).toLocaleDateString()}</Text>
                </Card>
              ))}
            </Section>
          ) : null}

          <Section title="If you need help now">
            {data.crisisResources.map((r) => (
              <Body key={r.name} style={{ marginTop: space(2) }}>
                <Text style={{ fontWeight: "700" }}>{r.name}: </Text>
                {r.detail}
              </Body>
            ))}
            <Body muted style={{ marginTop: space(3) }}>The coach is an AI. It isn't a therapist, doctor or lawyer. Your conversations are private and you can delete them.</Body>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: "row", gap: space(3) },
  mark: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.navy100, textAlign: "center", lineHeight: 26, color: colors.muted, fontSize: 13, overflow: "hidden" },
  done: { backgroundColor: colors.gold100, borderColor: colors.gold400, color: colors.gold600, fontWeight: "700" },
  convTitle: { fontSize: 16, fontWeight: "600", color: colors.navy900 },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
});
