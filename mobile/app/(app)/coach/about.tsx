/** What the coach knows about him; saving plans (or re-plans) his learning path. */
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { api, ApiError } from "../../../src/api/client";
import type { CoachHome } from "../../../src/api/types";
import { useApi } from "../../../src/api/useApi";
import { Body, Button, Loading, Pill, Screen } from "../../../src/ui/components";
import { colors, space } from "../../../src/ui/theme";

export default function AboutScreen() {
  const { data } = useApi<CoachHome>("/api/mobile/v1/coach");
  const [stage, setStage] = useState<string | null>(null);
  const [children, setChildren] = useState("");
  const [goals, setGoals] = useState("");
  const [busy, setBusy] = useState<null | "saving" | "planning">(null);
  const [error, setError] = useState<string | null>(null);
  const home = data && "stages" in data ? data : null;

  useEffect(() => {
    if (!home?.profile || stage) return;
    setStage(home.profile.stage);
    setChildren(home.profile.children ?? "");
    setGoals(home.profile.goals ?? "");
  }, [home, stage]);

  const save = async () => {
    if (!stage) return;
    setError(null);
    try {
      setBusy("saving");
      await api("/api/coach/profile", { method: "PUT", body: { stage, children, goals } });
      setBusy("planning");
      await api("/api/coach/path", { method: "POST" });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!home) return <Loading />;
  return (
    <Screen>
      <Text style={styles.label}>Where are you as a father?</Text>
      <View style={styles.stages}>
        {home.stages.map((s) => (
          <Pill key={s.id} label={s.label} selected={stage === s.id} onPress={() => setStage(s.id)} />
        ))}
      </View>
      <Text style={styles.label}>Your children (optional)</Text>
      <TextInput value={children} onChangeText={setChildren} placeholder="e.g. a son, 14, and a daughter, 9" maxLength={300} style={styles.input} accessibilityLabel="Your children" />
      <Text style={styles.label}>What would you like to work on? (optional)</Text>
      <TextInput value={goals} onChangeText={setGoals} placeholder="In your own words" maxLength={1000} multiline style={[styles.input, styles.multi]} accessibilityLabel="What you'd like to work on" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={busy === "planning" ? "Planning your path…" : "Save and plan my path"} onPress={save} busy={busy !== null} disabled={!stage} style={{ marginTop: space(6) }} />
      <Body muted style={{ marginTop: space(3) }}>Only you and the coach see this. You can change it any time.</Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: "600", color: colors.navy900, marginTop: space(5), marginBottom: space(2) },
  stages: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.navy100, backgroundColor: colors.white, paddingHorizontal: space(3), fontSize: 16, color: colors.ink },
  multi: { minHeight: 110, paddingTop: space(3), textAlignVertical: "top" },
  error: { color: colors.danger, marginTop: space(3) },
});
