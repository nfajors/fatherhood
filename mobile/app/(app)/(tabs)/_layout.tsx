import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { colors, serif } from "../../../src/ui/theme";

/** Small text glyphs keep the app free of an icon font. */
const glyph = (char: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 18 }}>{char}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.gold600,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line },
        headerStyle: { backgroundColor: colors.paper },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: serif, fontWeight: "600", color: colors.navy900 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerTitle: "Fatherhood.School", tabBarIcon: glyph("⌂") }} />
      <Tabs.Screen name="learn" options={{ title: "Learn", tabBarIcon: glyph("▤") }} />
      <Tabs.Screen name="stories" options={{ title: "Stories", tabBarIcon: glyph("❝") }} />
      <Tabs.Screen name="coach" options={{ title: "Coach", tabBarIcon: glyph("✦") }} />
      <Tabs.Screen name="downloads" options={{ title: "Downloads", tabBarIcon: glyph("↓") }} />
    </Tabs>
  );
}
