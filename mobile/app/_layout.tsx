import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/auth/AuthProvider";
import { DownloadsProvider } from "../src/downloads/DownloadsProvider";
import { colors } from "../src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DownloadsProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
            <Stack.Screen name="(app)" options={{ animation: "fade" }} />
          </Stack>
        </DownloadsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
