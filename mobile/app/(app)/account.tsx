import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { api, ApiError } from "../../src/api/client";
import { useAuth, useMe } from "../../src/auth/AuthProvider";
import { APP_VERSION } from "../../src/config";
import { Body, Button, Card, Heading, Screen, Section } from "../../src/ui/components";
import { colors, space } from "../../src/ui/theme";

export default function AccountScreen() {
  const me = useMe();
  const auth = useAuth();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    setBusy(true);
    await auth.signOut(); // signed out: the layout takes him to sign in
  };

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/me/account", { method: "DELETE", body: { confirmation: confirm } });
      await auth.signOut();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete your account. Please try again.");
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Heading>{me.user.name}</Heading>
        <Body muted>{me.user.email}</Body>
        <Text style={styles.status}>{me.member ? (me.memberUntil ? `Member · through ${new Date(me.memberUntil).toLocaleDateString()}` : "Member") : "Not a member"}</Text>
      </Card>
      <Button title="Sign out" variant="secondary" onPress={signOut} busy={busy && confirm === null} style={{ marginTop: space(5) }} />
      <Body muted style={{ marginTop: space(2) }}>Signing out removes your downloads from this phone.</Body>

      <Section title="Delete your account">
        <Body style={{ marginTop: space(2) }}>
          This cancels any membership billing at once and deletes your account, progress, coach conversations and posts. It can't be undone.
        </Body>
        {confirm === null ? (
          <Button title="Delete my account…" variant="danger" onPress={() => setConfirm("")} style={{ marginTop: space(3) }} />
        ) : (
          <View style={{ marginTop: space(3) }}>
            <Body>Type DELETE to confirm.</Body>
            <TextInput value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} style={styles.input} accessibilityLabel="Type DELETE to confirm" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Delete my account" variant="danger" onPress={deleteAccount} busy={busy} disabled={confirm.trim().toUpperCase() !== "DELETE"} style={{ marginTop: space(3) }} />
            <Button title="Keep my account" variant="quiet" onPress={() => setConfirm(null)} style={{ marginTop: space(1) }} />
          </View>
        )}
      </Section>
      <Body muted style={{ marginTop: space(8), textAlign: "center" }}>Fatherhood.School {APP_VERSION}</Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { marginTop: space(3), fontSize: 14, fontWeight: "600", color: colors.gold600 },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.navy100, backgroundColor: colors.white, paddingHorizontal: space(3), fontSize: 16, marginTop: space(2) },
  error: { color: colors.danger, marginTop: space(2) },
});
