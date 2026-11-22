/**
 * Everything behind sign-in. While the saved session is being read, show a
 * spinner rather than redirecting, so opening the app from a link keeps the link.
 */
import { Redirect, Stack } from "expo-router";
import { View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { Loading } from "../../src/ui/components";
import { colors, serif } from "../../src/ui/theme";

export default function SignedInLayout() {
  const auth = useAuth();
  if (auth.status === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, justifyContent: "center" }}>
        <Loading />
      </View>
    );
  }
  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.navy900,
        headerStyle: { backgroundColor: colors.paper },
        headerTitleStyle: { fontFamily: serif, fontWeight: "600" },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.paper },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="course/[slug]" options={{ title: "" }} />
      <Stack.Screen name="watch/[videoId]" options={{ title: "" }} />
      <Stack.Screen name="coach/[id]" options={{ title: "Coach" }} />
      <Stack.Screen name="coach/about" options={{ title: "About you", presentation: "modal" }} />
      <Stack.Screen name="account" options={{ title: "Account" }} />
    </Stack>
  );
}
