import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useColors } from "@/lib/theme";
import { fonts, radius } from "@/theme/colors";

type Variant = "primary" | "outline" | "ghost" | "onBrand";
type Size = "md" | "lg" | "icon";

type Props = {
  label?: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  /** Se pinta a la izquierda del texto; recibe el color de contenido resuelto. */
  icon?: (color: string, size: number) => ReactNode;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  icon,
  accessibilityLabel,
  style,
}: Props) {
  const colors = useColors();

  const surface: Record<Variant, ViewStyle> = {
    primary: { backgroundColor: colors.primary },
    outline: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
    ghost: { backgroundColor: "transparent" },
    onBrand: { backgroundColor: "#ffffff" },
  };
  const content: Record<Variant, string> = {
    primary: colors.primaryForeground,
    outline: colors.foreground,
    ghost: colors.foreground,
    onBrand: colors.primary,
  };

  const tint = content[variant];
  const iconSize = size === "lg" ? 18 : 16;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === "icon" ? styles.icon : size === "lg" ? styles.lg : styles.md,
        surface[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={tint} /> : icon?.(tint, iconSize)}
        {label ? (
          <Text style={[styles.label, size === "lg" && styles.labelLg, { color: tint }]}>
            {label}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  md: { paddingHorizontal: 18, paddingVertical: 13 },
  lg: { paddingHorizontal: 22, paddingVertical: 15 },
  // 44 = mínimo táctil recomendado por iOS y Android.
  icon: { width: 44, height: 44, borderRadius: radius.pill },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontFamily: fonts.sansSemi, fontSize: 15 },
  labelLg: { fontSize: 16 },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
});
