import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, serif, space } from "./theme";

export function Screen({ children, refreshing, onRefresh, edges }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; edges?: ("top" | "bottom")[] }) {
  return (
    <SafeAreaView style={styles.safe} edges={edges ?? []}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.gold500} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.heading, style]}>{children}</Text>;
}

export function Body({ children, muted, style, numberOfLines }: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return (
    <Text style={[styles.body, muted && styles.muted, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Card({ children, onPress, style, accessibilityLabel }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>
      {children}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [styles.button, styles[variant], (disabled || busy) && styles.disabled, pressed && styles.pressed, style]}
    >
      {busy ? <ActivityIndicator color={variant === "primary" ? colors.navy950 : colors.navy800} /> : <Text style={[styles.buttonText, variant !== "primary" && styles.buttonTextAlt, variant === "danger" && { color: colors.danger }]}>{title}</Text>}
    </Pressable>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}>
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, value))}%` }]} />
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.gold500} />
    </View>
  );
}

export function Notice({ title, message, action }: { title?: string; message: string; action?: { title: string; onPress: () => void } }) {
  return (
    <View style={styles.notice}>
      {title ? <Heading style={{ marginBottom: space(1) }}>{title}</Heading> : null}
      <Body muted>{message}</Body>
      {action ? <Button title={action.title} onPress={action.onPress} variant="secondary" style={{ marginTop: space(3), alignSelf: "flex-start" }} /> : null}
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: space(6) }}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

export function Pill({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.pill, selected && styles.pillOn]}>
      <Text style={[styles.pillText, selected && styles.pillTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: space(4), paddingBottom: space(12) },
  title: { fontFamily: serif, fontSize: 28, lineHeight: 34, color: colors.navy900, fontWeight: "600" },
  heading: { fontFamily: serif, fontSize: 19, lineHeight: 25, color: colors.navy900, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22, color: colors.ink },
  muted: { color: colors.muted },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: space(4), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, marginTop: space(3) },
  pressed: { opacity: 0.75 },
  button: { minHeight: 48, borderRadius: 10, paddingHorizontal: space(5), alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: colors.gold400 },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.navy100 },
  quiet: { backgroundColor: "transparent", paddingHorizontal: space(2) },
  danger: { backgroundColor: colors.white, borderWidth: 1, borderColor: "#e8c9c9" },
  disabled: { opacity: 0.5 },
  buttonText: { fontSize: 16, fontWeight: "600", color: colors.navy950 },
  buttonTextAlt: { color: colors.navy800 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.navy100, overflow: "hidden", marginTop: space(2) },
  fill: { height: 6, backgroundColor: colors.gold500 },
  center: { paddingVertical: space(16), alignItems: "center" },
  notice: { backgroundColor: colors.gold100, borderRadius: 12, padding: space(4), marginTop: space(4) },
  sectionTitle: { fontSize: 12, letterSpacing: 1.2, fontWeight: "700", color: colors.gold600 },
  pill: { paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: 999, borderWidth: 1, borderColor: colors.navy100, backgroundColor: colors.white, marginRight: space(2) },
  pillOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  pillText: { fontSize: 14, color: colors.navy800 },
  pillTextOn: { color: colors.white },
});
