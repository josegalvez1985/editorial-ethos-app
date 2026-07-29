import type { ReactNode } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useColors } from "@/lib/theme";
import { fonts, radius } from "@/theme/colors";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function CardHeader({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.header, style]}>{children}</View>;
}

export function CardContent({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.content, style]}>{children}</View>;
}

export function CardTitle({ children, onBrand }: { children: ReactNode; onBrand?: boolean }) {
  const colors = useColors();
  return (
    <Text style={[styles.title, { color: onBrand ? colors.onBrand : colors.foreground }]}>
      {children}
    </Text>
  );
}

export function CardDescription({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <Text style={[styles.description, { color: colors.mutedForeground }]}>{children}</Text>;
}

export function Badge({
  label,
  variant = "solid",
}: {
  label: string;
  variant?: "solid" | "outline" | "onBrand";
}) {
  const colors = useColors();

  const surface =
    variant === "onBrand"
      ? { backgroundColor: colors.overlayStrong, borderColor: "transparent" }
      : variant === "outline"
        ? { backgroundColor: "transparent", borderColor: colors.primary }
        : { backgroundColor: colors.primarySoft, borderColor: "transparent" };
  const tint = variant === "onBrand" ? colors.onBrand : colors.primary;

  return (
    <View style={[styles.badge, surface]}>
      <Text style={[styles.badgeText, { color: tint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  header: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10, gap: 6 },
  content: { paddingHorizontal: 18, paddingBottom: 18, gap: 12 },
  title: { fontFamily: fonts.display, fontSize: 20, letterSpacing: -0.3 },
  description: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20 },
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontFamily: fonts.sansSemi, fontSize: 11, letterSpacing: 0.4 },
});
