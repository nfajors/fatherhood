/**
 * Members sign in with the email and password they use on the website. There is
 * no sign-up or purchase in the app (reader-app rules): accounts and membership
 * are set up on the website.
 */
import { Redirect } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "../src/api/client";
import { useAuth } from "../src/auth/AuthProvider";
import { Body, Button } from "../src/ui/components";
import { colors, serif, space } from "../src/ui/theme";

export default function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === "signedIn") return <Redirect href="/(app)/(tabs)" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(email, password); // signed in: the redirect above takes him home
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <Text style={styles.brand}>Fatherhood.School</Text>
        <Body style={styles.tagline}>Serious education for fathers and the men who will become them.</Body>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            style={styles.input}
            accessibilityLabel="Email"
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            style={styles.input}
            onSubmitEditing={submit}
            accessibilityLabel="Password"
          />
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} style={{ marginTop: space(5) }} />
        </View>
        <Body muted style={styles.note}>
          Sign in with the account you use on fatherhood.school.
        </Body>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy900 },
  wrap: { flex: 1, padding: space(6), justifyContent: "center" },
  brand: { fontFamily: serif, fontSize: 34, color: colors.white, fontWeight: "600" },
  tagline: { color: colors.navy100, marginTop: space(2) },
  form: { marginTop: space(10), backgroundColor: colors.paper, borderRadius: 14, padding: space(5) },
  label: { fontSize: 14, fontWeight: "600", color: colors.navy800, marginTop: space(3), marginBottom: space(1) },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.navy100, backgroundColor: colors.white, paddingHorizontal: space(3), fontSize: 16, color: colors.ink },
  error: { color: colors.danger, marginTop: space(3), fontSize: 14 },
  note: { color: colors.navy100, marginTop: space(6), textAlign: "center" },
});
